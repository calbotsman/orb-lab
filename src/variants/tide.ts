import * as THREE from "three";
import { makeGrain } from "./grain";
import { NOISE_GLSL } from "./glsl";
import { Temperature, TEMP_PARAMS } from "./temperature";
import { col, num, type ParamValues, type Variant } from "./types";

// Calm pass #4 — one particle sphere, the temperature axis laid out in space. Warm fills
// it from below (your side of the screen), cool from above (the agent's). The tide line rises
// while you talk and falls while the agent talks; at a handoff the seam goes neutral white.
// Each voice ripples only its own hemisphere, so you can see who is speaking without two bodies.

const COUNT = 7000;

const vertex = /* glsl */ `
  ${NOISE_GLSL}
  attribute float aSize, aAlpha, aPhase;
  uniform float uTime, uPixelRatio, uRadius, uFlow, uTide, uSeamW;
  uniform float uYouRipple, uAgentRipple, uSwell, uNoiseScale;
  varying float vAlpha, vWarm, vSeam;
  void main() {
    vec3 dir = normalize(position);
    float n = fbm(dir * uNoiseScale + vec3(0., uFlow, uFlow * .5));
    float below = smoothstep(.2, -.6, dir.y);
    float above = smoothstep(-.2, .6, dir.y);
    float r = uRadius * (1. + uSwell) + n * (.25 + uYouRipple * below + uAgentRipple * above);
    vec3 p = dir * r;
    vec4 mv = modelViewMatrix * vec4(p, 1.);
    float d = dir.y - uTide;                 // + above the tide line, - below
    vWarm = smoothstep(uSeamW, -uSeamW, d);
    vSeam = exp(-d * d / (uSeamW * uSeamW * .5));
    vAlpha = aAlpha;
    gl_PointSize = aSize * uPixelRatio * (120. / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  varying float vAlpha, vWarm, vSeam;
  uniform vec3 uWarm, uCool, uWhite;
  uniform float uSeamWhite, uBright;
  void main() {
    vec2 uv = gl_PointCoord - .5;
    float a = exp(-dot(uv, uv) / (.22 * .22)) * vAlpha * uBright;
    vec3 c = mix(uCool, uWarm, vWarm);
    c = mix(c, uWhite, vSeam * uSeamWhite);
    if (a < .005) discard;
    gl_FragColor = vec4(c, a);
  }
`;

export const tide: Variant = {
  id: "tide",
  name: "Tide",
  theme: "light",
  group: "Presence",
  mapping: "one particle sphere, temperature as a tide line · LISTENING → turns toward you, warm rises, the lower half quietly echoes your rhythm · THINKING → inhale · SPEAKING → cool settles from above, upper half ripples with its voice · then settles · handoff → seam goes neutral white",
  params: {
    radius: { min: 1.5, max: 5, value: 3.1, label: "sphere radius" },
    tideReach: { min: 0, max: 1, value: 0.75, label: "how far the tide moves" },
    seam: { min: 0.03, max: 0.6, value: 0.18, label: "seam softness" },
    seamWhite: { min: 0, max: 1, value: 0.35, label: "seam whiteness" },
    youRipple: { min: 0, max: 1.5, value: 0.6, label: "listening → lower half echoes you" },
    agentRipple: { min: 0, max: 1.5, value: 0.6, label: "speaking → upper half ripples" },
    bodySize: { min: 0, max: 3, value: 1.2, label: "presence → size" },
    bodyMove: { min: 0, max: 2, value: 1, label: "presence → movement" },
    noiseScale: { min: 0.5, max: 5, value: 2.4, label: "noise scale" },
    flow: { min: 0, max: 0.4, value: 0.05, label: "surface flow" },
    spin: { min: 0, max: 0.2, value: 0.03, label: "spin" },
    bright: { min: 0.2, max: 2, value: 1.3, label: "particle opacity" },
    halo: { min: 0, max: 1, value: 0.8, label: "background halo" },
    grain: { min: 0, max: 0.15, value: 0.045, label: "film grain" },
    ...TEMP_PARAMS,
    bg: { color: "#e2e0dd", label: "background" },
  },

  mount(el: HTMLElement, p: ParamValues) {
    const haloEl = document.createElement("div");
    Object.assign(haloEl.style, { position: "absolute", inset: "0" });
    el.append(haloEl);
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
      dirs.set([Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)], i * 3);
      size[i] = 0.2 + Math.random() * 0.7;
      alpha[i] = 0.35 + Math.random() * 0.55;
      phase[i] = Math.random() * 6.28;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(dirs, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
    const u = {
      uTime: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() }, uRadius: { value: 3 }, uFlow: { value: 0 },
      uTide: { value: 0 }, uSeamW: { value: 0.2 }, uYouRipple: { value: 0 }, uAgentRipple: { value: 0 }, uSwell: { value: 0 },
      uNoiseScale: { value: 2.4 }, uWarm: { value: new THREE.Color() }, uCool: { value: new THREE.Color() },
      uWhite: { value: new THREE.Color() }, uSeamWhite: { value: 0.3 }, uBright: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: u, transparent: true, depthWrite: false });
    const points = new THREE.Points(geo, mat);
    scene.add(points);

    const temp = new Temperature();
    let t = 0, flow = 0;

    return {
      frame(s, dt) {
        t += dt;
        temp.update(s, p, dt);
        const b = s.body;
        const R = num(p, "radius");
        const yr = b.mirror;
        const ar = Math.min(1, b.voice * 1.5 + Math.abs(b.syllable) * 0.3);
        points.position.set(b.offsetX * R * num(p, "bodyMove"), b.offsetY * R * num(p, "bodyMove"), 0);
        flow += dt * num(p, "flow");

        u.uTime.value = t;
        u.uFlow.value = flow;
        u.uRadius.value = R * (1 + b.scale * num(p, "bodySize"));
        // the shared temperature axis, laid out vertically: warm (you) climbs, cool (agent) descends
        u.uTide.value = temp.temp * num(p, "tideReach");
        u.uSeamW.value = num(p, "seam");
        u.uSeamWhite.value = Math.min(1, num(p, "seamWhite") + temp.neutral);
        u.uYouRipple.value = yr * num(p, "youRipple");
        u.uAgentRipple.value = ar * num(p, "agentRipple");
        u.uSwell.value = 0;
        u.uNoiseScale.value = num(p, "noiseScale");
        u.uWarm.value.copy(temp.warm);
        u.uCool.value.copy(temp.cool);
        u.uWhite.value.set(col(p, "white"));
        u.uBright.value = num(p, "bright") * (0.75 + 0.25 * s.live);
        points.rotation.y += dt * num(p, "spin");

        const c = temp.color;
        const rgba = (a: number) => `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},${a})`;
        const h = num(p, "halo") * (0.6 + 0.4 * s.live);
        haloEl.style.background = `radial-gradient(circle at 50% 50%, ${rgba(h)} 0%, ${rgba(h * 0.4)} 28%, ${rgba(0)} 55%), ${col(p, "bg")}`;

        grain.frame(dt, num(p, "grain"));
        renderer.render(scene, camera);
      },
      resize(w, h) {
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
