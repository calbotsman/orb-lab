import * as THREE from "three";
import { NOISE_GLSL } from "./glsl";
import { makeQuad, SCREEN_GLSL } from "./quad";
import { approach, Temperature, TEMP_PARAMS } from "./temperature";
import { col, num, type ParamSchema, type ParamValues, type Variant } from "./types";

// Dust on paper — graphite and charcoal orbs.
//
// Modelled the way the real thing forms: a *density* field (how much pigment was laid down —
// a soft disc, mottled where the hand pressed harder, sometimes lighter in the middle) sits on
// a *tooth* field (the paper's fine raised grain). Pigment shows wherever the density beats the
// tooth, so thin areas catch only the tops of the grain — that's what makes the edge dusty and
// lets paper flecks show through the body. The tooth lives in screen pixels and never moves.
//
// Resting it's a still drawing. Listening, it leans toward you and the edge gathers in.
// Thinking, the pigment deepens. Speaking, the edge breathes out with the voice, the mottling
// drifts like dust being worked, and each syllable puffs a little dust off the rim.

const fragment = /* glsl */ `
  ${NOISE_GLSL}
  ${SCREEN_GLSL}
  uniform float uTime, uR, uEdge, uSpread, uMottle, uMottleScale, uDrift, uHollow, uDensity, uToothPx, uToothContrast;
  uniform float uDeep, uSpeck, uTint, uPaperTex, uPuffAng, uPuff, uWander;
  uniform vec2 uC;
  uniform vec3 uPaper, uInk, uTintCol;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  void main(){
    vec2 q = screenP() - uC;
    float r = length(q);
    vec2 dir = q / max(r, 1e-4);
    float ang = atan(q.y, q.x);

    // ── density: soft disc with a wandering, breathing edge ─────────────
    float wander = fbm(vec3(dir * 1.8, 3.1 + uDrift * 0.15)) * 0.08 * uR * uWander;
    float puff = uPuff * exp(-pow(1.0 - cos(ang - uPuffAng), 2.0) * 18.0);   // a dust puff off the rim
    float outer = uR * (1.0 + uSpread) + wander + puff * uR * 0.18;
    float d = 1.0 - smoothstep(outer - uR * uEdge, outer + uR * uEdge * 0.35, r);
    // mottling: where the hand pressed harder
    float m = fbm(vec3(q * uMottleScale / max(uR, 1e-3), uDrift)) + 0.35 * fbm(vec3(q * uMottleScale * 3.1 / max(uR, 1e-3), uDrift + 7.0));
    d *= 1.0 + (m * 1.3) * uMottle;
    // lighter middle (rubbed back), as in charcoal
    d *= 1.0 - uHollow * exp(-(r * r) / (uR * uR * 0.28));
    d = clamp(d * uDensity, 0.0, 1.0);

    // ── tooth: the paper's fixed grain, in device pixels ────────────────
    vec2 px = gl_FragCoord.xy / uToothPx;
    float t1 = vnoise(px);
    float t2 = vnoise(rot(0.7) * px * vec2(0.35, 1.3));        // a little fibre direction
    float t3 = vnoise(rot(2.1) * px * vec2(1.2, 0.3));
    // never fully 0, so bare paper (density 0) can't read as pigment
    float tooth = 0.1 + 0.9 * clamp(0.5 + (t1 * 0.55 + t2 * 0.25 + t3 * 0.2 - 0.5) * uToothContrast, 0.0, 1.0);

    // pigment where density beats the tooth; deep pigment fills the valleys too
    float cover = smoothstep(tooth - 0.2, tooth + 0.2, d);
    float fill = smoothstep(0.55, 1.0, d) * uDeep;
    float pig = clamp(max(cover * (0.3 + 0.7 * d), fill), 0.0, 1.0);

    // stray specks of dust near (and occasionally beyond) the rim
    float sh = hash(floor(gl_FragCoord.xy / max(uToothPx, 1.0)) + 9.7);
    float speck = step(1.0 - uSpeck * 0.004 * smoothstep(outer + uR * 0.6, outer - uR * 0.2, r), sh);
    pig = max(pig, speck * 0.6);

    vec3 ink = mix(uInk, uTintCol, uTint);
    float paperGrain = (tooth - 0.55) * 0.03 * uPaperTex;
    vec3 paper = uPaper + paperGrain;
    gl_FragColor = vec4(mix(paper, ink, pig), 1.0);
  }
`;

type Look = { id: string; name: string; mapping: string; defaults: Record<string, number | string> };

function dustOrb(look: Look): Variant {
  const d = look.defaults;
  const params: ParamSchema = {
    radius: { min: 0.15, max: 0.8, value: d.radius as number, label: "disc size" },
    edge: { min: 0.05, max: 0.8, value: d.edge as number, label: "edge softness" },
    wander: { min: 0, max: 2, value: d.wander as number, label: "edge wander" },
    mottle: { min: 0, max: 1, value: d.mottle as number, label: "mottling (pressure)" },
    mottleScale: { min: 0.5, max: 6, value: d.mottleScale as number, label: "mottle scale" },
    hollow: { min: 0, max: 0.8, value: d.hollow as number, label: "lighter middle" },
    density: { min: 0.3, max: 1.6, value: d.density as number, label: "pigment density" },
    deep: { min: 0, max: 1, value: d.deep as number, label: "deep fill" },
    toothPx: { min: 0.6, max: 4, value: d.toothPx as number, label: "paper grain size (px)" },
    toothContrast: { min: 0.5, max: 3, value: d.toothContrast as number, label: "paper grain contrast" },
    speck: { min: 0, max: 3, value: d.speck as number, label: "stray dust specks" },
    breath: { min: 0, max: 0.4, value: 0.12, label: "speaking → edge breathes out" },
    drift: { min: 0, max: 2, value: 0.6, label: "speaking → dust drifts" },
    puff: { min: 0, max: 2, value: 1, label: "syllables → dust puffs" },
    bodySize: { min: 0, max: 3, value: 1, label: "presence → size" },
    bodyMove: { min: 0, max: 2, value: 0.6, label: "presence → movement" },
    tint: { min: 0, max: 1, value: 0, label: "warm/cool tint" },
    paperTex: { min: 0, max: 2, value: 0.7, label: "paper texture" },
    ...TEMP_PARAMS,
    ink: { color: d.ink as string, label: "pigment" },
    paper: { color: d.paper as string, label: "paper" },
  };
  return {
    id: look.id,
    name: look.name,
    theme: "light",
    group: "New",
    mapping: look.mapping,
    params,
    mount(el: HTMLElement, p: ParamValues) {
      const q = makeQuad(
        el,
        fragment,
        {
          uR: { value: 0.45 }, uEdge: { value: 0.3 }, uSpread: { value: 0 }, uMottle: { value: 0 }, uMottleScale: { value: 2 },
          uDrift: { value: 0 }, uHollow: { value: 0 }, uDensity: { value: 1 }, uToothPx: { value: 1.4 }, uToothContrast: { value: 1 },
          uWander: { value: 1 }, uDeep: { value: 0.5 }, uSpeck: { value: 1 }, uTint: { value: 0 }, uPaperTex: { value: 1 }, uPuffAng: { value: 0 }, uPuff: { value: 0 },
          uC: { value: new THREE.Vector2() },
          uPaper: { value: new THREE.Color() }, uInk: { value: new THREE.Color() }, uTintCol: { value: new THREE.Color() },
        },
        0, // all texture is in the shader
      );
      const temp = new Temperature();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let t = 0, drift = 0, spread = 0, puff = 0, puffAng = 0, lastOnsets = 0;
      return {
        frame(s, dt) {
          t += dt;
          const b = s.body;
          temp.update(s, p, dt);
          const listening = b.mode === "listen" || b.mode === "yield";
          // the edge breathes out with the voice and gathers in while it listens
          spread = approach(spread, b.voice * num(p, "breath") - (listening ? b.attention * 0.04 : 0) + b.breath * 0.01, 0.2, dt);
          drift += dt * (0.01 + b.voice * num(p, "drift") * 0.5);
          // each agent syllable puffs dust off a random point of the rim
          if (s.agent.onsets !== lastOnsets) {
            if (b.mode === "speak") {
              puff = Math.min(1.2, puff + 0.6 * num(p, "puff"));
              puffAng = Math.random() * Math.PI * 2;
            }
            lastOnsets = s.agent.onsets;
          }
          puff *= Math.exp(-dt / 0.35);
          const R = num(p, "radius");
          const u = q.u;
          u.uTime.value = t;
          u.uR.value = R * (1 + b.scale * num(p, "bodySize"));
          u.uEdge.value = num(p, "edge");
          u.uWander.value = num(p, "wander");
          u.uSpread.value = spread;
          u.uMottle.value = num(p, "mottle");
          u.uMottleScale.value = num(p, "mottleScale");
          u.uDrift.value = drift;
          u.uHollow.value = num(p, "hollow");
          u.uDensity.value = num(p, "density") * (1 + b.inhale * 0.15);
          u.uDeep.value = num(p, "deep");
          u.uToothPx.value = num(p, "toothPx") * dpr;
          u.uToothContrast.value = num(p, "toothContrast");
          u.uSpeck.value = num(p, "speck");
          u.uTint.value = num(p, "tint");
          u.uPaperTex.value = num(p, "paperTex");
          u.uPuff.value = puff;
          u.uPuffAng.value = puffAng;
          u.uC.value.set(b.offsetX * R * num(p, "bodyMove"), 0.06 + b.offsetY * R * num(p, "bodyMove"));
          u.uPaper.value.set(col(p, "paper"));
          u.uInk.value.set(col(p, "ink"));
          u.uTintCol.value.copy(temp.color);
          q.render(dt, 0);
        },
        resize: q.resize,
        dispose: q.dispose,
      };
    },
  };
}

const MAPPING_TAIL =
  " · REST → a still drawing · LISTENING → leans toward you, the edge gathers in · THINKING → pigment deepens · SPEAKING → the edge breathes out, dust drifts, syllables puff dust off the rim";

/** Fine sprayed graphite: even grey, soft haze edge. */
export const graphite = dustOrb({
  id: "graphite",
  name: "Graphite",
  mapping: "an even disc of sprayed graphite on paper" + MAPPING_TAIL,
  defaults: {
    radius: 0.62, edge: 0.2, wander: 0.15, mottle: 0.08, mottleScale: 2.5, hollow: 0, density: 0.9, deep: 0.6,
    toothPx: 0.9, toothContrast: 1.2, speck: 0.5, ink: "#6a6864", paper: "#f1eee6",
  },
});

/** Rubbed charcoal: dark, mottled where the hand pressed, lighter in the middle, dusty edge. */
export const charcoal = dustOrb({
  id: "charcoal",
  name: "Charcoal",
  mapping: "a rubbed charcoal disc: dark, mottled, lighter in the middle" + MAPPING_TAIL,
  defaults: {
    radius: 0.6, edge: 0.55, wander: 1, mottle: 0.32, mottleScale: 1.6, hollow: 0.3, density: 0.95, deep: 0.3,
    toothPx: 1.0, toothContrast: 1.5, speck: 1.2, ink: "#2c2a27", paper: "#f0ebdf",
  },
});
