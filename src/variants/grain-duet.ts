import * as THREE from "three";
import type { ConversationSignal } from "../engine/conversation";
import { makeGrain } from "./grain";
import { NOISE_GLSL } from "./glsl";
import { col, num, type ParamValues, type Variant } from "./types";

// A WebGL grain-particle orb (originally a CPU prototype), with two changes:
//  1. the per-particle fbm runs in the vertex shader instead of the CPU (4000× per frame on mobile was the cost);
//  2. it hears BOTH voices — the agent shapes the particle sphere, you stir the colour field underneath.

const COUNT = 4000;
const SCATTER = 14;

const BLOB_COLORS = [
  [66, 133, 244, 0.28], [100, 160, 240, 0.25], [60, 120, 230, 0.26], [130, 180, 245, 0.22],
  [234, 67, 53, 0.12], [251, 188, 4, 0.1], [52, 168, 83, 0.11],
] as const;

const vertex = /* glsl */ `
  ${NOISE_GLSL}
  attribute vec3 aScatter;
  attribute float aSize, aAlpha, aPhase;
  uniform float uTime, uMix, uPixelRatio, uRadius, uNoiseAmp, uNoiseScale;
  uniform float uBobBass, uBobMid, uBobHigh, uBobPeak, uBobLevel;
  uniform float uYouLevel, uYouOnset, uYouPull;
  uniform float uRadBass, uRadPeak, uMidNoise, uJitter;
  varying float vAlpha, vPhase, vRim;
  float hash(float n){ return fract(sin(n) * 43758.5453); }
  void main() {
    vAlpha = aAlpha; vPhase = aPhase;
    vec3 dir = normalize(position);
    float t = uTime;
    vec3 drift = vec3(sin(t*.2+aPhase), cos(t*.15+aPhase), sin(t*.25+aPhase*1.3)) * 0.6;
    vec3 scatter = aScatter + drift;

    float ns = uNoiseScale + uBobMid * uMidNoise * 0.6;
    float n = fbm(dir * ns + vec3(sin(t*.12)*.3, cos(t*.12)*.3, t*.05 + uBobPeak*.5));
    float r = uRadius + uBobBass * uRadBass + uBobPeak * uRadPeak - uYouLevel * uYouPull;
    r += n * (uNoiseAmp + uBobMid * uMidNoise + uBobLevel) ;
    r += (hash(aPhase * 91.7 + floor(t * 30.0)) - .5) * uBobHigh * uJitter;
    // your syllables send a quick shiver around the equator
    r += uYouOnset * 0.35 * sin(dir.y * 9.0 + t * 14.0) * (1.0 - abs(dir.y));
    vec3 sphere = dir * r;

    float m = uMix < .5 ? 4.*uMix*uMix*uMix : 1. - pow(-2.*uMix+2., 3.)/2.;
    vec3 p = mix(scatter, sphere, m);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vRim = m;
    float breath = mix(1.0 + .15*sin(t*.8+aPhase), 1.0 + uBobPeak*1.2 + uBobBass*.4, m);
    gl_PointSize = aSize * breath * uPixelRatio * (120.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  varying float vAlpha, vPhase, vRim;
  uniform float uTime, uBobLevel, uBobHigh, uBobMid, uWarmth;
  uniform vec3 uCool, uWarm;
  void main() {
    vec2 uv = gl_PointCoord - .5;
    float d = length(uv);
    float soft = mix(.18, .26, vRim) - uBobMid * .06 * vRim;
    float a = exp(-d*d/(soft*soft)) * vAlpha;
    float hs = sin(vPhase + uTime*.3) * .04;
    vec3 c = uCool + vec3(hs, hs*.5, 0.);
    c = mix(c, uWarm, uWarmth * vRim);
    c *= 1.0 + uBobLevel * .5 * vRim * .6;
    c += uBobHigh * vRim * .15;
    a *= 1.0 + uBobLevel * .5 * vRim * .4;
    if (a < .005) discard;
    gl_FragColor = vec4(c, a);
  }
`;

const hexToVec3 = (hex: string) => new THREE.Color(hex);

export const grainDuet: Variant = {
  id: "grain-duet",
  name: "Grain Duet",
  theme: "light",
  mapping: "AGENT → sphere radius (bass), surface noise (mid), shimmer (high), warmth (pitch) · YOU → colour field spread & swirl, syllable shiver, sphere leans in",
  params: {
    radius: { min: 1.5, max: 6, value: 3.2, label: "sphere radius" },
    noiseAmp: { min: 0, max: 2.5, value: 0.7, label: "noise amp" },
    noiseScale: { min: 0.5, max: 6, value: 2.5, label: "noise scale" },
    radBass: { min: 0, max: 4, value: 1.8, label: "agent bass → radius" },
    radPeak: { min: 0, max: 3, value: 0.8, label: "agent peak → radius" },
    midNoise: { min: 0, max: 5, value: 2.5, label: "agent mid → noise" },
    jitter: { min: 0, max: 1.5, value: 0.4, label: "agent high → jitter" },
    warmth: { min: 0, max: 1, value: 0.55, label: "agent pitch → warmth" },
    youPull: { min: 0, max: 2, value: 0.5, label: "you → sphere leans in" },
    blobSpread: { min: 0, max: 400, value: 160, label: "you → field spread" },
    blobSwirl: { min: 0, max: 3, value: 1.2, label: "you → field swirl" },
    idleMix: { min: 0, max: 1, value: 0.15, label: "idle gather" },
    listenMix: { min: 0, max: 1, value: 0.7, label: "listening gather" },
    mixSpeed: { min: 0.005, max: 0.1, value: 0.022, label: "gather speed" },
    grain: { min: 0, max: 0.15, value: 0.035, label: "film grain" },
    cool: { color: "#9ec2eb", label: "particle cool" },
    warm: { color: "#ffb08a", label: "particle warm" },
  },

  mount(el: HTMLElement, p: ParamValues) {
    // blobs (2D, half-res)
    const blobCanvas = document.createElement("canvas");
    const bg = blobCanvas.getContext("2d")!;
    el.append(blobCanvas);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.append(renderer.domElement);
    const grain = makeGrain(el, num(p, "grain"));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.z = 18;

    const dirs = new Float32Array(COUNT * 3);
    const scatter = new Float32Array(COUNT * 3);
    const size = new Float32Array(COUNT);
    const alpha = new Float32Array(COUNT);
    const phase = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      dirs.set([Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph)], i * 3);
      const r = Math.pow(Math.random(), 0.4) * SCATTER;
      const t2 = Math.random() * Math.PI * 2;
      const p2 = Math.acos(2 * Math.random() - 1);
      scatter.set([r * Math.sin(p2) * Math.cos(t2), r * Math.sin(p2) * Math.sin(t2), r * Math.cos(p2)], i * 3);
      size[i] = 0.15 + Math.random() * 0.55;
      alpha[i] = 0.15 + Math.random() * 0.5;
      phase[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(dirs, 3));
    geo.setAttribute("aScatter", new THREE.BufferAttribute(scatter, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SCATTER * 2);

    const u = {
      uTime: { value: 0 }, uMix: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() },
      uRadius: { value: 3.2 }, uNoiseAmp: { value: 0.7 }, uNoiseScale: { value: 2.5 },
      uBobBass: { value: 0 }, uBobMid: { value: 0 }, uBobHigh: { value: 0 }, uBobPeak: { value: 0 }, uBobLevel: { value: 0 },
      uYouLevel: { value: 0 }, uYouOnset: { value: 0 }, uYouPull: { value: 0 },
      uRadBass: { value: 0 }, uRadPeak: { value: 0 }, uMidNoise: { value: 0 }, uJitter: { value: 0 },
      uWarmth: { value: 0 }, uCool: { value: new THREE.Color() }, uWarm: { value: new THREE.Color() },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, uniforms: u,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    scene.add(points);

    // blob state
    let W = 1;
    let H = 1;
    const blobs = BLOB_COLORS.map((c, i) => {
      const ang = (i / BLOB_COLORS.length) * Math.PI * 2 + Math.random() * 0.5;
      return { c, ang, x: 0, y: 0, r: 250 + Math.random() * 350, base: 250 + Math.random() * 350, sx: Math.cos(ang) * 300, sy: Math.sin(ang) * 300, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4, ph: Math.random() * 6.28 };
    });
    let mix = 0;
    let swirl = 0;
    let t = 0;

    const drawBlobs = (s: ConversationSignal, m: number, dt: number) => {
      const scale = 0.5;
      bg.setTransform(scale, 0, 0, scale, 0, 0);
      bg.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;
      const em = m < 0.5 ? 4 * m * m * m : 1 - Math.pow(-2 * m + 2, 3) / 2;
      const you = s.you;
      swirl += (0.08 + you.level * num(p, "blobSwirl")) * dt;
      blobs.forEach((b, i) => {
        b.sx += b.vx + Math.sin(t * 0.15 + b.ph) * 0.3;
        b.sy += b.vy + Math.cos(t * 0.12 + b.ph * 1.3) * 0.3;
        if (Math.abs(b.sx) > W * 0.6) b.vx *= -1;
        if (Math.abs(b.sy) > H * 0.6) b.vy *= -1;
        const spread = 15 + i * 5 + s.agent.bass * 15 + s.agent.peak * 10 + you.levelSlow * num(p, "blobSpread") + you.onset * 40;
        const a = b.ang + swirl;
        const tx = cx + b.sx + (Math.cos(a) * spread - b.sx) * em;
        const ty = cy + b.sy + (Math.sin(a) * spread - b.sy) * em;
        b.x += (tx - b.x) * 0.04;
        b.y += (ty - b.y) * 0.04;
        const condensed = 100 + you.levelSlow * 120;
        const tr = b.base + (condensed - b.base) * em + s.agent.levelSlow * 30 * em + s.agent.peak * 20 * em;
        b.r += (tr - b.r) * 0.06;
        // your pitch warms the accent blobs
        const accent = i >= 4 ? 1 + you.presence * you.pitch * 1.4 : 1;
        const al = (b.c[3] + em * 0.12 + Math.max(you.level, s.agent.level) * 0.1 * em) * accent;
        const gr = bg.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        gr.addColorStop(0, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},${al})`);
        gr.addColorStop(0.4, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},${al * 0.6})`);
        gr.addColorStop(1, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},0)`);
        bg.fillStyle = gr;
        bg.beginPath();
        bg.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        bg.fill();
      });
    };

    return {
      frame(s, dt) {
        t += dt;
        const target =
          s.agent.presence > 0.3 ? 1 : s.you.presence > 0.3 ? num(p, "listenMix") : num(p, "idleMix") * s.live;
        mix += (target - mix) * (1 - Math.pow(1 - num(p, "mixSpeed"), dt * 60));

        u.uTime.value = t;
        u.uMix.value = mix;
        u.uRadius.value = num(p, "radius");
        u.uNoiseAmp.value = num(p, "noiseAmp");
        u.uNoiseScale.value = num(p, "noiseScale");
        u.uRadBass.value = num(p, "radBass");
        u.uRadPeak.value = num(p, "radPeak");
        u.uMidNoise.value = num(p, "midNoise");
        u.uJitter.value = num(p, "jitter");
        u.uYouPull.value = num(p, "youPull");
        u.uBobBass.value = s.agent.bass * s.agent.presence;
        u.uBobMid.value = s.agent.mid * s.agent.presence;
        u.uBobHigh.value = s.agent.high * s.agent.presence;
        u.uBobPeak.value = s.agent.peak;
        u.uBobLevel.value = s.agent.level;
        u.uYouLevel.value = s.you.levelSlow;
        u.uYouOnset.value = s.you.onset;
        u.uWarmth.value = num(p, "warmth") * s.agent.presence * (0.3 + s.agent.pitch * 0.7);
        u.uCool.value.set(hexToVec3(col(p, "cool")));
        u.uWarm.value.set(hexToVec3(col(p, "warm")));

        points.rotation.y += 0.0008 + s.agent.levelSlow * 0.004 - s.you.levelSlow * 0.002;
        points.rotation.z = Math.sin(t * 0.5) * s.agent.levelSlow * 0.15;
        drawBlobs(s, mix, dt);
        grain.frame(dt, num(p, "grain"));
        renderer.render(scene, camera);
      },
      resize(w, h) {
        W = w;
        H = h;
        blobCanvas.width = Math.max(1, w / 2);
        blobCanvas.height = Math.max(1, h / 2);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      },
      dispose() {
        geo.dispose();
        mat.dispose();
        renderer.dispose();
      },
    };
  },
};
