# Iteration log

| branch | what changed | felt |
|---|---|---|
| — | **Lab:** first set of variants: Grain Duet, Two Bodies, One Body, Meter, Membrane | — |
| — | **Presence group:** Drift Grain, Drift Body, Bloom and Tide. Colour as temperature: warm for you, cool for the agent, neutral white at each handoff. Calm, but responsive within a fraction of a second | — |
| — | **Presence layer:** rest, listen, think, speak and yield, plus a settle afterwards. Listening turns toward you, holds the breath shallow, echoes your rhythm and dips at your phrase ends. Thinking inhales. Speaking releases into the voice with springy syllables | — |
| `main` | **Test agent:** Gemini Live via single-use tokens, replacing the private relay. Repo prepared for sharing (README, MIT license, Deploy button) | — |
| `iter/04-voice-cards` | **Voice cards experiment** (the "Voice cards" toggle, `?exp=cards`). The agent gets tools to show and dismiss UI: `show_calendar`, `show_weather`, `show_list`, `add_to_list`, `dismiss_card`. Cards unfold out of the orb as it rises and shrinks, then fold back in. The data goes back to the agent so it can talk about it. Sample data only. Keys: C W L summon, X clears | — |
| `iter/05-card-forms` | **Card styles:** how the agent's UI arrives and leaves, switchable live (`?cardstyle=`). **Unfold:** the orb rises, cards unfold out of it. **Morph:** the orb pours into the card shape and dims while it's open. **Narrate:** rows appear as the agent talks about them, paced by its syllables. **Satellite:** the orb stays centre stage, cards are tap-to-open chips. New **timer** card (`set_timer`) with a live countdown | — |
| `iter/06-orbs-and-dropdowns` | **Controls:** the pill rows became one row of dropdowns (Orb, Behaviour, Experiment, plus Cards appear by when Voice cards is on). **New orbs:** Halo (a ring that faces you as it listens and fills on the inhale), Ripple (rings flow inward for you and outward for the agent), Liquid (a marbled drop that sags toward you), Swarm (a murmuration that gathers and fans). **Behaviours** (`?b=`): Attentive, Calm, Lively, Mirror and Reserved, as presets for the shared presence layer | — |
