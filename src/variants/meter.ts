import { col, num, type ParamValues, type Variant } from "./types";

// "McIntosh amp meets walkie-talkie". Dark only.
// Inner rim = you (mic hot #00FFAA), outer rim = the agent (AI talking #B238FF), each a radial
// spectrum. The agent's syllables throw rings outward ("fractal outward"); thinking = amber sweep.
// Two VU needles underneath with real ballistics.

type Ring = { r: number; a: number };

export const meter: Variant = {
  id: "meter",
  name: "Meter",
  theme: "dark",
  mapping: "YOU → inner spectrum rim + left needle · AGENT → outer spectrum rim + right needle, syllables throw rings · thinking → amber sweep · silence dims to #3A3A3A",
  params: {
    core: { min: 60, max: 220, value: 120, label: "core radius" },
    rimGap: { min: 10, max: 120, value: 46, label: "rim gap" },
    youReach: { min: 10, max: 160, value: 70, label: "you rim reach" },
    agentReach: { min: 10, max: 220, value: 110, label: "agent rim reach" },
    ringSpeed: { min: 40, max: 600, value: 220, label: "ring speed" },
    ringDecay: { min: 0.3, max: 3, value: 1.2, label: "ring life (s)" },
    needleRise: { min: 0.02, max: 0.6, value: 0.18, label: "needle attack" },
    needleFall: { min: 0.01, max: 0.3, value: 0.06, label: "needle release" },
    glow: { min: 0, max: 40, value: 18, label: "glow" },
    youColor: { color: "#00ffaa", label: "you" },
    agentColor: { color: "#b238ff", label: "agent" },
    thinkColor: { color: "#ffb800", label: "thinking" },
    idleColor: { color: "#3a3a3a", label: "idle" },
  },

  mount(el: HTMLElement, p: ParamValues) {
    const c = document.createElement("canvas");
    el.append(c);
    const g = c.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = 1;
    let H = 1;
    let t = 0;
    let lastBobOnsets = 0;
    const rings: Ring[] = [];
    const needle = { you: 0, agent: 0 };
    let sweep = 0;
    let think = 0;

    const rim = (cx: number, cy: number, r0: number, reach: number, spec: Float32Array, color: string, amt: number, dir: 1 | -1) => {
      const n = spec.length;
      g.strokeStyle = color;
      g.lineCap = "round";
      g.lineWidth = 3;
      g.globalAlpha = 0.25 + amt * 0.75;
      g.beginPath();
      for (let side = 0; side < 2; side++) {
        for (let i = 0; i < n; i++) {
          // mirror the spectrum so lows sit at the top and bottom, highs at the sides
          const frac = (i + 0.5) / n;
          const a = -Math.PI / 2 + (side ? -1 : 1) * frac * Math.PI;
          const len = 2 + spec[i] * reach * amt;
          const x0 = cx + Math.cos(a) * r0;
          const y0 = cy + Math.sin(a) * r0;
          g.moveTo(x0, y0);
          g.lineTo(cx + Math.cos(a) * (r0 + dir * len), cy + Math.sin(a) * (r0 + dir * len));
        }
      }
      g.stroke();
      g.globalAlpha = 1;
    };

    const vu = (x: number, y: number, w: number, v: number, color: string, label: string) => {
      const r = w * 0.5;
      const a0 = -Math.PI * 0.78;
      const a1 = -Math.PI * 0.22;
      g.strokeStyle = "rgba(255,255,255,.18)";
      g.lineWidth = 1;
      g.beginPath();
      g.arc(x, y, r, a0, a1);
      g.stroke();
      for (let i = 0; i <= 10; i++) {
        const a = a0 + (a1 - a0) * (i / 10);
        const hot = i >= 8;
        g.strokeStyle = hot ? "rgba(255,80,60,.7)" : "rgba(255,255,255,.35)";
        g.beginPath();
        g.moveTo(x + Math.cos(a) * (r - 6), y + Math.sin(a) * (r - 6));
        g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        g.stroke();
      }
      const a = a0 + (a1 - a0) * Math.min(1.05, v);
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.shadowColor = color;
      g.shadowBlur = num(p, "glow") * 0.5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * (r + 4), y + Math.sin(a) * (r + 4));
      g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = "rgba(255,255,255,.45)";
      g.font = "600 11px ui-monospace, Menlo, monospace";
      g.textAlign = "center";
      g.fillText(label, x, y - r * 0.35);
    };

    return {
      frame(s, dt) {
        t += dt;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = "#050505";
        g.fillRect(0, 0, W, H);

        const youC = col(p, "youColor");
        const agentC = col(p, "agentColor");
        const cx = W / 2;
        // leave room below for the VU pair + controls
        const scale = Math.min(1, Math.min(W, H - 250) / 620);
        const cy = (H - 220) / 2 + 10;
        const core = num(p, "core") * scale;
        const gap = num(p, "rimGap") * scale;

        // needle ballistics
        const ease = (cur: number, v: number) =>
          cur + (v - cur) * (1 - Math.pow(1 - num(p, v > cur ? "needleRise" : "needleFall"), dt * 60));
        needle.you = ease(needle.you, s.you.level);
        needle.agent = ease(needle.agent, s.agent.level);
        think += ((s.phase === "thinking" ? 1 : 0) - think) * (1 - Math.pow(0.9, dt * 60));
        sweep += dt * 3.2;

        // syllable rings from the agent
        if (s.agent.onsets !== lastBobOnsets) {
          if (s.agent.presence > 0.2) rings.push({ r: core + gap, a: 0.5 + s.agent.peak * 0.5 });
          lastBobOnsets = s.agent.onsets;
        }
        g.lineWidth = 1.5;
        for (let i = rings.length - 1; i >= 0; i--) {
          const ring = rings[i];
          ring.r += num(p, "ringSpeed") * scale * dt;
          ring.a -= dt / num(p, "ringDecay");
          if (ring.a <= 0) {
            rings.splice(i, 1);
            continue;
          }
          g.strokeStyle = agentC;
          g.globalAlpha = ring.a * 0.6;
          g.beginPath();
          g.arc(cx, cy, ring.r, 0, Math.PI * 2);
          g.stroke();
        }
        g.globalAlpha = 1;

        // core: colour = whoever holds the floor
        const active = s.speaker === "you" ? youC : s.speaker === "agent" ? agentC : s.speaker === "both" ? "#ffffff" : col(p, "idleColor");
        const energy = Math.max(s.you.levelSlow, s.agent.levelSlow);
        g.shadowColor = active;
        g.shadowBlur = num(p, "glow") * (0.4 + energy * 2);
        g.strokeStyle = active;
        g.lineWidth = 2 + energy * 4;
        g.globalAlpha = 0.5 + 0.5 * Math.max(energy, s.live * 0.3);
        g.beginPath();
        g.arc(cx, cy, core * (1 + s.you.peak * 0.04 + s.agent.peak * 0.06), 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
        g.shadowBlur = 0;

        // thinking sweep
        if (think > 0.01) {
          g.strokeStyle = col(p, "thinkColor");
          g.globalAlpha = think;
          g.lineWidth = 3;
          g.beginPath();
          g.arc(cx, cy, core - 10 * scale, sweep, sweep + Math.PI * 0.5);
          g.stroke();
          g.globalAlpha = 1;
        }

        // rims
        g.shadowBlur = num(p, "glow") * 0.4;
        g.shadowColor = youC;
        rim(cx, cy, core - 14 * scale, num(p, "youReach") * scale * 0.6, s.you.spectrum, youC, Math.max(s.you.presence, s.you.level), -1);
        g.shadowColor = agentC;
        rim(cx, cy, core + gap, num(p, "agentReach") * scale, s.agent.spectrum, agentC, Math.max(s.agent.presence, s.agent.level), 1);
        g.shadowBlur = 0;

        // VU pair
        const vw = Math.min(170, W * 0.38);
        const vy = H - 140;
        vu(cx - vw * 0.58, vy, vw, needle.you, youC, "YOU");
        vu(cx + vw * 0.58, vy, vw, needle.agent, agentC, "AGENT");
      },
      resize(w, h) {
        W = w;
        H = h;
        c.width = w * dpr;
        c.height = h * dpr;
      },
      dispose() {},
    };
  },
};
