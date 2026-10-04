import * as THREE from "three";
import { makeGrain } from "./grain";
import { NOISE_GLSL } from "./glsl";
import { col, num, type ParamValues, type Variant } from "./types";

// Two soft bodies — you (left) and the agent (right). Size follows loudness, height follows pitch,
// tilt follows intonation, surface wobble follows syllables. The listener leans toward the
// speaker; on a handoff or an overlap they pinch together and fuse.

const fragment = /* glsl */ `
  ${NOISE_GLSL}
  precision highp float;
  uniform vec2 uRes;
  uniform float uTime, uFuse, uSoft, uGlow;
  uniform vec4 uYou, uBob;          // x, y, radius, wobble
  uniform vec2 uYouShape, uBobShape; // stretch, tilt
  uniform vec3 uYouCol, uBobCol, uBg;
  varying vec2 vUv;

  float smin(float a, float b, float k){ float h = clamp(.5 + .5*(b-a)/k, 0., 1.); return mix(b, a, h) - k*h*(1.-h); }

  float body(vec2 p, vec4 b, vec2 shape, float seed){
    vec2 q = p - b.xy;
    float c = cos(shape.y), s = sin(shape.y);
    q = mat2(c, -s, s, c) * q;
    q.y /= shape.x; q.x *= sqrt(shape.x);
    float a = atan(q.y, q.x);
    float w = b.w * b.z * (.55*sin(a*5. + uTime*2.3 + seed) + .45*snoise(vec3(q*3.2, uTime*.7 + seed)));
    return length(q) - b.z + w;
  }

  void main(){
    vec2 p = (vUv - .5) * uRes / min(uRes.x, uRes.y) * 2.;
    float dy = body(p, uYou, uYouShape, 0.);
    float db = body(p, uBob, uBobShape, 7.3);
    float k = uFuse;
    float d = smin(dy, db, k);
    float h = clamp(.5 + .5*(db - dy)/max(k, 1e-3), 0., 1.); // 1 = you, 0 = agent
    vec3 c = mix(uBobCol, uYouCol, h);
    float r = mix(uBob.z, uYou.z, h);
    c = mix(c, vec3(1.), smoothstep(0., -r, d) * .35);       // lighter core
    float fill = smoothstep(uSoft, -uSoft, d);
    float halo = exp(-max(d, 0.) * (1. / max(uGlow, .01))) * .28 * (1. - fill);
    vec3 col = mix(uBg, c, fill * .92);
    col = mix(col, c, halo);
    gl_FragColor = vec4(col, 1.);
  }
`;

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }
`;

export const twoBodies: Variant = {
  id: "two-bodies",
  name: "Two Bodies",
  theme: "light",
  mapping: "EACH VOICE → body size (level+peak), height (pitch), tilt (intonation), wobble (syllables) · listener leans in · handoff/overlap → pinch & fuse",
  params: {
    sep: { min: 0.2, max: 1.2, value: 0.62, label: "separation" },
    baseR: { min: 0.08, max: 0.5, value: 0.2, label: "resting size" },
    levelR: { min: 0, max: 0.6, value: 0.26, label: "level → size" },
    peakR: { min: 0, max: 0.4, value: 0.08, label: "peak → size" },
    lean: { min: 0, max: 0.6, value: 0.2, label: "listener leans" },
    stretch: { min: 0, max: 1.5, value: 0.6, label: "pitch → height" },
    tilt: { min: 0, max: 1.2, value: 0.35, label: "intonation → tilt" },
    wobble: { min: 0, max: 0.4, value: 0.05, label: "rest wobble" },
    onsetWobble: { min: 0, max: 0.6, value: 0.2, label: "syllable → wobble" },
    fuse: { min: 0.02, max: 0.6, value: 0.12, label: "resting pull" },
    fuseHandoff: { min: 0, max: 1, value: 0.45, label: "handoff → fuse" },
    fuseOverlap: { min: 0, max: 1, value: 0.6, label: "overlap → fuse" },
    soft: { min: 0.002, max: 0.15, value: 0.03, label: "edge softness" },
    glow: { min: 0.01, max: 0.5, value: 0.12, label: "halo" },
    ease: { min: 0.02, max: 0.5, value: 0.14, label: "motion ease" },
    grain: { min: 0, max: 0.15, value: 0.05, label: "film grain" },
    youColor: { color: "#4285f4", label: "you" },
    agentColor: { color: "#f6a609", label: "agent" },
    bg: { color: "#e2e0dd", label: "background" },
  },

  mount(el: HTMLElement, p: ParamValues) {
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.append(renderer.domElement);
    const grain = makeGrain(el, num(p, "grain"));
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const u = {
      uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uFuse: { value: 0.1 },
      uSoft: { value: 0.03 }, uGlow: { value: 0.12 },
      uYou: { value: new THREE.Vector4() }, uBob: { value: new THREE.Vector4() },
      uYouShape: { value: new THREE.Vector2(1, 0) }, uBobShape: { value: new THREE.Vector2(1, 0) },
      uYouCol: { value: new THREE.Color() }, uBobCol: { value: new THREE.Color() }, uBg: { value: new THREE.Color() },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: u });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    scene.add(quad);

    // eased body state [x, y, r, wobble, stretch, tilt]
    const you = [-0.6, 0, 0.2, 0.05, 1, 0];
    const agent = [0.6, 0, 0.2, 0.05, 1, 0];
    let fuse = 0.12;
    let t = 0;

    return {
      frame(s, dt) {
        t += dt;
        const k = 1 - Math.pow(1 - num(p, "ease"), dt * 60);
        const sep = num(p, "sep") * (1 - s.overlap * 0.45);
        const breathe = 0.012 * Math.sin(t * 0.9);
        const target = (f: typeof s.you, side: number, other: typeof s.you) => [
          side * sep - side * num(p, "lean") * other.presence,
          f.pitchDelta * 0.08 * f.presence + side * breathe,
          num(p, "baseR") + f.levelSlow * num(p, "levelR") + f.peak * num(p, "peakR") + breathe * side,
          num(p, "wobble") + f.onset * num(p, "onsetWobble") + f.mid * 0.08,
          1 + (f.pitch - 0.5) * num(p, "stretch") * f.presence,
          -side * f.pitchDelta * num(p, "tilt") * f.presence,
        ];
        const ty = target(s.you, -1, s.agent);
        const tb = target(s.agent, 1, s.you);
        for (let i = 0; i < 6; i++) {
          you[i] += (ty[i] - you[i]) * k;
          agent[i] += (tb[i] - agent[i]) * k;
        }
        const fuseT = num(p, "fuse") + s.handoff * num(p, "fuseHandoff") + s.overlap * num(p, "fuseOverlap");
        fuse += (fuseT - fuse) * k;

        u.uTime.value = t;
        u.uFuse.value = fuse;
        u.uSoft.value = num(p, "soft");
        u.uGlow.value = num(p, "glow");
        u.uYou.value.set(you[0], you[1], you[2], you[3]);
        u.uBob.value.set(agent[0], agent[1], agent[2], agent[3]);
        u.uYouShape.value.set(you[4], you[5]);
        u.uBobShape.value.set(agent[4], agent[5]);
        u.uYouCol.value.set(col(p, "youColor"));
        u.uBobCol.value.set(col(p, "agentColor"));
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
