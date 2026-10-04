import { GoogleGenAI, Modality } from "@google/genai";

// Mints a short-lived, single-use Gemini Live token for the browser. The real API key stays
// on the server. The token is locked to the model, voice and prompt below, so a visitor can't
// repurpose it, and it stops working shortly after the session cap.
//
// Configure with env vars: GEMINI_API_KEY (required), and optionally AGENT_MODEL, AGENT_VOICE,
// AGENT_PROMPT, AGENT_SESSION_SECONDS.

export const DEFAULT_PROMPT = `You are a warm, curious voice companion. You are being used to test an
interactive visual that reacts to both voices in a conversation. Keep replies short and natural:
one to three sentences, conversational, never a list. Ask a question back now and then so the
conversation keeps flowing. Don't mention that you are a test unless asked.`;

export type TokenResponse = { token: string; model: string; voice: string; sessionSeconds: number };

export async function mintToken(env: Record<string, string | undefined>): Promise<TokenResponse> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set on the server.");
  const model = env.AGENT_MODEL || "gemini-2.5-flash-native-audio-preview-12-2025";
  const voice = env.AGENT_VOICE || "Aoede";
  const sessionSeconds = Number(env.AGENT_SESSION_SECONDS || 300);
  const now = Date.now();

  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      newSessionExpireTime: new Date(now + 60_000).toISOString(),
      expireTime: new Date(now + (sessionSeconds + 30) * 1000).toISOString(),
      liveConnectConstraints: {
        model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: env.AGENT_PROMPT || DEFAULT_PROMPT,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      },
      lockAdditionalFields: [],
    },
  });
  if (!token.name) throw new Error("Gemini did not return a token.");
  return { token: token.name, model, voice, sessionSeconds };
}

// Best-effort per-IP limit (per server instance) so an unlisted demo can't be hammered.
const hits = new Map<string, number[]>();
export function rateLimited(ip: string, max = 8, windowMs = 10 * 60_000) {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) return true;
  list.push(now);
  hits.set(ip, list);
  return false;
}
