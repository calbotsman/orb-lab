import { presenceParams } from "./presence";

// Talk behaviours: presets for the presence layer, i.e. *how* it listens, thinks and speaks.
// Every orb reads the same presence, so a behaviour changes the feel of any orb. Each preset
// starts from the defaults; the Presence folder in the tuner still fine-tunes from there.

export const PRESENCE_DEFAULTS = { ...presenceParams };
type P = Partial<typeof presenceParams>;

export const BEHAVIOURS: Record<string, { label: string; about: string; p: P }> = {
  attentive: { label: "Attentive", about: "the default: turns to you, small nods, springy speech", p: {} },
  calm: {
    label: "Calm",
    about: "slow breath, unhurried attention, very little motion",
    p: { breathRate: 0.13, breathDepth: 0.7, listenBreath: 0.3, attentionTime: 1.3, lean: 0.6, gazeDrift: 0.45, nod: 0.35, mirror: 0.25, syllable: 0.4, settleTime: 2.8, wVoice: 0.06, wSyllable: 0.02 },
  },
  lively: {
    label: "Lively",
    about: "quick to turn, big nods, bouncy syllables",
    p: { breathRate: 0.27, attentionTime: 0.28, lean: 1.4, gazeDrift: 1.4, nod: 2.2, nodSpring: 85, syllable: 2.2, settleTime: 0.9, wVoice: 0.12, wSyllable: 0.06, wNod: 0.14 },
  },
  mirror: {
    label: "Mirror",
    about: "echoes your rhythm closely while you talk",
    p: { mirror: 1.4, mirrorLag: 0.1, wMirror: 0.07, nod: 0.6, lean: 1.2, listenBreath: 0.6 },
  },
  reserved: {
    label: "Reserved",
    about: "listens without leaning in; speaks quietly",
    p: { lean: 0.25, attentionTime: 1.6, gazeDrift: 0.3, wGaze: 0.03, nod: 0.2, mirror: 0.1, syllable: 0.5, wVoice: 0.05, wInhale: 0.03 },
  },
};

export function applyBehaviour(id: string) {
  Object.assign(presenceParams, PRESENCE_DEFAULTS, BEHAVIOURS[id]?.p ?? {});
}
