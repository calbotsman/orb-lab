import * as THREE from "three";
import { makeGrain } from "./grain";
import { approach, Temperature, TEMP_PARAMS } from "./temperature";
import { col, num, type ParamValues, type Variant } from "./types";

// Calm pass #3 — Grain Duet's colour field on its own, gathered into one soft bloom.
// No particles: just overlapping light-pools that orbit slowly as one presence. Each pool
// listens to a slice of the agent's spectrum, so its voice moves through the bloom from the
// inside; your voice lowers the bloom toward you and lets it open out. Temperature colour.

type Pool = { ang: number; dist: number; r: number; band: number; light: number; spin: number; ph: number };

export const bloom: Variant = {
  id: "bloom",
  name: "Bloom",
  theme: "light",
  group: "Presence",
  mapping: "one soft bloom of light-pools · LISTENING → drifts toward you and opens out with your rhythm, dips at your phrase ends · THINKING → gathers in on an inhale · SPEAKING → each pool swells with its slice of the voice, springy syllables · then settles · colour = temperature",
  params: {
    size: { min: 60, max: 400, value: 190, label: "bloom size" },
    pools: { min: 4, max: 16, step: 1, value: 10, label: "pools (reload variant)" },
    gather: { min: 0, max: 1, value: 0.55, label: "how tightly gathered" },
    agentSwell: { min: 0, max: 1.5, value: 0.6, label: "agent → pools swell" },
    agentBright: { min: 0, max: 1, value: 0.35, label: "agent → brightens" },
    youOpen: { min: 0, max: 1.5, value: 0.55, label: "listening → opens out" },
    bodySize: { min: 0, max: 3, value: 1.4, label: "presence → size" },
    bodyMove: { min: 0, max: 2, value: 1, label: "presence → movement" },
    orbit: { min: 0, max: 0.3, value: 0.05, label: "orbit speed" },
    alpha: { min: 0.05, max: 0.8, value: 0.4, label: "pool opacity" },
    core: { min: 0, max: 0.6, value: 0.22, label: "white core" },
    accents: { min: 0, max: 1, value: 0.2, label: "google accents" },
    grain: { min: 0, max: 0.15, value: 0.05, label: "film grain" },
    ...TEMP_PARAMS,
    bg: { color: "#e2e0dd", label: "background" },
  },

  mount(el: HTMLElement, p: ParamValues) {
    const c = document.createElement("canvas");
    el.append(c);
    const g = c.getContext("2d")!;
    const grain = makeGrain(el, num(p, "grain"));
    const dpr = Math.min(2, window.devicePixelRatio || 1) * 0.5; // soft pools don't need full res
    const temp = new Temperature();
    const ACCENTS = [new THREE.Color("#4285f4"), new THREE.Color("#ea4335"), new THREE.Color("#fbbc04"), new THREE.Color("#34a853")];
    const n = Math.round(num(p, "pools"));
    const pools: Pool[] = Array.from({ length: n }, (_, i) => ({
      ang: (i / n) * Math.PI * 2,
      dist: 0.25 + Math.random() * 0.55,
      r: 0.55 + Math.random() * 0.5,
      band: Math.floor((i / n) * 40) + 2,
      light: [0.1, 0.35, 0.6][i % 3],
      spin: (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.8),
      ph: Math.random() * 6.28,
    }));
    const swells = new Float32Array(n);
    const tmp = new THREE.Color();
    const white = new THREE.Color();
    let W = 1, H = 1, t = 0, open = 0;

    return {
      frame(s, dt) {
        t += dt;
        temp.update(s, p, dt);
        const b = s.body;
        const ag = s.agent;
        open = approach(open, b.attention * 0.3 + b.mirror * 1.2 - b.inhale * 0.2, 0.5, dt);
        const bright = b.voice;
        const voiced = Math.min(1, b.voice * 2.5);

        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.globalCompositeOperation = "source-over";
        g.fillStyle = col(p, "bg");
        g.fillRect(0, 0, W, H);

        const size = num(p, "size") * Math.min(1, Math.min(W, H) / 700) * (1 + b.scale * num(p, "bodySize"));
        const cx = W / 2 + b.offsetX * size * num(p, "bodyMove");
        const cy = H * 0.44 - b.offsetY * size * num(p, "bodyMove");
        const spread = (1 - num(p, "gather")) + open * num(p, "youOpen");
        white.set(col(p, "white"));

        pools.forEach((pl, i) => {
          swells[i] = approach(swells[i], (ag.spectrum[pl.band] ?? 0) * voiced + Math.abs(b.syllable) * 0.15, 0.15, dt);
          const a = pl.ang + t * num(p, "orbit") * pl.spin + Math.sin(t * 0.11 + pl.ph) * 0.25;
          const d = pl.dist * size * spread;
          const x = cx + Math.cos(a) * d;
          const y = cy + Math.sin(a) * d * 0.85;
          const r = pl.r * size * (1 + swells[i] * num(p, "agentSwell"));
          tmp.copy(i % 2 ? temp.warm : temp.cool).lerp(temp.color, 0.45).lerp(white, pl.light * 0.6);
          tmp.lerp(ACCENTS[i % 4], num(p, "accents") * 0.45);
          const rgb = `${(tmp.r * 255) | 0},${(tmp.g * 255) | 0},${(tmp.b * 255) | 0}`;
          const al = num(p, "alpha") * (0.65 + 0.35 * s.live) * (1 + bright * num(p, "agentBright"));
          const gr = g.createRadialGradient(x, y, 0, x, y, r);
          gr.addColorStop(0, `rgba(${rgb},${al})`);
          gr.addColorStop(0.5, `rgba(${rgb},${al * 0.45})`);
          gr.addColorStop(1, `rgba(${rgb},0)`);
          g.fillStyle = gr;
          g.fillRect(x - r, y - r, r * 2, r * 2);
        });

        // soft white core — the bloom's centre of light
        const cr = size * 0.7 * (1 + bright * 0.3);
        const core = num(p, "core") * (0.6 + 0.4 * s.live + bright * num(p, "agentBright"));
        const wr = `${(white.r * 255) | 0},${(white.g * 255) | 0},${(white.b * 255) | 0}`;
        const gc = g.createRadialGradient(cx, cy, 0, cx, cy, cr);
        gc.addColorStop(0, `rgba(${wr},${core})`);
        gc.addColorStop(1, `rgba(${wr},0)`);
        g.fillStyle = gc;
        g.fillRect(cx - cr, cy - cr, cr * 2, cr * 2);

        grain.frame(dt, num(p, "grain"));
      },
      resize(w, h) {
        W = w;
        H = h;
        c.width = Math.max(1, w * dpr);
        c.height = Math.max(1, h * dpr);
      },
      dispose() {},
    };
  },
};
