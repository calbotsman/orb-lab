import type { AudioGraph } from "./audio-graph";

// Synthetic speech-ish voices so variants can be tuned without the relay.
// A sawtooth glottal source through two formant band-passes, gated into syllables
// with a declining pitch contour and occasional question rises.

type VoiceSpec = { f0: number; spread: number; formants: [number, number] };
const VOICES: Record<"you" | "agent", VoiceSpec> = {
  you: { f0: 120, spread: 0.35, formants: [700, 1600] },
  agent: { f0: 165, spread: 0.45, formants: [850, 2100] },
};

class SimVoice {
  private osc: OscillatorNode;
  private noise: AudioBufferSourceNode;
  private amp: GainNode;
  private f1: BiquadFilterNode;
  private f2: BiquadFilterNode;

  constructor(ctx: AudioContext, out: AudioNode, private spec: VoiceSpec) {
    this.osc = ctx.createOscillator();
    this.osc.type = "sawtooth";
    this.osc.frequency.value = spec.f0;
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = nb;
    this.noise.loop = true;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.08;
    const src = ctx.createGain();
    this.osc.connect(src);
    this.noise.connect(noiseGain).connect(src);
    this.f1 = new BiquadFilterNode(ctx, { type: "bandpass", frequency: spec.formants[0], Q: 4 });
    this.f2 = new BiquadFilterNode(ctx, { type: "bandpass", frequency: spec.formants[1], Q: 6 });
    const mix = ctx.createGain();
    mix.gain.value = 1.6;
    src.connect(this.f1).connect(mix);
    src.connect(this.f2).connect(mix);
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    mix.connect(this.amp).connect(out);
    this.osc.start();
    this.noise.start();
  }

  /** Schedule one utterance starting at t; returns its end time. */
  utter(t: number, syllables: number, loud = 1): number {
    const { spec } = this;
    const g = this.amp.gain;
    const fr = this.osc.frequency;
    const question = Math.random() < 0.3;
    for (let i = 0; i < syllables; i++) {
      const dur = 0.11 + Math.random() * 0.17;
      const prog = i / Math.max(1, syllables - 1);
      let f = spec.f0 * (1 + spec.spread * (0.5 - prog) * 0.8 + (Math.random() - 0.5) * spec.spread * 0.4);
      if (question && prog > 0.7) f *= 1 + (prog - 0.7) * 1.6;
      fr.setTargetAtTime(f, t, 0.03);
      this.f1.frequency.setTargetAtTime(spec.formants[0] * (0.7 + Math.random() * 0.6), t, 0.02);
      this.f2.frequency.setTargetAtTime(spec.formants[1] * (0.75 + Math.random() * 0.5), t, 0.02);
      const pk = (0.35 + Math.random() * 0.4) * loud;
      g.setTargetAtTime(pk, t, 0.012);
      g.setTargetAtTime(pk * 0.25, t + dur * 0.7, 0.025);
      t += dur;
      if (Math.random() < 0.12) t += 0.15 + Math.random() * 0.2; // breath
    }
    g.setTargetAtTime(0, t, 0.04);
    return t + 0.1;
  }

  silence(t: number) {
    this.amp.gain.cancelScheduledValues(t);
    this.amp.gain.setTargetAtTime(0, t, 0.03);
  }

  dispose() {
    this.osc.stop();
    this.noise.stop();
    this.amp.disconnect();
  }
}

/** Scripted back-and-forth: you talk, a thinking gap, the agent answers; sometimes you barge in. */
export class SimConversation {
  private you: SimVoice;
  private agent: SimVoice;
  private youOut: GainNode;
  private timer = 0;
  private stopped = false;
  agentFrom = 0;
  agentUntil = 0;

  constructor(private graph: AudioGraph) {
    const { ctx } = graph;
    // sim-you feeds the "you" analyser, and is faintly audible so you can judge sync
    this.youOut = ctx.createGain();
    this.youOut.connect(graph.youIn);
    const hear = ctx.createGain();
    hear.gain.value = 0.25;
    this.youOut.connect(hear).connect(ctx.destination);
    this.you = new SimVoice(ctx, this.youOut, VOICES.you);
    this.agent = new SimVoice(ctx, graph.agentBus, VOICES.agent);
    this.loop(ctx.currentTime + 0.3);
  }

  get agentPlaying() {
    const t = this.graph.ctx.currentTime;
    return t >= this.agentFrom && t < this.agentUntil;
  }

  private loop(t: number) {
    if (this.stopped) return;
    const youEnd = this.you.utter(t, 4 + Math.floor(Math.random() * 9));
    const think = 0.35 + Math.random() * 0.9;
    const agentStart = youEnd + think;
    const agentEnd = this.agent.utter(agentStart, 8 + Math.floor(Math.random() * 16));
    this.agentFrom = agentStart;
    this.agentUntil = agentEnd;
    let next = agentEnd + 0.4 + Math.random() * 1.2;
    if (Math.random() < 0.25) {
      // barge-in: you cut the agent off mid-sentence
      const cut = agentStart + (agentEnd - agentStart) * (0.35 + Math.random() * 0.3);
      this.you.utter(cut, 3, 1.4);
      this.agent.silence(cut + 0.25);
      this.agentUntil = cut + 0.25;
      next = cut + 1.4;
    }
    const ms = (next - this.graph.ctx.currentTime - 0.2) * 1000;
    this.timer = window.setTimeout(() => this.loop(next), Math.max(0, ms));
  }

  dispose() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.you.dispose();
    this.agent.dispose();
    this.youOut.disconnect();
  }
}
