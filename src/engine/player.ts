import type { AudioGraph } from "./audio-graph";
import { base64Pcm16ToFloat32 } from "./pcm";

/** Gapless 24 kHz playback routed through the agent's analyser bus. */
export class Player {
  private nextStart = 0;
  private active = new Set<AudioBufferSourceNode>();
  playing = false;

  constructor(private graph: AudioGraph, private onPlayingChange?: (p: boolean) => void) {}

  enqueue(b64: string) {
    if (!b64) return;
    const { ctx } = this.graph;
    const data = base64Pcm16ToFloat32(b64);
    const buf = ctx.createBuffer(1, data.length, 24000);
    buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.graph.agentBus);

    const start = Math.max(ctx.currentTime + 0.02, this.nextStart);
    this.nextStart = start + buf.duration;
    this.active.add(src);
    this.setPlaying(true);
    src.onended = () => {
      this.active.delete(src);
      src.disconnect();
      if (this.active.size === 0) {
        this.nextStart = ctx.currentTime;
        this.setPlaying(false);
      }
    };
    src.start(start);
  }

  /** Barge-in: drop everything queued. */
  stop() {
    for (const s of this.active) {
      try {
        s.stop();
      } catch {
        /* already ended */
      }
    }
    this.active.clear();
    this.nextStart = this.graph.ctx.currentTime;
    this.setPlaying(false);
  }

  private setPlaying(p: boolean) {
    if (p !== this.playing) {
      this.playing = p;
      this.onPlayingChange?.(p);
    }
  }
}
