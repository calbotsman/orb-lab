import type { ConversationSignal } from "../engine/conversation";
import type { VoiceFeatures } from "../engine/features";

// What the orb "hears". A one-line status ribbon is always up; the full readings — two columns
// of live meters, so you can tell whether a variant is wrong or the signal is — open on demand.

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

const W = 236;
const ROW = 13;
const H = 16 + ROWS.length * ROW + 30;
const LIVE = new Set(["live", "sim", "mic"]);
const STATS = ["overlap", "handoff", "you", "agent", "body", "attn", "inhale", "voice", "nod", "settle"] as const;

const span = (cls: string, text = "") => Object.assign(document.createElement("span"), { className: cls, textContent: text });

export class Hud {
  readonly el: HTMLDivElement;
  private ribbon: HTMLDivElement;
  private dot = span("dot");
  private ribbonText = [span("status"), span(""), span(""), span(""), span("")];
  private stat = {} as Record<(typeof STATS)[number], HTMLSpanElement>;
  private c: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private dpr = Math.min(2, window.devicePixelRatio || 1);

  constructor(parent: HTMLElement) {
    this.ribbon = document.createElement("div");
    this.ribbon.className = "ribbon";
    this.ribbon.append(this.dot, ...this.ribbonText);

    this.el = document.createElement("div");
    this.el.className = "readings hidden";
    this.el.setAttribute("aria-label", "Signal readings");
    const info = document.createElement("div");
    info.className = "readings-info";
    for (const k of STATS) {
      this.stat[k] = span("v");
      info.append(span("k", k), this.stat[k]);
    }
    this.c = document.createElement("canvas");
    this.c.width = W * this.dpr;
    this.c.height = H * this.dpr;
    this.c.style.width = `${W}px`;
    this.c.style.height = `${H}px`;
    this.g = this.c.getContext("2d")!;
    this.el.append(info, this.c);
    parent.append(this.ribbon, this.el);
  }

  get open() {
    return !this.el.classList.contains("hidden");
  }

  toggle(open = !this.open) {
    this.el.classList.toggle("hidden", !open);
    document.body.classList.toggle("reading", open);
  }

  draw(s: ConversationSignal, _mapping: string, status: string) {
    this.dot.classList.toggle("live", LIVE.has(status));
    const [st, phase, who, turn, silence] = this.ribbonText;
    st.textContent = status;
    phase.textContent = s.phase === status ? "" : s.phase;
    who.textContent = s.speaker === "none" ? "quiet" : `${s.speaker} speaking`;
    turn.textContent = `turn ${s.sinceTurnChange.toFixed(1)}s`;
    silence.textContent = `silence ${s.silence.toFixed(1)}s`;
    if (!this.open) return;

    const hz = (f: VoiceFeatures) => (f.voiced > 0.2 && f.pitchHz ? `${f.pitchHz.toFixed(0)} Hz` : "—");
    const b = s.body;
    const vals: Record<(typeof STATS)[number], string> = {
      overlap: s.overlap.toFixed(2), handoff: s.handoff.toFixed(2), you: hz(s.youRaw), agent: hz(s.agent),
      body: b.mode, attn: b.attention.toFixed(2), inhale: b.inhale.toFixed(2),
      voice: b.voice.toFixed(2), nod: b.nod.toFixed(2), settle: b.settle.toFixed(2),
    };
    for (const k of STATS) this.stat[k].textContent = vals[k];

    // ink on paper: read the page's own foreground so dark orbs flip with it
    const css = getComputedStyle(document.body);
    const ink = css.getPropertyValue("--fg").trim() || "#1d1d1f";
    const red = css.getPropertyValue("--live").trim() || "#c4442a";
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.font = "10px ui-monospace, Menlo, monospace";
    g.textBaseline = "middle";
    const colX = [48, 146];
    const w = 88;
    const cols: Array<[string, VoiceFeatures, VoiceFeatures | null]> = [
      ["you", s.you, s.youRaw],
      ["agent", s.agent, null],
    ];
    cols.forEach(([name, f, raw], ci) => {
      const x = colX[ci];
      g.fillStyle = f.active ? red : ink;
      g.globalAlpha = f.active ? 1 : 0.5;
      g.fillText(`${f.active ? "● " : ""}${name}`, x, 6);
      g.fillStyle = ink;
      ROWS.forEach(([, get], ri) => {
        const y = 14 + ri * ROW;
        g.globalAlpha = 0.08;
        g.fillRect(x, y, w, 6);
        if (raw) {
          g.globalAlpha = 0.22; // un-gated mic, behind
          g.fillRect(x, y, w * Math.max(0, Math.min(1, get(raw))), 6);
        }
        g.globalAlpha = 0.85;
        g.fillRect(x, y, w * Math.max(0, Math.min(1, get(f))), 6);
      });
      // mini spectrum
      const sy = 14 + ROWS.length * ROW + 4;
      const bw = w / f.spectrum.length;
      g.globalAlpha = 0.6;
      for (let i = 0; i < f.spectrum.length; i++) {
        const h = f.spectrum[i] * 22;
        g.fillRect(x + i * bw, sy + 22 - h, Math.max(1, bw - 0.5), h);
      }
    });
    g.globalAlpha = 0.5;
    ROWS.forEach(([label], ri) => g.fillText(label, 0, 17 + ri * ROW));
    g.globalAlpha = 1;
  }
}
