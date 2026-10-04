import * as THREE from "three";
import { makeGrain } from "./grain";
import { NOISE_GLSL } from "./glsl";
import { col, num, type ParamValues, type Variant } from "./types";

// One body — the agent. You don't get a body; your words do. Each syllable you speak rises from
// the bottom of the screen (where you are) as a droplet and gets absorbed, tinting it.
// When it talks it grows lobes from its own spectrum; when it listens it leans down toward you.

const MAX_DROPS = 16;

const fragment = /* glsl */ `
  ${NOISE_GLSL}
  precision highp float;
  uniform vec2 uRes;
  uniform float uTime, uR, uSquash, uFuse, uSoft, uGlow, uTint, uThink;
  uniform vec2 uC;
  uniform vec3 uLobes; // bass, mid, high amplitudes
  uniform vec4 uDrops[${MAX_DROPS}];
  uniform vec3 uBobCol, uYouCol, uBg;
  varying vec2 vUv;
  float smin(float a, float b, float k){ float h = clamp(.5 + .5*(b-a)/k, 0., 1.); return mix(b, a, h) - k*h*(1.-h); }
  void main(){
    vec2 p = (vUv - .5) * uRes / min(uRes.x, uRes.y) * 2.;
    vec2 q = p - uC;
    q.y /= uSquash; q.x *= sqrt(uSquash);
    float a = atan(q.y, q.x);
    float spin = uTime * (.25 + uThink * 1.2);
    float lobes = uLobes.x * sin(2.*a + spin) + uLobes.y * sin(3.*a - spin*1.3) + uLobes.z * sin(7.*a + spin*2.1);
    float d = length(q) - uR * (1. + lobes + .04 * snoise(vec3(q*2.2, uTime*.4)));
    float you = 0.;
    for (int i = 0; i < ${MAX_DROPS}; i++) {
      vec4 dr = uDrops[i];
      if (dr.z <= 0.) continue;
      float dd = length(p - dr.xy) - dr.z;
      float h = clamp(.5 + .5*(dd - d)/uFuse, 0., 1.);
      you = max(you, h);
      d = smin(d, dd, uFuse);
    }
    vec3 c = mix(uBobCol, uYouCol, clamp(max(you, uTint), 0., 1.));
    c = mix(c, vec3(1.), smoothstep(0., -uR, d) * .38);
    float fill = smoothstep(uSoft, -uSoft, d);
    float halo = exp(-max(d, 0.) / max(uGlow, .01)) * .3 * (1. - fill);
    vec3 col = mix(uBg, c, fill * .93);
    col = mix(col, c, halo);
    gl_FragColor = vec4(col, 1.);
  }
`;

const vertex = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

export const oneBody: Variant = {
  id: "one-body",
  name: "One Body",
  theme: "light",
  mapping: "AGENT → size (level), lobes (bass/mid/high), spin (thinking) · YOU → each syllable rises from below as a droplet it absorbs; it leans down + squashes to listen; your colour tints it",
  params: {
    baseR: { min: 0.15, max: 0.7, value: 0.36, label: "resting size" },
    levelR: { min: 0, max: 0.5, value: 0.18, label: "agent level → size" },
    lobeBass: { min: 0, max: 0.4, value: 0.1, label: "agent bass → 2 lobes" },
    lobeMid: { min: 0, max: 0.4, value: 0.08, label: "agent mid → 3 lobes" },
    lobeHigh: { min: 0, max: 0.2, value: 0.03, label: "agent high → 7 ripples" },
    lean: { min: 0, max: 0.6, value: 0.16, label: "listening lean" },
    squash: { min: 0, max: 0.4, value: 0.1, label: "listening squash" },
    dropSize: { min: 0.01, max: 0.15, value: 0.05, label: "your droplet size" },
    dropSpeed: { min: 0.2, max: 4, value: 1.3, label: "droplet rise speed" },
    tint: { min: 0, max: 1, value: 0.45, label: "absorb tint" },
    fuse: { min: 0.02, max: 0.4, value: 0.16, label: "merge softness" },
    soft: { min: 0.002, max: 0.15, value: 0.025, label: "edge softness" },
    glow: { min: 0.01, max: 0.5, value: 0.14, label: "halo" },
    ease: { min: 0.02, max: 0.5, value: 0.12, label: "motion ease" },
    grain: { min: 0, max: 0.15, value: 0.05, label: "film grain" },
    agentColor: { color: "#f6a609", label: "agent" },
    youColor: { color: "#4285f4", label: "you" },
    bg: { color: "#e2e0dd", label: "background" },
  },

  mount(el: HTMLElement, p: ParamValues) {
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.append(renderer.domElement);
    const grain = makeGrain(el, num(p, "grain"));
    const drops = Array.from({ length: MAX_DROPS }, () => new THREE.Vector4(0, 0, 0, 0));
    const vel = Array.from({ length: MAX_DROPS }, () => 0);
    const u = {
      uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uR: { value: 0.36 }, uSquash: { value: 1 },
      uFuse: { value: 0.16 }, uSoft: { value: 0.025 }, uGlow: { value: 0.14 }, uTint: { value: 0 }, uThink: { value: 0 },
      uC: { value: new THREE.Vector2() }, uLobes: { value: new THREE.Vector3() }, uDrops: { value: drops },
      uBobCol: { value: new THREE.Color() }, uYouCol: { value: new THREE.Color() }, uBg: { value: new THREE.Color() },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: u });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    const scene = new THREE.Scene();
    scene.add(quad);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    let t = 0;
    let r = 0.36;
    let cy = 0.05;
    let sq = 1;
    let tint = 0;
    let think = 0;
    const lobes = [0, 0, 0];
    let lastOnsets = 0;
    let next = 0;
    let bottom = -1.2;

    return {
      frame(s, dt) {
        t += dt;
        const k = 1 - Math.pow(1 - num(p, "ease"), dt * 60);
        const agent = s.agent;
        const you = s.you;
        const breathe = 0.012 * Math.sin(t * 0.9);
        r += (num(p, "baseR") + agent.levelSlow * num(p, "levelR") + agent.peak * 0.05 + breathe - r) * k;
        cy += (0.05 - you.presence * num(p, "lean") - cy) * k;
        sq += (1 - you.presence * num(p, "squash") + agent.presence * (agent.pitch - 0.5) * 0.2 - sq) * k;
        const lt = [agent.bass * num(p, "lobeBass"), agent.mid * num(p, "lobeMid"), agent.high * num(p, "lobeHigh")];
        for (let i = 0; i < 3; i++) lobes[i] += (lt[i] * agent.presence + agent.onset * 0.02 - lobes[i]) * k;
        think += ((s.phase === "thinking" ? 1 : 0) - think) * k * 0.5;

        // your syllables → droplets rising from below
        if (you.onsets !== lastOnsets) {
          if (you.active) {
            const d = drops[next];
            d.set((Math.random() - 0.5) * 0.9, bottom, num(p, "dropSize") * (0.6 + you.peak * 1.2), 1);
            vel[next] = 0;
            next = (next + 1) % MAX_DROPS;
          }
          lastOnsets = you.onsets;
        }
        drops.forEach((d, i) => {
          if (d.z <= 0) return;
          // accelerate toward the agent's centre; absorbed once inside
          vel[i] = Math.min(num(p, "dropSpeed"), vel[i] + dt * num(p, "dropSpeed") * 2);
          const dx = -d.x;
          const dy = cy - d.y;
          const dist = Math.hypot(dx, dy);
          d.x += (dx / (dist || 1)) * vel[i] * dt * 0.6;
          d.y += (dy / (dist || 1)) * vel[i] * dt;
          if (dist < r * 0.6) {
            d.z *= Math.pow(0.85, dt * 60);
            tint = Math.min(1, tint + dt * 3 * num(p, "tint"));
            if (d.z < 0.004) d.z = 0;
          }
        });
        tint *= Math.pow(0.985, dt * 60);

        u.uTime.value = t;
        u.uR.value = r;
        u.uC.value.set(0, cy);
        u.uSquash.value = sq;
        u.uLobes.value.set(lobes[0], lobes[1], lobes[2]);
        u.uFuse.value = num(p, "fuse");
        u.uSoft.value = num(p, "soft");
        u.uGlow.value = num(p, "glow");
        u.uTint.value = tint * num(p, "tint");
        u.uThink.value = think;
        u.uBobCol.value.set(col(p, "agentColor"));
        u.uYouCol.value.set(col(p, "youColor"));
        u.uBg.value.set(col(p, "bg"));
        grain.frame(dt, num(p, "grain"));
        renderer.render(scene, camera);
      },
      resize(w, h) {
        renderer.setSize(w, h, false);
        u.uRes.value.set(w, h);
        bottom = -(h / Math.min(w, h)) - 0.1;
      },
      dispose() {
        mat.dispose();
        quad.geometry.dispose();
        renderer.dispose();
      },
    };
  },
};
