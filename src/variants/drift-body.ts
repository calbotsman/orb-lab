import * as THREE from "three";
import { makeGrain } from "./grain";
import { NOISE_GLSL } from "./glsl";
import { approach, Temperature, TEMP_PARAMS } from "./temperature";
import { col, num, type ParamValues, type Variant } from "./types";

// Calm pass #2 — one soft body (the Two Bodies look, but singular) floating in a faint
// Warm Drift haze. The agent's voice slowly lobes and swells it; your voice draws it down
// toward you and a low warm light rises from the bottom edge to meet it. Body, halo and haze
// all share the temperature colour.

const fragment = /* glsl */ `
  ${NOISE_GLSL}
  precision highp float;
  uniform vec2 uRes;
  uniform float uTime, uR, uSquash, uSoft, uGlow, uHaze, uRise, uFlow;
  uniform vec2 uC;
  uniform vec3 uLobes;
  uniform vec3 uCol, uWarm, uWhite, uBg;
  varying vec2 vUv;
  void main(){
    vec2 p = (vUv - .5) * uRes / min(uRes.x, uRes.y) * 2.;
    float aspectH = uRes.y / min(uRes.x, uRes.y);
    // haze
    float n1 = fbm(vec3(p * .8 + vec2(uFlow * .35, uFlow * .12), uFlow * .4));
    float n2 = fbm(vec3(p * 1.9 - vec2(uFlow * .2, -uFlow * .3), uFlow * .6 + 5.1));
    float h = clamp(.55 + .5 * n1 + .25 * n2, 0., 1.);
    vec3 c = mix(uBg, uCol, uHaze * h);
    // warm light rising from your edge (the bottom of the screen)
    float fromBottom = p.y + aspectH;
    c = mix(c, uWarm, uRise * exp(-fromBottom * 1.6) * (.7 + .3 * h));
    // the body
    vec2 q = p - uC;
    q.y /= uSquash; q.x *= sqrt(uSquash);
    float a = atan(q.y, q.x);
    float spin = uTime * .18;
    float lobes = uLobes.x * sin(2.*a + spin) + uLobes.y * sin(3.*a - spin*1.3) + uLobes.z * sin(5.*a + spin*.7);
    float d = length(q) - uR * (1. + lobes + .035 * snoise(vec3(q * 2., uTime * .25)));
    vec3 body = mix(uCol, uWhite, smoothstep(0., -uR, d) * .22);
    float fill = smoothstep(uSoft, -uSoft, d);
    float halo = exp(-max(d, 0.) / max(uGlow, .01)) * .35 * (1. - fill);
    c = mix(c, body, fill * .94);
    c = mix(c, uCol, halo);
    gl_FragColor = vec4(c, 1.);
  }
`;

const vertex = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

export const driftBody: Variant = {
  id: "drift-body",
  name: "Drift Body",
  theme: "light",
  group: "Presence",
  mapping: "one soft body in a faint haze · LISTENING → settles toward you and flattens slightly, a warm light rises to meet you, small acknowledging dips · THINKING → draws up tall with an inhale · SPEAKING → lobes and springy syllables from its voice · then a slow exhale · colour = temperature",
  params: {
    baseR: { min: 0.15, max: 0.7, value: 0.34, label: "resting size" },
    bodySize: { min: 0, max: 3, value: 1.3, label: "presence → size" },
    bodyMove: { min: 0, max: 2, value: 1, label: "presence → movement" },
    lobeBass: { min: 0, max: 0.3, value: 0.07, label: "agent bass → 2 lobes" },
    lobeMid: { min: 0, max: 0.3, value: 0.05, label: "agent mid → 3 lobes" },
    lobeHigh: { min: 0, max: 0.15, value: 0.02, label: "agent high → 5 lobes" },
    youSquash: { min: 0, max: 0.3, value: 0.06, label: "listening squash" },
    youRise: { min: 0, max: 0.8, value: 0.35, label: "listening → warm light rises" },
    haze: { min: 0, max: 0.8, value: 0.55, label: "haze strength" },
    hazeFlow: { min: 0, max: 0.4, value: 0.08, label: "haze flow" },
    soft: { min: 0.002, max: 0.15, value: 0.03, label: "edge softness" },
    glow: { min: 0.01, max: 0.5, value: 0.22, label: "halo" },
    grain: { min: 0, max: 0.15, value: 0.05, label: "film grain" },
    ...TEMP_PARAMS,
    bg: { color: "#e2e0dd", label: "background" },
  },

  mount(el: HTMLElement, p: ParamValues) {
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.append(renderer.domElement);
    const grain = makeGrain(el, num(p, "grain"));
    const u = {
      uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uR: { value: 0.34 }, uSquash: { value: 1 },
      uSoft: { value: 0.03 }, uGlow: { value: 0.16 }, uHaze: { value: 0 }, uRise: { value: 0 }, uFlow: { value: 0 },
      uC: { value: new THREE.Vector2() }, uLobes: { value: new THREE.Vector3() },
      uCol: { value: new THREE.Color() }, uWarm: { value: new THREE.Color() }, uWhite: { value: new THREE.Color() },
      uBg: { value: new THREE.Color() },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: u });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    const scene = new THREE.Scene();
    scene.add(quad);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const temp = new Temperature();
    let t = 0, flow = 0, r = 0.34, cx = 0, cy = 0.08, sq = 1, rise = 0;
    const lobes = [0, 0, 0];

    return {
      frame(s, dt) {
        t += dt;
        temp.update(s, p, dt);
        const b = s.body;
        const ag = s.agent;
        const base = num(p, "baseR");
        const move = num(p, "bodyMove");
        r = base * (1 + b.scale * num(p, "bodySize"));
        cx = b.offsetX * base * move;
        cy = 0.08 + b.offsetY * base * move;
        // listening flattens it slightly toward you; the inhale before speaking draws it up tall
        sq = 1 - b.attention * num(p, "youSquash") * (1 - b.inhale) + b.inhale * 0.05 + b.syllable * 0.02;
        rise = approach(rise, b.attention * 0.4 + b.mirror * 1.2, 0.4, dt);
        // lobes only while it is actually voicing, with springy follow-through on syllables
        const voiced = Math.min(1, b.voice * 2.5);
        const lt = [ag.bass * num(p, "lobeBass"), ag.mid * num(p, "lobeMid"), ag.high * num(p, "lobeHigh")];
        for (let i = 0; i < 3; i++) lobes[i] = approach(lobes[i], lt[i] * voiced + Math.abs(b.syllable) * 0.012, 0.18, dt);
        flow += dt * num(p, "hazeFlow");

        u.uTime.value = t;
        u.uFlow.value = flow;
        u.uR.value = r;
        u.uC.value.set(cx, cy);
        u.uSquash.value = sq;
        u.uLobes.value.set(lobes[0], lobes[1], lobes[2]);
        u.uHaze.value = num(p, "haze") * (0.5 + 0.5 * s.live);
        u.uRise.value = rise * num(p, "youRise");
        u.uSoft.value = num(p, "soft");
        u.uGlow.value = num(p, "glow");
        u.uCol.value.copy(temp.color);
        u.uWarm.value.copy(temp.warm);
        u.uWhite.value.set(col(p, "white"));
        u.uBg.value.set(col(p, "bg"));
        grain.frame(dt, num(p, "grain"));
        renderer.render(scene, camera);
      },
      resize(w, h) {
        renderer.setSize(w, h, false);
        u.uRes.value.set(w, h);
      },
      dispose() {
        mat.dispose();
        quad.geometry.dispose();
        renderer.dispose();
      },
    };
  },
};
