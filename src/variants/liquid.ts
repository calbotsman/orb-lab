import { NOISE_GLSL } from "./glsl";
import { makeQuad, SCREEN_GLSL } from "./quad";
import { approach, Temperature, TEMP_PARAMS } from "./temperature";
import { col, num, type ParamValues, type Variant } from "./types";
import * as THREE from "three";

// Liquid — one droplet with marbled colour moving inside it. Listening, it sags toward you like
// a drop leaning on gravity, and its inner currents slow to a drift. Speaking, the currents run
// and the surface trembles with the voice, springing on syllables. Warm and cool bands of the
// temperature palette swirl together, so the mix shows who has been talking.

const fragment = /* glsl */ `
  ${NOISE_GLSL}
  ${SCREEN_GLSL}
  uniform float uTime, uR, uSag, uTremble, uFlow, uSoft, uGlow, uWarmMix;
  uniform vec2 uC;
  uniform vec3 uWarm, uCool, uWhite, uBg;
  void main(){
    vec2 p = screenP();
    vec2 q = p - uC;
    // gravity toward you: wider and flatter at the bottom
    float below = clamp(-q.y / max(uR, 1e-3), 0.0, 1.0);
    q.x /= 1.0 + uSag * below * 0.5;
    q.y *= 1.0 + uSag * 0.25;
    float a = atan(q.y, q.x);
    float tr = uTremble * (0.5 * sin(a * 7.0 + uTime * 5.0) + 0.5 * snoise(vec3(q * 3.0, uTime * 1.3)));
    float d = length(q) - uR * (1.0 + tr * 0.06);
    float fill = smoothstep(uSoft, -uSoft, d);
    // marbling: domain-warped noise flowing inside the drop
    vec2 w = q * 2.2;
    vec2 warp = vec2(fbm(vec3(w, uFlow * 0.6)), fbm(vec3(w + 4.7, uFlow * 0.6)));
    float m = fbm(vec3(w + warp * 1.6, uFlow * 0.35));
    float band = smoothstep(-0.55, 0.55, m + (uWarmMix - 0.5) * 0.9);
    vec3 inside = mix(uCool, uWarm, band);
    inside = mix(inside, uWhite, 0.32 + smoothstep(0.3, 0.6, abs(m)) * 0.3);
    // soft lit rim and a highlight up-left
    inside = mix(inside, uWhite, smoothstep(-uR * 0.6, 0.0, d) * 0.18);
    float hl = exp(-dot(q - vec2(-0.35, 0.4) * uR, q - vec2(-0.35, 0.4) * uR) / (uR * uR * 0.05));
    inside += hl * 0.25;
    float halo = exp(-max(d, 0.0) / max(uGlow, 0.01)) * 0.3 * (1.0 - fill);
    vec3 c = mix(uBg, inside, fill);
    c = mix(c, mix(uWarm, uCool, 1.0 - uWarmMix), halo);
    gl_FragColor = vec4(c, 1.0);
  }
`;

export const liquid: Variant = {
  id: "liquid",
  name: "Liquid",
  theme: "light",
  group: "New",
  mapping: "one droplet with marbled colour inside · LISTENING → sags toward you, currents slow · THINKING → draws itself up · SPEAKING → currents run, surface trembles and springs · the warm/cool marbling shows who has been talking",
  params: {
    radius: { min: 0.15, max: 0.7, value: 0.36, label: "drop size" },
    sag: { min: 0, max: 1.5, value: 0.7, label: "listening → sags toward you" },
    tremble: { min: 0, max: 2, value: 1, label: "speaking → surface tremble" },
    flow: { min: 0, max: 2, value: 0.9, label: "speaking → inner currents" },
    restFlow: { min: 0, max: 0.5, value: 0.08, label: "resting drift" },
    bodySize: { min: 0, max: 3, value: 1.2, label: "presence → size" },
    bodyMove: { min: 0, max: 2, value: 0.8, label: "presence → movement" },
    soft: { min: 0.002, max: 0.08, value: 0.012, label: "edge softness" },
    glow: { min: 0.01, max: 0.4, value: 0.12, label: "halo" },
    grain: { min: 0, max: 0.15, value: 0.05, label: "film grain" },
    ...TEMP_PARAMS,
    bg: { color: "#e2e0dd", label: "background" },
  },
  mount(el: HTMLElement, p: ParamValues) {
    const q = makeQuad(el, fragment, {
      uR: { value: 0.36 }, uSag: { value: 0 }, uTremble: { value: 0 }, uFlow: { value: 0 }, uSoft: { value: 0.012 },
      uGlow: { value: 0.12 }, uWarmMix: { value: 0.6 }, uC: { value: new THREE.Vector2() },
      uWarm: { value: new THREE.Color() }, uCool: { value: new THREE.Color() }, uWhite: { value: new THREE.Color() },
      uBg: { value: new THREE.Color() },
    });
    const temp = new Temperature();
    let t = 0, flow = 0, sag = 0, tremble = 0;
    return {
      frame(s, dt) {
        t += dt;
        const b = s.body;
        temp.update(s, p, dt);
        sag = approach(sag, b.attention * (b.mode === "listen" || b.mode === "yield" ? 1 : 0.2) - b.inhale * 0.6, 0.5, dt);
        tremble = approach(tremble, Math.min(1, b.voice * 1.3 + Math.abs(b.syllable) * 0.9), 0.1, dt);
        flow += dt * (num(p, "restFlow") + b.voice * num(p, "flow") + b.mirror * 0.15);
        const R = num(p, "radius");
        const u = q.u;
        u.uTime.value = t;
        u.uR.value = R * (1 + b.scale * num(p, "bodySize"));
        u.uSag.value = sag * num(p, "sag");
        u.uTremble.value = tremble * num(p, "tremble");
        u.uFlow.value = flow;
        u.uSoft.value = num(p, "soft");
        u.uGlow.value = num(p, "glow");
        u.uWarmMix.value = 0.5 + temp.temp * 0.5;
        u.uC.value.set(b.offsetX * R * num(p, "bodyMove"), 0.06 + b.offsetY * R * num(p, "bodyMove"));
        u.uWarm.value.copy(temp.warm);
        u.uCool.value.copy(temp.cool);
        u.uWhite.value.set(col(p, "white"));
        u.uBg.value.set(col(p, "bg"));
        q.render(dt, num(p, "grain"));
      },
      resize: q.resize,
      dispose: q.dispose,
    };
  },
};
