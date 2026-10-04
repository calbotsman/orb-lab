# Orb Lab

A voice orb that reacts to **both sides of a conversation**: your voice from the mic, and the
agent's voice as it plays back. It listens, takes a breath while it thinks, then speaks.

**Live demo:** https://jel.design/interactions

## What's inside
- **A voice engine** (`src/engine/`):
  - One shared audio setup that analyses your mic and the agent's playback separately. The agent's side is measured as you hear it, not when the audio arrives.
  - **Per voice, every frame:** loudness, bass/mid/high, pitch, intonation, brightness, syllable onsets, speaking rate and voice activity.
  - **Conversation layer:** who's talking, overlap, handoffs, silence, the thinking gap, and an echo guard.
  - **Presence layer** (`presence.ts`): turns all of that into body language. It is at rest, turns toward you to listen, inhales while it thinks, speaks with springy syllables, settles afterwards, and yields when you cut in.
- **Variants** (`src/variants/`): each is one file implementing a small `Variant` contract. To fork an idea, copy a file and register it in `src/variants/index.ts`.
- **A tuner:** live sliders for every variant plus the shared presence. **📋 Copy params** exports your settings as JSON.
- **A test agent:** Gemini Live, connected straight from the browser using a short-lived single-use token. Your API key never reaches the client.
- **Sim convo:** a synthetic back-and-forth for tuning without a mic or an API key.

## Run it
```
npm install
cp .env.example .env.local      # add your GEMINI_API_KEY (https://aistudio.google.com/apikey)
npm run dev                     # http://localhost:4100/interactions/
```
Keys: `1–9` / `← →` switch variant · `space` talk · `S` sim · `H` readings · `G` tuner.
Headphones help, so the agent's voice doesn't leak into your mic.

## Deploy your own
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcalbotsman%2Forb-lab&env=GEMINI_API_KEY&envDescription=Gemini%20API%20key%20for%20the%20test%20agent&envLink=https%3A%2F%2Faistudio.google.com%2Fapikey)

`api/token.ts` mints the session tokens. Optional env vars:
- `AGENT_MODEL`
- `AGENT_VOICE`
- `AGENT_PROMPT`
- `AGENT_SESSION_SECONDS` (default 300)

Sessions are capped, and token requests are rate-limited per IP. A public deployment still spends
your Gemini credits, though, so keep an eye on usage.

## Iterating
`main` is the current best. Each experiment is a branch, `iter/NN-name`, and Vercel gives every
branch its own preview URL. `NOTES.md` logs what changed and how it felt.

## License
MIT
