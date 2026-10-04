import * as THREE from "three";
import { makeGrain } from "./grain";
import { NOISE_GLSL } from "./glsl";
import { approach, Temperature, TEMP_PARAMS } from "./temperature";
import { col, num, type ParamValues, type Variant } from "./types";

// Calm pass #1 — Grain Duet, evolved. One presence: the particle sphere stays gathered
// (no scatter/regather swings), the agent breathes it, you lean it toward you, and the whole
// palette — particles and the colour field under them — moves on Warm Drift's temperature axis.
// Everything follows the voices within a fraction of a second, but smoothly: no jitter, no flicker.

const COUNT = 4000;

const vertex = /* glsl */ `
  ${NOISE_GLSL}
  attribute float aSize, aAlpha, aPhase;
  uniform float uTime, uPixelRatio, uRadius, uNoiseAmp, uNoiseScale, uFlow;
  uniform float uBreath, uSwell, uRipple, uLean;
  varying float vAlpha, vPhase, vShade;
  void main() {
    vAlpha = aAlpha; vPhase = aPhase;
    vec3 dir = normalize(position);
    float n = fbm(dir * (uNoiseScale + uRipple * 1.5) + vec3(0., 0., uFlow));
    float r = uRadius * (1. + uBreath) + uSwell + n * (uNoiseAmp + uRipple);
    vec3 p = dir * r;
    p.y -= uLean;
    vec4 mv = modelViewMatrix * vec4(p, 1.);
    vShade = .5 + .5 * dir.y;
    gl_PointSize = aSize * (1. + uSwell * .6) * uPixelRatio * (120. / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  varying float vAlpha, vPhase, vShade;
  uniform vec3 uCol, uLight;
  uniform float uTime, uBright;
  void main() {
    vec2 uv = gl_PointCoord - .5;
    float a = exp(-dot(uv, uv) / (.24 * .24)) * vAlpha * uBright;
    vec3 c = mix(uCol, uLight, .12 + .12 * sin(vPhase + uTime * .2) + .18 * vShade);
    if (a < .005) discard;
    gl_FragColor = vec4(c, a);
  }
`;

export const driftGrain: Variant = {
  id: "drift-grain",
  name: "Drift Grain",
  theme: "light",
  group: "Presence",
  mapping: "one gathered particle presence over a colour field · LISTENING → turns toward you, breath held shallow, quiet echo of your rhythm, small dips at your phrase ends · THINKING → draws a breath in · SPEAKING → releases it into its voice, ripples with springy syllables · then settles with an exhale · colour = temperature",
  params: {
    radius: { min: 1.5, max: 5, value: 3, label: "sphere radius" },
    noiseAmp: { min: 0, max: 1.5, value: 0.45, label: "surface noise" },
    noiseScale: { min: 0.5, max: 5, value: 2.2, label: "noise scale" },
    flow: { min: 0, max: 0.4, value: 0.06, label: "surface flow" },
    bodySize: { min: 0, max: 3, value: 1.2, label: "presence → size" },
    bodyMove: { min: 0, max: 2, value: 1, label: "presence → movement" },
    ripple: { min: 0, max: 1.5, value: 0.5, label: "voice → surface ripple" },
    fieldOpen: { min: 0, max: 300, value: 90, label: "listening → field opens" },
    spin: { min: 0, max: 0.2, value: 0.035, label: "spin" },
    bright: { min: 0.2, max: 2.5, value: 1.4, label: "particle opacity" },
    fieldStrength: { min: 0, max: 2, value: 1.3, label: "colour field strength" },
    accents: { min: 0, max: 1, value: 0.25, label: "google accents" },
    grain: { min: 0, max: 0.15, value: 0.045, label: "film grain" },
    ...TEMP_PARAMS,
    bg: { color: "#e2e0dd", label: "background" },
  },

  mount(el: HTMLElement, p: ParamValues) {
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
    const size = new Float32Array(COUNT);
    const alpha = new Float32Array(COUNT);
    const phase = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      dirs.set([Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph)], i * 3);
      size[i] = 0.2 + Math.random() * 0.6;
      alpha[i] = 0.15 + Math.random() * 0.45;
      phase[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(dirs, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
    const u = {
      uTime: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() }, uRadius: { value: 3 },
      uNoiseAmp: { value: 0.4 }, uNoiseScale: { value: 2 }, uFlow: { value: 0 }, uBreath: { value: 0 },
      uSwell: { value: 0 }, uRipple: { value: 0 }, uLean: { value: 0 }, uBright: { value: 1 },
      uCol: { value: new THREE.Color() }, uLight: { value: new THREE.Color() },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, uniforms: u,
      transparent: true, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    scene.add(points);

    const temp = new Temperature();
    const ACCENTS = [new THREE.Color("#4285f4"), new THREE.Color("#ea4335"), new THREE.Color("#fbbc04"), new THREE.Color("#34a853")];
    const blobs = Array.from({ length: 7 }, (_, i) => ({
      ang: (i / 7) * Math.PI * 2 + Math.random() * 0.4,
      dist: 30 + Math.random() * 90,
      r: 160 + Math.random() * 160,
      light: i % 3 === 0 ? 0.5 : i % 3 === 1 ? 0.15 : 0.3,
      accent: ACCENTS[i % 4],
      a: 0.24 + Math.random() * 0.12,
      ph: Math.random() * 6.28,
    }));
    const tmp = new THREE.Color();
    const white = new THREE.Color();
    let W = 1, H = 1, t = 0, flow = 0, swirl = 0;
    let open = 0;

    return {
      frame(s, dt) {
        t += dt;
        temp.update(s, p, dt);
        const b = s.body;
        const R = num(p, "radius");
        open = approach(open, b.attention * 0.4 + b.mirror, 0.5, dt);
        flow += dt * num(p, "flow") * (1 + b.stir * 2);
        swirl += dt * (0.03 + open * 0.1);
        points.position.set(b.offsetX * R * num(p, "bodyMove"), b.offsetY * R * num(p, "bodyMove"), 0);

        u.uTime.value = t;
        u.uRadius.value = R;
        u.uNoiseAmp.value = num(p, "noiseAmp");
        u.uNoiseScale.value = num(p, "noiseScale");
        u.uFlow.value = flow;
        u.uBreath.value = b.scale * num(p, "bodySize");
        u.uSwell.value = 0;
        u.uRipple.value = b.stir * num(p, "ripple");
        u.uLean.value = 0;
        u.uBright.value = num(p, "bright") * (0.75 + 0.25 * s.live);
        u.uCol.value.copy(temp.color);
        u.uLight.value.copy(white.set(col(p, "white")));
        points.rotation.y += dt * num(p, "spin");

        // colour field under the sphere — the temperature made into light
        bg.setTransform(0.5, 0, 0, 0.5, 0, 0);
        bg.fillStyle = col(p, "bg");
        bg.fillRect(0, 0, W, H);
        const pxPerUnit = H / (2 * camera.position.z * Math.tan((25 * Math.PI) / 180));
        const cx0 = W / 2 + points.position.x * pxPerUnit;
        const cy = H * 0.5 - points.position.y * pxPerUnit;
        const strength = num(p, "fieldStrength");
        blobs.forEach((bl, i) => {
          const a = bl.ang + swirl + Math.sin(t * 0.07 + bl.ph) * 0.3;
          const d = bl.dist + open * num(p, "fieldOpen") + s.body.voice * 30;
          const x = cx0 + Math.cos(a) * d;
          const y = cy + Math.sin(a) * d * 0.8;
          const r = bl.r * (1 + s.body.voice * 0.2 + s.body.inhale * 0.1) + Math.sin(t * 0.3 + i) * 10;
          tmp.copy(i % 2 ? temp.warm : temp.cool);
          tmp.lerp(temp.color, 0.4).lerp(white, bl.light * 0.6).lerp(bl.accent, num(p, "accents") * 0.5);
          const rgb = `${(tmp.r * 255) | 0},${(tmp.g * 255) | 0},${(tmp.b * 255) | 0}`;
          const al = bl.a * strength * (0.6 + 0.4 * s.live);
          const gr = bg.createRadialGradient(x, y, 0, x, y, r);
          gr.addColorStop(0, `rgba(${rgb},${al})`);
          gr.addColorStop(0.45, `rgba(${rgb},${al * 0.55})`);
          gr.addColorStop(1, `rgba(${rgb},0)`);
          bg.fillStyle = gr;
          bg.fillRect(x - r, y - r, r * 2, r * 2);
        });

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
        camera.position.z = w < h ? 18 * Math.min(1.6, h / w) * 0.8 : 18;
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
