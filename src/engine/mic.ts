import type { AudioGraph } from "./audio-graph";
import { downsampleTo16k, pcm16ToBase64 } from "./pcm";

export class Mic {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private tap: AudioWorkletNode | null = null;
  private workletReady = false;

  constructor(private graph: AudioGraph) {}

  get on() {
    return this.stream !== null;
  }

  /** Starts capture. `onChunk` receives 16 kHz PCM16 base64 ready for the relay (or null to only analyse). */
  async start(onChunk: ((b64: string) => void) | null) {
    if (this.stream) return;
    const { ctx } = this.graph;
    if (!this.workletReady) {
      await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}mic-worklet.js`);
      this.workletReady = true;
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.source = ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.graph.youIn);

    this.tap = new AudioWorkletNode(ctx, "mic-tap");
    this.tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (onChunk) onChunk(pcm16ToBase64(downsampleTo16k(e.data, ctx.sampleRate)));
    };
    this.source.connect(this.tap);
  }

  stop() {
    this.tap?.port.close();
    this.tap?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = null;
    this.tap = null;
  }
}
