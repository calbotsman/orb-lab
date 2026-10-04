import { emptyFeatures, engineParams, type VoiceFeatures } from "./features";
import { Presence, type Body } from "./presence";

export type Phase = "offline" | "idle" | "listening" | "thinking" | "speaking";
export type Speaker = "none" | "you" | "agent" | "both";

/** Everything a variant gets each frame. */
export type ConversationSignal = {
  t: number;
  phase: Phase;
  speaker: Speaker;
  /** Echo-guarded features: while the agent talks, your voice only counts above the barge-in threshold. */
  you: VoiceFeatures;
  agent: VoiceFeatures;
  /** Raw (unguarded) mic features — for the HUD. */
  youRaw: VoiceFeatures;
  /** 0..1, both talking at once. */
  overlap: number;
  /** 0..1 pulse on a change of speaker; decays over ~0.8 s. */
  handoff: number;
  /** +1 the turn just went to the agent, -1 it just came to you. */
  handoffDir: number;
  /** Seconds since the speaker last changed. */
  sinceTurnChange: number;
  /** Seconds since anyone was speaking. */
  silence: number;
  /** Slow overall conversational energy 0..1. */
  energy: number;
  /** 0..1 eased "a session is live" (connected or simulating). */
  live: number;
  /** Behavioural layer: listening / thinking / speaking body language (see presence.ts). */
  body: Body;
};

const ease = (cur: number, target: number, k: number, dt: number) => cur + (target - cur) * (1 - Math.pow(1 - k, dt * 60));

export class Conversation {
  readonly sig: ConversationSignal;
  private guardedYou = emptyFeatures();
  private gate = 0;
  private lastSpeaker: Speaker = "none";
  private lastSolo: "you" | "agent" | null = null;
  private lastVoiceT = 0;
  private turnT = 0;
  private youEndedT = -1;
  private presence = new Presence();

  constructor(youRaw: VoiceFeatures, agent: VoiceFeatures) {
    this.sig = {
      t: 0, phase: "offline", speaker: "none", you: this.guardedYou, agent, youRaw,
      overlap: 0, handoff: 0, handoffDir: 0, sinceTurnChange: 0, silence: 0, energy: 0, live: 0,
      body: this.presence.body,
    };
  }

  update(dt: number, now: number, live: boolean, agentPlaying: boolean) {
    const s = this.sig;
    const raw = s.youRaw;
    const agent = s.agent;
    s.t = now;

    // echo guard
    const agentTalking = agent.active || agentPlaying;
    const youCounts = raw.active && (!agentTalking || raw.level > engineParams.bargeIn);
    this.gate = ease(this.gate, youCounts ? 1 : agentTalking ? 0.15 : 1, 0.25, dt);
    const g = this.gate;
    const y = this.guardedYou;
    Object.assign(y, raw);
    y.level = raw.level * g;
    y.levelSlow = raw.levelSlow * g;
    y.peak = raw.peak * g;
    y.bass = raw.bass * g;
    y.mid = raw.mid * g;
    y.high = raw.high * g;
    y.onset = raw.onset * g;
    y.active = youCounts;
    y.presence = raw.presence * g;

    const youOn = y.active;
    const agentOn = agent.active;
    const speaker: Speaker = youOn && agentOn ? "both" : youOn ? "you" : agentOn ? "agent" : "none";

    if (speaker !== this.lastSpeaker) {
      this.turnT = now;
      if (speaker === "you" || speaker === "agent") {
        if (this.lastSolo && this.lastSolo !== speaker) {
          s.handoff = 1;
          s.handoffDir = speaker === "agent" ? 1 : -1;
        }
        this.lastSolo = speaker;
      }
      if (this.lastSpeaker === "you" && speaker === "none") this.youEndedT = now;
      this.lastSpeaker = speaker;
    }
    s.speaker = speaker;
    s.handoff *= Math.pow(0.94, dt * 60);
    s.sinceTurnChange = now - this.turnT;
    if (speaker !== "none") this.lastVoiceT = now;
    s.silence = now - this.lastVoiceT;
    s.overlap = ease(s.overlap, speaker === "both" ? 1 : 0, 0.15, dt);
    s.energy = ease(s.energy, Math.max(y.level, agent.level), 0.02, dt);
    s.live = ease(s.live, live ? 1 : 0, 0.04, dt);

    if (!live) s.phase = "offline";
    else if (agentOn || agentPlaying) s.phase = "speaking";
    else if (youOn) s.phase = "listening";
    else if (this.youEndedT > 0 && now - this.youEndedT < 6 && this.lastSolo === "you") s.phase = "thinking";
    else s.phase = "idle";

    this.presence.update(s, dt, now);
  }
}
