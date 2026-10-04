// One AudioContext for the whole lab. Two analysis taps:
//   you: mic (and sim-you) → youIn → youAnalyser            (not audible)
//   agent: playback chunks  → agentBus → agentAnalyser → speakers (analysed as heard)
// Because the agent's analyser sits on the playback path, its features line up with what
// you hear, not when each chunk arrives.

export class AudioGraph {
  readonly ctx: AudioContext;
  readonly youIn: GainNode;
  readonly youAnalyser: AnalyserNode;
  readonly agentBus: GainNode;
  readonly agentAnalyser: AnalyserNode;

  constructor() {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    // Created synchronously inside a user gesture so Safari lets it start.
    this.ctx = new Ctor({ latencyHint: "interactive" });

    this.youIn = this.ctx.createGain();
    this.youAnalyser = this.makeAnalyser();
    this.youIn.connect(this.youAnalyser);

    this.agentBus = this.ctx.createGain();
    this.agentAnalyser = this.makeAnalyser();
    this.agentBus.connect(this.agentAnalyser);
    this.agentAnalyser.connect(this.ctx.destination);
  }

  private makeAnalyser() {
    const a = this.ctx.createAnalyser();
    a.fftSize = 2048;
    a.smoothingTimeConstant = 0; // we smooth per-feature ourselves
    a.minDecibels = -100;
    a.maxDecibels = -10;
    return a;
  }

  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }
}
