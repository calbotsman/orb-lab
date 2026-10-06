import { NOISE_GLSL } from "./glsl";
import { makeQuad, SCREEN_GLSL } from "./quad";
import { approach, Temperature, TEMP_PARAMS } from "./temperature";
import { col, num, type ParamValues, type Variant } from "./types";
import * as THREE from "three";

// Ripple — the direction of the conversation made visible. A small soft core sits in still
// water. When you talk, rings travel *inward* to the core (it's taking you in); when the agent
// talks, rings travel *outward* from it. Silence lets the water go flat. The ring phase is an
// integral, so a handoff visibly slows, stops and reverses rather than jumping.

const fragment = /* glsl */ `
  ${NOISE_GLSL}
  ${SCREEN_GLSL}
  uniform float uTime, uCore, uPhase, uAmp, uFreq, uReach, uSoft;
  uniform vec2 uC;
  uniform vec3 uCol, uWhite, uBg;
  void main(){
    vec2 q = screenP() - uC;
    float r = length(q);
    // a little drift in the water so the rings aren't perfect circles
    r += 0.012 * snoise(vec3(q * 2.5, uTime * 0.2));
    float env = exp(-pow(max(r - uCore, 0.0) / max(uReach, 0.01), 1.4));
    float rings = 0.5 + 0.5 * sin(r * uFreq - uPhase);
    rings = pow(rings, 6.0) * env * uAmp;
    float core = smoothstep(uCore + uSoft, uCore - uSoft, r);
    float coreGlow = exp(-max(r - uCore, 0.0) / 0.08) * 0.35;
    vec3 c = uBg;
    c = mix(c, uCol, clamp(rings * 0.8 + coreGlow, 0.0, 1.0));
    c = mix(c, mix(uCol, uWhite, 0.3), core);
    gl_FragColor = vec4(c, 1.0);
  }
`;

export const ripple: Variant = {
  id: "ripple",
  name: "Ripple",
  theme: "light",
  group: "New",
  mapping: "a small core in still water · YOU → rings travel inward, it takes you in · AGENT → rings travel outward from it · handoff → the rings slow, stop and reverse · silence → the water goes flat · colour = temperature",
  params: {
    core: { min: 0.03, max: 0.3, value: 0.1, label: "core size" },
    freq: { min: 8, max: 80, value: 34, label: "ring spacing" },
    speed: { min: 0.5, max: 12, value: 5, label: "ring speed" },
    reach: { min: 0.1, max: 1.5, value: 0.62, label: "how far rings reach" },
    youIn: { min: 0, max: 3, value: 2, label: "you → inward rings" },
    agentOut: { min: 0, max: 2, value: 1.2, label: "agent → outward rings" },
    restRings: { min: 0, max: 0.5, value: 0.08, label: "resting ripple" },
    bodySize: { min: 0, max: 4, value: 2, label: "presence → core size" },
    bodyMove: { min: 0, max: 2, value: 0.6, label: "presence → movement" },
    soft: { min: 0.002, max: 0.08, value: 0.02, label: "core softness" },
    grain: { min: 0, max: 0.15, value: 0.05, label: "film grain" },
    ...TEMP_PARAMS,
    bg: { color: "#e2e0dd", label: "background" },
  },
  mount(el: HTMLElement, p: ParamValues) {
    const q = makeQuad(el, fragment, {
      uCore: { value: 0.1 }, uPhase: { value: 0 }, uAmp: { value: 0 }, uFreq: { value: 34 }, uReach: { value: 0.6 },
      uSoft: { value: 0.02 }, uC: { value: new THREE.Vector2() },
      uCol: { value: new THREE.Color() }, uWhite: { value: new THREE.Color() }, uBg: { value: new THREE.Color() },
    });
    const temp = new Temperature();
    let t = 0, phase = 0, flow = 0, amp = 0;
    return {
      frame(s, dt) {
        t += dt;
        const b = s.body;
        temp.update(s, p, dt);
        // + = outward (agent), - = inward (you); eased so a handoff slows, stops and reverses
        const youPull = s.you.levelSlow * s.you.presence * num(p, "youIn");
        const agentPush = (b.voice + Math.abs(b.syllable) * 0.3) * num(p, "agentOut");
        flow = approach(flow, agentPush - youPull + num(p, "restRings") * 0.2, 0.45, dt);
        phase += dt * flow * num(p, "speed");
        amp = approach(amp, Math.min(1, Math.abs(flow) * 1.4 + num(p, "restRings")), 0.3, dt);
        const core = num(p, "core");
        const u = q.u;
        u.uTime.value = t;
        u.uCore.value = core * (1 + b.scale * num(p, "bodySize") + b.inhale * 0.15);
        u.uPhase.value = phase;
        u.uAmp.value = amp;
        u.uFreq.value = num(p, "freq");
        u.uReach.value = num(p, "reach") * (0.7 + 0.3 * s.live);
        u.uSoft.value = num(p, "soft");
        u.uC.value.set(b.offsetX * 0.3 * num(p, "bodyMove"), 0.06 + b.offsetY * 0.3 * num(p, "bodyMove"));
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
