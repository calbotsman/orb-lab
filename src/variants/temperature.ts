import * as THREE from "three";
import type { ConversationSignal } from "../engine/conversation";
import { col, num, type ParamSchema, type ParamValues } from "./types";

// Colour as temperature:
// one axis, -1 cool (agent) … 0 neutral white … +1 warm (you). Because it's one axis, every
// handoff crosses neutral white on its own; the handoff pulse holds it there a beat longer.
// Responds in about a second: calm, but clearly alive.

export const TEMP_PARAMS: ParamSchema = {
  warmth: { min: 0, max: 1.5, value: 1, label: "you → warmth" },
  coolness: { min: 0, max: 1.5, value: 1, label: "agent → coolness" },
  restTemp: { min: -0.6, max: 0.6, value: 0.38, label: "resting temperature" },
  tempTime: { min: 0.2, max: 4, value: 1.1, label: "temperature time (s)" },
  handoffWhite: { min: 0, max: 1.5, value: 0.7, label: "handoff → neutral white" },
  amber: { color: "#efa040", label: "warm" },
  gold: { color: "#f2a900", label: "warm (deep)" },
  paleBlue: { color: "#7ea4ee", label: "cool" },
  lavender: { color: "#8b72e2", label: "cool (deep)" },
  white: { color: "#f1ece3", label: "neutral" },
};

/** Exponential approach with a time constant in seconds. */
export const approach = (cur: number, target: number, seconds: number, dt: number) =>
  cur + (target - cur) * (1 - Math.exp(-dt / Math.max(1e-3, seconds)));

export class Temperature {
  temp = 0.38;
  neutral = 0;
  deepW = 0;
  deepC = 0;
  readonly color = new THREE.Color();
  readonly warm = new THREE.Color();
  readonly cool = new THREE.Color();
  private a = new THREE.Color();
  private b = new THREE.Color();

  update(s: ConversationSignal, p: ParamValues, dt: number) {
    const y = s.you;
    const g = s.agent;
    const voiced = Math.max(y.presence, g.presence);
    const target = y.presence * num(p, "warmth") - g.presence * num(p, "coolness") + (1 - voiced) * num(p, "restTemp");
    this.temp = approach(this.temp, Math.max(-1, Math.min(1, target)), num(p, "tempTime"), dt);
    this.deepW = approach(this.deepW, Math.min(1, y.levelSlow * 2.5) * y.presence, 0.6, dt);
    this.deepC = approach(this.deepC, Math.min(1, g.levelSlow * 2.5) * g.presence, 0.6, dt);
    this.neutral = approach(this.neutral, Math.min(1, s.handoff * num(p, "handoffWhite")), 0.35, dt);

    this.warm.set(col(p, "amber")).lerp(this.b.set(col(p, "gold")), this.deepW);
    this.cool.set(col(p, "paleBlue")).lerp(this.b.set(col(p, "lavender")), this.deepC);
    const white = this.a.set(col(p, "white"));
    this.color.copy(white).lerp(this.temp >= 0 ? this.warm : this.cool, Math.abs(this.temp));
    this.color.lerp(white, this.neutral);
  }
}
