import type { ConversationSignal } from "./conversation";

// A behavioural layer between the raw voice features and the visuals, so every variant
// behaves like *something* in a conversation rather than a level meter:
//
//   rest    — slow breathing, small idle drifts of attention, never dead-still
//   listen  — turns toward you, breath goes shallow (held), quietly entrains to your rhythm,
//             and gives small acknowledging dips at your stresses and phrase ends
//   think   — after you stop: draws a breath in, gathers itself (anticipation)
//   speak   — releases that breath into its voice; articulates on its syllables with
//             springy follow-through, carries a slow phrase arc
//   yield   — you cut in: it contracts quickly and turns back to you
//   (after speaking it settles with a slow exhale before returning to rest)
//
// Variants read `sig.body`. The simplest use is body.scale + body.offset; richer variants
// use the individual channels (voice, syllable, mirror, nod, inhale …).

export type Mode = "rest" | "listen" | "think" | "speak" | "yield";

export type Body = {
  mode: Mode;
  /** -1..1 slow breathing. */
  breath: number;
  /** 0..1 breath drawn in before speaking. */
  inhale: number;
  /** 0..1 turned toward you. */
  attention: number;
  /** Small gaze drift, -1..1 each; y < 0 is toward you (down the screen). */
  gazeX: number;
  gazeY: number;
  /** Acknowledgment spring (dips toward you), roughly -1..1. */
  nod: number;
  /** 0..1 lagged entrainment with your voice while listening. */
  mirror: number;
  /** 0..1 the agent's articulation envelope (fast attack, natural release). */
  voice: number;
  /** Springy bumps on the agent's syllables, roughly -1..1. */
  syllable: number;
  /** 0..1 slow arc over the agent's phrase. */
  phrase: number;
  /** 0..1 slow exhale after it finishes speaking. */
  settle: number;
  /** 0..1 contraction when you barge in. */
  yielding: number;
  /** Convenience: relative scale offset (add to 1) combining the channels above. */
  scale: number;
  /** Convenience: positional offset in "body radii"; y < 0 = toward you. */
  offsetX: number;
  offsetY: number;
  /** Convenience: 0..1 surface activity (ripple/noise), mostly the agent's voice. */
  stir: number;
};

/** Shared tunables (the tuner's "Presence" folder). */
export const presenceParams = {
  breathRate: 0.2, // Hz at rest
  breathDepth: 1,
  listenBreath: 0.45, // breath depth while listening (held)
  inhaleTime: 0.7,
  attentionTime: 0.55,
  lean: 1,
  gazeDrift: 1,
  nod: 1,
  nodSpring: 55,
  nodDamping: 7,
  mirror: 0.6,
  mirrorLag: 0.2,
  voiceAttack: 0.04,
  voiceRelease: 0.22,
  syllable: 1,
  settleTime: 1.6,
  yieldTime: 0.45,
  // weights for the convenience channels
  wBreath: 0.03,
  wInhale: 0.06,
  wVoice: 0.09,
  wSyllable: 0.035,
  wMirror: 0.025,
  wYield: 0.07,
  wLean: 0.18,
  wGaze: 0.06,
  wNod: 0.1,
};

const approach = (cur: number, target: number, seconds: number, dt: number) =>
  cur + (target - cur) * (1 - Math.exp(-dt / Math.max(1e-3, seconds)));

export function emptyBody(): Body {
  return {
    mode: "rest", breath: 0, inhale: 0, attention: 0, gazeX: 0, gazeY: 0, nod: 0, mirror: 0,
    voice: 0, syllable: 0, phrase: 0, settle: 0, yielding: 0, scale: 0, offsetX: 0, offsetY: 0, stir: 0,
  };
}

export class Presence {
  readonly body = emptyBody();
  private breathPhase = Math.random() * 6.28;
  private breathDepthNow = 1;
  private nodV = 0;
  private sylV = 0;
  private lastYouOnsets = 0;
  private lastBobOnsets = 0;
  private lastNodT = -10;
  private youWasActive = false;
  private modeT = 0;
  private lastListenT = -10;
  private gazeTX = 0;
  private gazeTY = 0;
  private nextSaccade = 0;
  private mirrorLagged = 0;

  update(s: ConversationSignal, dt: number, now: number) {
    const p = presenceParams;
    const b = this.body;
    const you = s.you;
    const ag = s.agent;

    // ── mode ───────────────────────────────────────────────
    const prev = b.mode;
    let mode: Mode;
    if (s.live < 0.05) mode = "rest";
    else if ((s.speaker === "you" || s.speaker === "both") && (prev === "speak" || (prev === "yield" && now - this.modeT < p.yieldTime)))
      mode = "yield";
    else if (s.speaker === "you" || s.speaker === "both") mode = "listen";
    else if (s.speaker === "agent") mode = "speak";
    else if (s.phase === "thinking") mode = "think";
    else if (now - this.lastListenT < 1.2) mode = "listen"; // attention lingers through short pauses
    else mode = "rest";
    if (mode === "yield" && prev === "yield" && now - this.modeT >= p.yieldTime) mode = "listen";
    if (mode !== prev) {
      if (prev === "speak") b.settle = 1; // finished speaking: begin the slow exhale
      this.modeT = now;
      b.mode = mode;
    }
    if (mode === "listen" && (s.speaker === "you" || s.speaker === "both")) this.lastListenT = now;

    // ── breath ─────────────────────────────────────────────
    const rate = p.breathRate * (mode === "listen" ? 0.8 : mode === "think" ? 0.6 : 1);
    this.breathPhase += dt * Math.PI * 2 * rate;
    const depthT = (mode === "listen" || mode === "yield" ? p.listenBreath : mode === "speak" ? 0.25 : mode === "think" ? 0.3 : 1) * p.breathDepth;
    this.breathDepthNow = approach(this.breathDepthNow, depthT, 0.8, dt);
    b.breath = Math.sin(this.breathPhase) * this.breathDepthNow;

    // ── anticipation: breath drawn in while thinking, released into speech ──
    const inhaleT = mode === "think" ? 1 : 0;
    b.inhale = approach(b.inhale, inhaleT, inhaleT > b.inhale ? p.inhaleTime : mode === "speak" ? 1.2 : 0.5, dt);

    // ── attention + gaze ───────────────────────────────────
    const attT = { rest: 0.12 + 0.12 * s.live, listen: 1, think: 0.85, speak: 0.3, yield: 1 }[mode];
    b.attention = approach(b.attention, attT, p.attentionTime, dt);
    if (now > this.nextSaccade) {
      // idle eyes wander; listening eyes stay near you
      const spread = mode === "listen" || mode === "yield" ? 0.12 : mode === "speak" ? 0.25 : 0.45;
      this.gazeTX = (Math.random() * 2 - 1) * spread;
      this.gazeTY = (Math.random() * 2 - 1) * spread * 0.6;
      this.nextSaccade = now + (mode === "rest" ? 2 + Math.random() * 3 : 1.2 + Math.random() * 2);
    }
    b.gazeX = approach(b.gazeX, this.gazeTX * p.gazeDrift, 0.3, dt);
    b.gazeY = approach(b.gazeY, (this.gazeTY - b.attention * 0.6) * p.gazeDrift, 0.3, dt);

    // ── acknowledgment nods while you talk ─────────────────
    const nodNow = (strength: number) => {
      if (now - this.lastNodT < 1.1) return;
      this.nodV -= strength * p.nod * 5;
      this.lastNodT = now;
    };
    if (you.onsets !== this.lastYouOnsets) {
      if (mode === "listen" && you.peak > 0.6 && Math.random() < 0.5) nodNow(0.5); // a stressed syllable
      this.lastYouOnsets = you.onsets;
    }
    if (this.youWasActive && !you.active && mode !== "speak") nodNow(1); // you finished a phrase
    this.youWasActive = you.active;
    const acc = -p.nodSpring * b.nod - p.nodDamping * this.nodV;
    this.nodV += acc * dt;
    b.nod += this.nodV * dt;

    // ── entrainment: a quiet, lagged echo of your rhythm ───
    this.mirrorLagged = approach(this.mirrorLagged, you.levelSlow * you.presence, p.mirrorLag, dt);
    b.mirror = approach(b.mirror, this.mirrorLagged * (mode === "listen" ? p.mirror : 0.1 * p.mirror), 0.15, dt);

    // ── the agent's voice: envelope, syllable springs, phrase arc ──
    const vT = ag.level * Math.min(1, ag.presence * 1.5);
    b.voice = approach(b.voice, vT, vT > b.voice ? p.voiceAttack : p.voiceRelease, dt);
    if (ag.onsets !== this.lastBobOnsets) {
      if (mode === "speak") this.sylV += (0.6 + ag.peak) * p.syllable * 4;
      this.lastBobOnsets = ag.onsets;
    }
    const sAcc = -90 * b.syllable - 9 * this.sylV;
    this.sylV += sAcc * dt;
    b.syllable += this.sylV * dt;
    b.phrase = approach(b.phrase, ag.levelSlow * ag.presence, 0.8, dt);

    // ── settle after speaking, yield on barge-in ───────────
    b.settle = mode === "speak" ? approach(b.settle, 0, 0.3, dt) : b.settle * Math.exp(-dt / p.settleTime);
    b.yielding = approach(b.yielding, mode === "yield" ? 1 : 0, mode === "yield" ? 0.12 : 0.6, dt);

    // ── convenience channels ───────────────────────────────
    b.scale =
      b.breath * p.wBreath + b.inhale * p.wInhale + b.voice * p.wVoice + b.syllable * p.wSyllable +
      b.mirror * p.wMirror - b.yielding * p.wYield - b.settle * p.wBreath;
    b.offsetX = b.gazeX * p.wGaze;
    b.offsetY = b.gazeY * p.wGaze - b.attention * p.wLean * p.lean + b.nod * p.wNod + b.inhale * 0.04 + b.phrase * 0.05; // lifts a little as it addresses you
    b.stir = Math.min(1, b.voice * 0.8 + Math.abs(b.syllable) * 0.4 + b.mirror * 0.3);
  }
}
