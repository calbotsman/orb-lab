import { NOISE_GLSL } from "./glsl";
import { makeQuad, SCREEN_GLSL } from "./quad";
import { approach, Temperature, TEMP_PARAMS } from "./temperature";
import { col, num, type ParamValues, type Variant } from "./types";
import * as THREE from "three";

// Halo — a soft ring of light with an open centre. Listening, the side of the ring facing you
// (the bottom) thickens and brightens, as if it's turned its attention down to you. Thinking,
// the centre slowly fills on the inhale. Speaking, the ring's edge ripples with the voice and
// springs on its syllables. Colour is the shared temperature: warm for you, cool for the agent.

const fragment = /* glsl */ `
  ${NOISE_GLSL}
  ${SCREEN_GLSL}
  uniform float uTime, uR, uThick, uFacing, uRipple, uFill, uSoft, uGlow, uSpin;
  uniform vec2 uC;
  uniform vec3 uCol, uWhite, uBg;
  void main(){
    vec2 q = screenP() - uC;
    float r = length(q);
    vec2 dir = q / max(r, 1e-4);
    float a = atan(q.y, q.x);
    // ring thickness: thicker on the side facing you (down) while listening
    float facing = smoothstep(0.1, -1.0, dir.y) * uFacing;
    float wob = uRipple * (0.6 * sin(a * 6.0 + uTime * 2.4 + uSpin) + 0.4 * snoise(vec3(dir * 2.0, uTime * 0.8)));
    float d = abs(r - uR * (1.0 + wob * 0.12)) - uThick * (1.0 + facing * 1.6);
    float ring = smoothstep(uSoft, -uSoft, d);
    float glow = exp(-max(d, 0.0) / max(uGlow, 0.01)) * 0.45;
    // the inhale fills the centre with soft light
    float inner = uFill * exp(-r * r / max(uR * uR * 0.7, 1e-4));
    vec3 c = uBg;
    c = mix(c, uCol, clamp(glow + inner * 0.6, 0.0, 1.0));
    c = mix(c, mix(uCol, uWhite, 0.25 + facing * 0.25), ring * 0.95);
    gl_FragColor = vec4(c, 1.0);
  }
`;

export const halo: Variant = {
  id: "halo",
  name: "Halo",
  theme: "light",
  group: "New",
  mapping: "a soft ring with an open centre · LISTENING → the side facing you thickens and brightens · THINKING → the centre fills on the inhale · SPEAKING → the ring ripples and springs with the voice · colour = temperature",
  params: {
    radius: { min: 0.15, max: 0.8, value: 0.42, label: "ring radius" },
    thickness: { min: 0.005, max: 0.15, value: 0.035, label: "ring thickness" },
    facing: { min: 0, max: 2, value: 1, label: "listening → faces you" },
    ripple: { min: 0, max: 2, value: 1, label: "speaking → ripple" },
    fill: { min: 0, max: 1.5, value: 0.8, label: "thinking → centre fills" },
    bodySize: { min: 0, max: 3, value: 1.1, label: "presence → size" },
    bodyMove: { min: 0, max: 2, value: 0.8, label: "presence → movement" },
    soft: { min: 0.002, max: 0.08, value: 0.012, label: "edge softness" },
    glow: { min: 0.01, max: 0.4, value: 0.09, label: "glow" },
    grain: { min: 0, max: 0.15, value: 0.05, label: "film grain" },
    ...TEMP_PARAMS,
    bg: { color: "#e2e0dd", label: "background" },
  },
  mount(el: HTMLElement, p: ParamValues) {
    const q = makeQuad(el, fragment, {
      uR: { value: 0.4 }, uThick: { value: 0.03 }, uFacing: { value: 0 }, uRipple: { value: 0 }, uFill: { value: 0 },
      uSoft: { value: 0.01 }, uGlow: { value: 0.1 }, uSpin: { value: 0 }, uC: { value: new THREE.Vector2() },
      uCol: { value: new THREE.Color() }, uWhite: { value: new THREE.Color() }, uBg: { value: new THREE.Color() },
    });
    const temp = new Temperature();
    let t = 0, ripple = 0, spin = 0;
    return {
      frame(s, dt) {
        t += dt;
        const b = s.body;
        temp.update(s, p, dt);
        ripple = approach(ripple, Math.min(1, b.voice * 1.4 + Math.abs(b.syllable) * 0.8), 0.12, dt);
        spin += dt * (0.2 + b.voice * 1.2);
        const R = num(p, "radius");
        const u = q.u;
        u.uTime.value = t;
        u.uR.value = R * (1 + b.scale * num(p, "bodySize"));
        u.uThick.value = num(p, "thickness") * (1 + b.voice * 0.6 + b.mirror * 0.5);
        u.uFacing.value = b.attention * num(p, "facing");
        u.uRipple.value = ripple * num(p, "ripple");
        u.uFill.value = (b.inhale + b.settle * 0.3) * num(p, "fill");
        u.uSoft.value = num(p, "soft");
        u.uGlow.value = num(p, "glow") * (1 + b.voice * 0.8);
        u.uSpin.value = spin;
        u.uC.value.set(b.offsetX * R * num(p, "bodyMove"), 0.06 + b.offsetY * R * num(p, "bodyMove"));
        u.uCol.value.copy(temp.color);
        u.uWhite.value.set(col(p, "white"));
        u.uBg.value.set(col(p, "bg"));
        q.render(dt, num(p, "grain"));
      },
      resize: q.resize,
      dispose: q.dispose,
    };
  },
};
