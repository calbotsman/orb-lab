import * as THREE from "three";
import { makeGrain } from "./grain";
import { NOISE_GLSL } from "./glsl";
import { approach, Temperature, TEMP_PARAMS } from "./temperature";
import { col, num, type ParamValues, type Variant } from "./types";

// Swarm — a loose murmuration of grain instead of a sphere. Resting, it drifts as a soft cloud.
// Listening, it slides toward you and tightens. Thinking, it gathers and swirls faster, winding
// up. Speaking, it fans outward with the voice and shivers on syllables. Each mote is warm or
// cool, and the mix follows the shared temperature.

const COUNT = 4500;

const vertex = /* glsl */ `
  ${NOISE_GLSL}
  attribute float aSpeed, aRand, aSize, aWarm;
  uniform float uTime, uSpread, uGather, uSwirl, uFan, uShimmer, uPixelRatio, uTemp;
  uniform vec2 uOffset;
  varying float vAlpha, vWarm;
  float hash(float n){ return fract(sin(n) * 43758.5453); }
  void main(){
    vec3 p = position;
    float ang = uSwirl * aSpeed;
    float c = cos(ang), s = sin(ang);
    p.xz = mat2(c, -s, s, c) * p.xz;
    vec3 n = vec3(snoise(position * 0.6 + uTime * 0.08), snoise(position * 0.6 + uTime * 0.08 + 7.1), snoise(position * 0.6 + uTime * 0.08 + 13.7));
    p += n * 0.45;
    p *= uSpread * (1.0 - uGather * 0.4) * (1.0 + uFan * aRand * 0.9);
    p += normalize(p + 1e-3) * uShimmer * (hash(aRand * 91.0 + floor(uTime * 24.0)) - 0.5) * 0.5;
    p.xy += uOffset;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vAlpha = 0.5 + 0.5 * aRand;
    // motes flip warm/cool around the current temperature, so the mix follows who's talking
    vWarm = step(aWarm, 0.5 + uTemp * 0.5);
    gl_PointSize = aSize * uPixelRatio * (120.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  varying float vAlpha, vWarm;
  uniform vec3 uWarm, uCool;
  uniform float uBright;
  void main(){
    vec2 uv = gl_PointCoord - 0.5;
    float a = exp(-dot(uv, uv) / (0.2 * 0.2)) * vAlpha * uBright;
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(uCool, uWarm, vWarm), a);
  }
`;

export const swarm: Variant = {
  id: "swarm",
  name: "Swarm",
  theme: "light",
  group: "New",
  mapping: "a loose murmuration instead of a sphere · LISTENING → slides toward you and tightens · THINKING → gathers and swirls, winding up · SPEAKING → fans out with the voice, shivers on syllables · warm/cool motes follow the temperature",
  params: {
    spread: { min: 1, max: 6, value: 3.2, label: "cloud size" },
    gather: { min: 0, max: 1.5, value: 0.8, label: "listening/thinking → gathers" },
    fan: { min: 0, max: 1.5, value: 0.7, label: "speaking → fans out" },
    shimmer: { min: 0, max: 2, value: 0.9, label: "syllables → shiver" },
    swirl: { min: 0, max: 1.5, value: 0.25, label: "resting swirl" },
    thinkSwirl: { min: 0, max: 4, value: 1.6, label: "thinking → swirl faster" },
    bodyMove: { min: 0, max: 3, value: 1.4, label: "presence → movement" },
    bright: { min: 0.2, max: 2.5, value: 1.6, label: "mote opacity" },
    grain: { min: 0, max: 0.15, value: 0.04, label: "film grain" },
    ...TEMP_PARAMS,
    bg: { color: "#e2e0dd", label: "background" },
  },
  mount(el: HTMLElement, p: ParamValues) {
    const bgEl = document.createElement("div");
    Object.assign(bgEl.style, { position: "absolute", inset: "0" });
    el.append(bgEl);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.append(renderer.domElement);
    const grain = makeGrain(el, num(p, "grain"));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.z = 18;

    // gaussian cloud (Box–Muller), slightly flattened
    const pos = new Float32Array(COUNT * 3);
    const speed = new Float32Array(COUNT);
    const rand = new Float32Array(COUNT);
    const size = new Float32Array(COUNT);
    const warm = new Float32Array(COUNT);
    const g = () => Math.sqrt(-2 * Math.log(Math.random() + 1e-9)) * Math.cos(2 * Math.PI * Math.random());
    for (let i = 0; i < COUNT; i++) {
      pos.set([g() * 0.55, g() * 0.42, g() * 0.55], i * 3);
      speed[i] = 0.4 + Math.random() * 1.2;
      rand[i] = Math.random();
      size[i] = 0.3 + Math.random() * 0.75;
      warm[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1));
    geo.setAttribute("aRand", new THREE.BufferAttribute(rand, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aWarm", new THREE.BufferAttribute(warm, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 30);
    const u = {
      uTime: { value: 0 }, uSpread: { value: 3 }, uGather: { value: 0 }, uSwirl: { value: 0 }, uFan: { value: 0 },
      uShimmer: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() }, uTemp: { value: 0 },
      uOffset: { value: new THREE.Vector2() }, uWarm: { value: new THREE.Color() }, uCool: { value: new THREE.Color() },
      uBright: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: u, transparent: true, depthWrite: false });
    scene.add(new THREE.Points(geo, mat));

    const temp = new Temperature();
    let t = 0, swirl = 0, gather = 0, fan = 0, shimmer = 0;
    return {
      frame(s, dt) {
        t += dt;
        const b = s.body;
        temp.update(s, p, dt);
        const listening = b.mode === "listen" || b.mode === "yield" ? 1 : 0;
        gather = approach(gather, Math.min(1, listening * b.attention * 0.7 + b.inhale), 0.6, dt);
        fan = approach(fan, Math.min(1, b.voice * 1.2 + b.phrase * 0.4), 0.25, dt);
        shimmer = approach(shimmer, Math.min(1, Math.abs(b.syllable) * 1.6 + b.mirror * 0.4), 0.08, dt);
        swirl += dt * (num(p, "swirl") + b.inhale * num(p, "thinkSwirl") + b.voice * 0.4);
        const S = num(p, "spread");
        u.uTime.value = t;
        u.uSpread.value = S * (1 + b.scale * 1.5);
        u.uGather.value = gather * num(p, "gather");
        u.uFan.value = fan * num(p, "fan");
        u.uShimmer.value = shimmer * num(p, "shimmer");
        u.uSwirl.value = swirl;
        u.uTemp.value = temp.temp;
        u.uOffset.value.set(b.offsetX * S * num(p, "bodyMove"), 0.4 + b.offsetY * S * num(p, "bodyMove"));
        u.uWarm.value.copy(temp.warm);
        u.uCool.value.copy(temp.cool);
        u.uBright.value = num(p, "bright") * (0.75 + 0.25 * s.live);
        bgEl.style.background = col(p, "bg");
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
