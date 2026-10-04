import type { ConversationSignal } from "../engine/conversation";
import type { VoiceFeatures } from "../engine/features";

// What the orb "hears": two columns of live meters so you can tell whether a variant
// is wrong or the signal is.

const ROWS: Array<[string, (f: VoiceFeatures) => number]> = [
  ["level", (f) => f.level],
  ["peak", (f) => f.peak],
  ["bass", (f) => f.bass],
  ["mid", (f) => f.mid],
  ["high", (f) => f.high],
  ["pitch", (f) => f.pitch],
  ["inton.", (f) => f.pitchDelta * 0.5 + 0.5],
  ["bright", (f) => f.brightness],
  ["onset", (f) => f.onset],
  ["rate", (f) => f.rate],
];

export class Hud {
  readonly el: HTMLDivElement;
  private c: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private info: HTMLDivElement;
  private dpr = Math.min(2, window.devicePixelRatio || 1);

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "hud";
    this.info = document.createElement("div");
    this.info.className = "hud-info";
    this.c = document.createElement("canvas");
    this.c.width = 260 * this.dpr;
    this.c.height = (ROWS.length * 14 + 50) * this.dpr;
    this.c.style.width = "260px";
    this.c.style.height = `${ROWS.length * 14 + 50}px`;
    this.g = this.c.getContext("2d")!;
    this.el.append(this.info, this.c);
    parent.append(this.el);
  }

  toggle() {
    this.el.classList.toggle("hidden");
  }

  draw(s: ConversationSignal, mapping: string, status: string) {
    if (this.el.classList.contains("hidden")) return;
    const hz = (f: VoiceFeatures) => (f.voiced > 0.2 && f.pitchHz ? `${f.pitchHz.toFixed(0)}Hz` : "—");
    this.info.innerHTML =
      `<b>${s.phase}</b> · speaker <b>${s.speaker}</b> · ${status}<br>` +
      `turn ${s.sinceTurnChange.toFixed(1)}s · silence ${s.silence.toFixed(1)}s · overlap ${s.overlap.toFixed(2)} · handoff ${s.handoff.toFixed(2)}<br>` +
      `you ${hz(s.youRaw)} · agent ${hz(s.agent)}<br>` +
      `body <b>${s.body.mode}</b> · attn ${s.body.attention.toFixed(2)} · inhale ${s.body.inhale.toFixed(2)} · voice ${s.body.voice.toFixed(2)} · nod ${s.body.nod.toFixed(2)} · settle ${s.body.settle.toFixed(2)}<br>` +
      `<span class="map">${mapping}</span>`;

    const g = this.g;
    const d = this.dpr;
    g.setTransform(d, 0, 0, d, 0, 0);
    g.clearRect(0, 0, 260, 400);
    g.font = "10px ui-monospace, Menlo, monospace";
    g.textBaseline = "middle";
    const colX = [52, 156];
    const w = 96;
    const cols: Array<[string, VoiceFeatures, VoiceFeatures | null, string]> = [
      ["YOU", s.you, s.youRaw, "#00d68f"],
      ["AGENT", s.agent, null, "#a64dff"],
    ];
    cols.forEach(([name, f, raw, color], ci) => {
      const x = colX[ci];
      g.fillStyle = f.active ? color : "rgba(128,128,128,.8)";
      g.fillText(`${name}${f.active ? " ●" : ""}`, x, 7);
      ROWS.forEach(([, get], ri) => {
        const y = 18 + ri * 14;
        g.fillStyle = "rgba(128,128,128,.18)";
        g.fillRect(x, y, w, 9);
        if (raw) {
          g.fillStyle = "rgba(128,128,128,.35)"; // un-gated mic, behind
          g.fillRect(x, y, w * Math.max(0, Math.min(1, get(raw))), 9);
        }
        g.fillStyle = color;
        g.fillRect(x, y, w * Math.max(0, Math.min(1, get(f))), 9);
      });
      // mini spectrum
      const sy = 18 + ROWS.length * 14 + 4;
      const bw = w / f.spectrum.length;
      g.fillStyle = color;
      for (let i = 0; i < f.spectrum.length; i++) {
        const h = f.spectrum[i] * 24;
        g.fillRect(x + i * bw, sy + 24 - h, Math.max(1, bw - 0.5), h);
      }
    });
    g.fillStyle = "rgba(128,128,128,.9)";
    ROWS.forEach(([label], ri) => g.fillText(label, 0, 22 + ri * 14));
  }
}
