import { GoogleGenAI, Modality, Type, type FunctionDeclaration } from "@google/genai";

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

// ── experiments ─────────────────────────────────────────────────────────────
// Each experiment locks its own prompt + tools into the token. Only these ids are accepted.

const CARDS_PROMPT = `You are a warm, quick voice assistant on a screen. You can put visual cards on the
screen with tools, and take them away again.
- Their day, schedule, meetings, "what's going on": call show_calendar (day "today" or "tomorrow").
- Weather, "do I need a jacket": call show_weather.
- Their to-do list or reminders: call show_list. To add something: call add_to_list.
- A timer or countdown ("set a timer for ten minutes"): call set_timer.
- When they are done with a card ("I don't need that anymore", "close that", "thanks, got it",
  "clear the screen"): call dismiss_card with that card, or "all".
After a card appears, give a short spoken summary. The card carries the detail, so don't read
every item aloud. Pick out what matters (the next thing, anything unusual). Never describe the
tool call itself. Keep every reply to one to three conversational sentences.`;

const CARD_TOOLS: FunctionDeclaration[] = [
  {
    name: "show_calendar",
    description: "Show the user's calendar card for a day and get its events.",
    parameters: {
      type: Type.OBJECT,
      properties: { day: { type: Type.STRING, enum: ["today", "tomorrow"], description: "Which day to show." } },
      required: ["day"],
    },
  },
  { name: "show_weather", description: "Show the local weather card and get the forecast." },
  { name: "show_list", description: "Show the user's to-do list card and get its items." },
  {
    name: "add_to_list",
    description: "Add an item to the user's to-do list (shows the list card).",
    parameters: { type: Type.OBJECT, properties: { item: { type: Type.STRING } }, required: ["item"] },
  },
  {
    name: "set_timer",
    description: "Start a countdown timer card.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        minutes: { type: Type.NUMBER, description: "Length in minutes (fractions allowed, e.g. 0.5 for 30 seconds)." },
        label: { type: Type.STRING, description: "Optional short label, e.g. 'pasta'." },
      },
      required: ["minutes"],
    },
  },
  {
    name: "dismiss_card",
    description: "Remove a card from the screen when the user is done with it.",
    parameters: {
      type: Type.OBJECT,
      properties: { card: { type: Type.STRING, enum: ["calendar", "weather", "list", "timer", "all"] } },
      required: ["card"],
    },
  },
];

export const EXPERIMENTS: Record<string, { prompt: string; tools?: FunctionDeclaration[] }> = {
  talk: { prompt: DEFAULT_PROMPT },
  cards: { prompt: CARDS_PROMPT, tools: CARD_TOOLS },
};

export type TokenResponse = { token: string; model: string; voice: string; sessionSeconds: number; experiment: string };

export async function mintToken(env: Record<string, string | undefined>, experimentId = "talk"): Promise<TokenResponse> {
  const experiment = EXPERIMENTS[experimentId] ? experimentId : "talk";
  const exp = EXPERIMENTS[experiment];
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
          systemInstruction: experiment === "talk" ? env.AGENT_PROMPT || exp.prompt : exp.prompt,
          ...(exp.tools ? { tools: [{ functionDeclarations: exp.tools }] } : {}),
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      },
    },
  });
  if (!token.name) throw new Error("Gemini did not return a token.");
  return { token: token.name, model, voice, sessionSeconds, experiment };
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
