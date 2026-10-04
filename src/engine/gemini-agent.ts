import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";

// The test agent: Gemini Live, straight from the browser. The page asks our own
// /api/token endpoint for a short-lived single-use token (the real API key never leaves the
// server), then opens the Live session with it. Audio formats match the rest of the engine:
// 16 kHz PCM16 up, 24 kHz PCM16 down, base64.

export type AgentHandlers = {
  onReady?: (info: { voice: string; model: string; sessionSeconds: number }) => void;
  onAudio?: (b64: string) => void;
  onInterrupted?: () => void;
  onInputText?: (t: string) => void;
  onOutputText?: (t: string) => void;
  onTurnComplete?: () => void;
  onError?: (msg: string) => void;
  onClose?: () => void;
  /** Run a tool call the agent made; the returned object goes back to the agent as the result. */
  onToolCall?: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
};

export class GeminiAgent {
  private session: Session | null = null;
  private limitTimer = 0;
  private closedByUs = false;

  constructor(private h: AgentHandlers) {}

  get open() {
    return this.session !== null;
  }

  async connect(experiment = "talk") {
    const r = await fetch(`${import.meta.env.BASE_URL}api/token?experiment=${encodeURIComponent(experiment)}`, { method: "POST" });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.token) throw new Error(body.error ?? `Could not start a session (${r.status}).`);
    const { token, model, voice, sessionSeconds } = body as { token: string; model: string; voice: string; sessionSeconds: number };

    const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });
    this.closedByUs = false;
    this.session = await ai.live.connect({
      model,
      // The server locks the real config into the token; this only has to agree with it.
      config: { responseModalities: [Modality.AUDIO] },
      callbacks: {
        onmessage: (m) => this.handle(m),
        onerror: (e) => this.h.onError?.(e instanceof ErrorEvent ? e.message : "Connection error"),
        onclose: (e) => {
          const wasOpen = this.session !== null;
          this.session = null;
          clearTimeout(this.limitTimer);
          if (wasOpen && !this.closedByUs && e?.reason) this.h.onError?.(e.reason);
          this.h.onClose?.();
        },
      },
    });
    this.h.onReady?.({ voice, model, sessionSeconds });
    this.limitTimer = window.setTimeout(() => {
      this.h.onError?.(`Session limit (${Math.round(sessionSeconds / 60)} min) reached. Start a new one any time.`);
      this.close();
    }, sessionSeconds * 1000);
  }

  sendAudio(b64: string) {
    this.session?.sendRealtimeInput({ audio: { data: b64, mimeType: "audio/pcm;rate=16000" } });
  }

  close() {
    this.closedByUs = true;
    clearTimeout(this.limitTimer);
    this.session?.close();
    this.session = null;
  }

  private handle(msg: LiveServerMessage) {
    if (msg.toolCall?.functionCalls?.length) void this.runTools(msg.toolCall.functionCalls);
    const sc = msg.serverContent;
    if (!sc) return;
    if (sc.interrupted) this.h.onInterrupted?.();
    if (sc.inputTranscription?.text) this.h.onInputText?.(sc.inputTranscription.text);
    if (sc.outputTranscription?.text) this.h.onOutputText?.(sc.outputTranscription.text);
    for (const part of sc.modelTurn?.parts ?? []) {
      const d = part.inlineData;
      if (d?.data && String(d.mimeType ?? "").startsWith("audio/pcm")) this.h.onAudio?.(d.data);
    }
    if (sc.turnComplete) this.h.onTurnComplete?.();
  }

  private async runTools(calls: NonNullable<NonNullable<LiveServerMessage["toolCall"]>["functionCalls"]>) {
    const functionResponses = [];
    for (const call of calls) {
      let response: Record<string, unknown>;
      try {
        response = (await this.h.onToolCall?.(call.name ?? "", call.args ?? {})) ?? { error: "no handler" };
      } catch (e) {
        response = { error: e instanceof Error ? e.message : String(e) };
      }
      functionResponses.push({ id: call.id, name: call.name, response });
    }
    this.session?.sendToolResponse({ functionResponses });
  }
}
