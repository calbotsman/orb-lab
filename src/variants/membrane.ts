import * as THREE from "three";
import { NOISE_GLSL } from "./glsl";
import { col, num, type ParamValues, type Variant } from "./types";

// One membrane between you and the agent. Your syllables press dents in from the front; the agent's
// speech rings outward from inside at a frequency set by its pitch. Long silences settle it still.

const MAX_DENTS = 10;

const vertex = /* glsl */ `
  ${NOISE_GLSL}
  uniform float uTime, uBobLevel, uBobBass, uBobPitch, uBobPeak, uRippleAmp, uRippleFreq, uRippleSpeed;
  uniform float uBulge, uYouLevel, uContract, uDentDepth, uDentWidth, uDentDecay, uRest;
  uniform vec4 uDents[${MAX_DENTS}];
  uniform vec3 uEmit;
  varying vec3 vPos, vN;
  varying float vRipple, vDent;
  void main(){
    vec3 n = normalize(position);
    float r = 1.0;
    // resting breath
    r += uRest * snoise(n * 1.6 + uTime * .15);
    // The agent: bulge + travelling ripples from the emitter
    r += uBulge * uBobBass * (fbm(n * 2.0 + uTime * .25) * .5 + .5);
    float ang = acos(clamp(dot(n, uEmit), -1., 1.));
    float freq = uRippleFreq * (0.6 + uBobPitch * 1.2);
    float ripple = sin(ang * freq - uTime * uRippleSpeed) * exp(-ang * .35);
    ripple *= uRippleAmp * (uBobLevel + uBobPeak * .5);
    r += ripple;
    vRipple = ripple;
    // You: dents
    float dent = 0.;
    for (int i = 0; i < ${MAX_DENTS}; i++) {
      vec4 d = uDents[i];
      if (d.w < 0.) continue;
      float a = acos(clamp(dot(n, normalize(d.xyz)), -1., 1.));
      float env = exp(-d.w * uDentDecay) * (1. - exp(-d.w * 40.));
      dent += exp(-(a*a) / (uDentWidth*uDentWidth)) * env;
    }
    r -= dent * uDentDepth;
    vDent = dent;
    r -= uYouLevel * uContract;
    vec3 p = n * r;
    vPos = (modelMatrix * vec4(p, 1.)).xyz;
    vN = normalize(mat3(modelMatrix) * n);
    gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.);
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uYouCol, uBobCol, uIdleCol, uBase;
  uniform float uWho, uLive, uRimPow;
  varying vec3 vPos, vN;
  varying float vRipple, vDent;
  void main(){
    vec3 N = normalize(cross(dFdx(vPos), dFdy(vPos)));
    if (dot(N, vN) < 0.) N = -N;
    vec3 V = normalize(cameraPosition - vPos);
    float fres = pow(1. - max(dot(N, V), 0.), uRimPow);
    vec3 L = normalize(vec3(-.4, .7, .6));
    float diff = max(dot(N, L), 0.);
    float spec = pow(max(dot(reflect(-L, N), V), 0.), 48.);
    vec3 who = uWho < .5 ? mix(uYouCol, uIdleCol, uWho * 2.) : mix(uIdleCol, uBobCol, (uWho - .5) * 2.);
    vec3 c = uBase * (.35 + .65 * diff);
    c += who * fres * (.35 + .65 * uLive);
    c += uBobCol * max(vRipple, 0.) * 6.;
    c += uYouCol * vDent * .9;
    c += spec * .25;
    gl_FragColor = vec4(c, 1.);
  }
`;

export const membrane: Variant = {
  id: "membrane",
  name: "Membrane",
  theme: "dark",
  mapping: "AGENT → outward ripples (level), ripple frequency (pitch), bulge (bass) · YOU → syllable dents pressed in from the front, contraction (level) · rim colour = who holds the floor",
  params: {
    rippleAmp: { min: 0, max: 0.25, value: 0.07, label: "agent ripple depth" },
    rippleFreq: { min: 2, max: 30, value: 12, label: "agent ripple freq" },
    rippleSpeed: { min: 0, max: 20, value: 7, label: "ripple speed" },
    bulge: { min: 0, max: 0.6, value: 0.18, label: "agent bass bulge" },
    dentDepth: { min: 0, max: 0.6, value: 0.22, label: "you dent depth" },
    dentWidth: { min: 0.1, max: 1.2, value: 0.42, label: "you dent width" },
    dentDecay: { min: 0.5, max: 8, value: 2.6, label: "dent recovery" },
    contract: { min: 0, max: 0.3, value: 0.06, label: "you level → contract" },
    rest: { min: 0, max: 0.1, value: 0.02, label: "resting breath" },
    rimPow: { min: 0.5, max: 6, value: 2.4, label: "rim falloff" },
    spin: { min: 0, max: 0.5, value: 0.08, label: "spin" },
    youColor: { color: "#00ffaa", label: "you" },
    agentColor: { color: "#b238ff", label: "agent" },
    idleColor: { color: "#3a3a3a", label: "idle" },
    base: { color: "#141418", label: "surface" },
  },

  mount(el: HTMLElement, p: ParamValues) {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x050505, 1);
    el.append(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    camera.position.z = 4.2;

    const dents = Array.from({ length: MAX_DENTS }, () => new THREE.Vector4(0, 0, 1, -1));
    const u = {
      uTime: { value: 0 }, uBobLevel: { value: 0 }, uBobBass: { value: 0 }, uBobPitch: { value: 0.5 }, uBobPeak: { value: 0 },
      uRippleAmp: { value: 0 }, uRippleFreq: { value: 0 }, uRippleSpeed: { value: 0 }, uBulge: { value: 0 },
      uYouLevel: { value: 0 }, uContract: { value: 0 }, uDentDepth: { value: 0 }, uDentWidth: { value: 0.4 },
      uDentDecay: { value: 2 }, uRest: { value: 0 }, uDents: { value: dents },
      uEmit: { value: new THREE.Vector3(0, 0, 1) },
      uYouCol: { value: new THREE.Color() }, uBobCol: { value: new THREE.Color() }, uIdleCol: { value: new THREE.Color() },
      uBase: { value: new THREE.Color() }, uWho: { value: 0.5 }, uLive: { value: 0 }, uRimPow: { value: 2.4 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: u });
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 48), mat);
    scene.add(mesh);

    let t = 0;
    let lastYouOnsets = 0;
    let nextDent = 0;
    let who = 0.5;
    const inv = new THREE.Quaternion();

    return {
      frame(s, dt) {
        t += dt;
        mesh.rotation.y += num(p, "spin") * dt;
        mesh.rotation.x = Math.sin(t * 0.13) * 0.2;

        // a new syllable from you → a fresh dent on the camera-facing side (in object space)
        if (s.you.onsets !== lastYouOnsets) {
          if (s.you.active) {
            inv.copy(mesh.quaternion).invert();
            const d = new THREE.Vector3((Math.random() - 0.5) * 1.1, (Math.random() - 0.5) * 0.9, 1).normalize().applyQuaternion(inv);
            dents[nextDent].set(d.x, d.y, d.z, 0);
            nextDent = (nextDent + 1) % MAX_DENTS;
          }
          lastYouOnsets = s.you.onsets;
        }
        for (const d of dents) if (d.w >= 0) d.w = d.w > 6 ? -1 : d.w + dt;

        // The agent's ripples always emanate toward you (the camera)
        inv.copy(mesh.quaternion).invert();
        u.uEmit.value.set(0.15, 0.1, 1).normalize().applyQuaternion(inv);

        const whoT = s.speaker === "you" ? 0 : s.speaker === "agent" ? 1 : 0.5;
        who += (whoT - who) * (1 - Math.pow(0.92, dt * 60));
        const settle = Math.max(0.15, 1 - Math.max(0, s.silence - 2) / 6); // long silence → still

        u.uTime.value = t;
        u.uBobLevel.value = s.agent.level;
        u.uBobBass.value = s.agent.bass * s.agent.presence;
        u.uBobPitch.value = s.agent.pitch;
        u.uBobPeak.value = s.agent.peak;
        u.uRippleAmp.value = num(p, "rippleAmp");
        u.uRippleFreq.value = num(p, "rippleFreq");
        u.uRippleSpeed.value = num(p, "rippleSpeed");
        u.uBulge.value = num(p, "bulge");
        u.uYouLevel.value = s.you.levelSlow;
        u.uContract.value = num(p, "contract");
        u.uDentDepth.value = num(p, "dentDepth");
        u.uDentWidth.value = num(p, "dentWidth");
        u.uDentDecay.value = num(p, "dentDecay");
        u.uRest.value = num(p, "rest") * settle;
        u.uRimPow.value = num(p, "rimPow");
        u.uWho.value = who;
        u.uLive.value = s.live;
        u.uYouCol.value.set(col(p, "youColor"));
        u.uBobCol.value.set(col(p, "agentColor"));
        u.uIdleCol.value.set(col(p, "idleColor"));
        u.uBase.value.set(col(p, "base"));
        renderer.render(scene, camera);
      },
      resize(w, h) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.position.z = w < h ? 4.2 * Math.min(1.8, h / w) * 0.75 : 4.2;
        camera.updateProjectionMatrix();
      },
      dispose() {
        mat.dispose();
        mesh.geometry.dispose();
        renderer.dispose();
      },
    };
  },
};
