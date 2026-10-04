import GUI from "lil-gui";
import { engineParams } from "../engine/features";
import { presenceParams } from "../engine/presence";
import { defaultsOf, isColor, type ParamValues, type Variant } from "../variants/types";

const key = (id: string) => `orb-lab:params:${id}`;
const ENGINE_KEY = "orb-lab:engine";
const PRESENCE_KEY = "orb-lab:presence";

function load(k: string): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "{}");
  } catch {
    return {};
  }
}
function save(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

/** Restore engine tunables once at boot. */
export function loadEngineParams() {
  Object.assign(engineParams, load(ENGINE_KEY));
  Object.assign(presenceParams, load(PRESENCE_KEY));
}

const PRESENCE_DEFAULTS = { ...presenceParams };

/** Current values for a variant: defaults overlaid with whatever you last tuned. */
export function paramsFor(v: Variant): ParamValues {
  const defaults = defaultsOf(v.params);
  const stored = load(key(v.id));
  for (const k of Object.keys(defaults)) if (k in stored) defaults[k] = stored[k] as number | string;
  return defaults;
}

export class Tuner {
  private gui: GUI;
  constructor(variant: Variant, values: ParamValues, toast: (msg: string) => void) {
    this.gui = new GUI({ title: `${variant.name} — tune` });
    const persist = () => save(key(variant.id), values);

    for (const [k, d] of Object.entries(variant.params)) {
      if (isColor(d)) this.gui.addColor(values, k).name(d.label ?? k).onChange(persist);
      else this.gui.add(values, k, d.min, d.max, d.step ?? (d.max - d.min) / 200).name(d.label ?? k).onChange(persist);
    }

    const actions = {
      copy: async () => {
        const defaults = defaultsOf(variant.params);
        const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => defaults[k] !== v));
        const text = JSON.stringify({ variant: variant.id, changed, all: values, presence: presenceParams }, null, 2);
        try {
          await navigator.clipboard.writeText(text);
          toast("Params copied — paste them into the chat");
        } catch {
          console.log(text);
          toast("Clipboard blocked — params printed to console");
        }
      },
      reset: () => {
        Object.assign(values, defaultsOf(variant.params));
        save(key(variant.id), values);
        this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
      },
    };
    this.gui.add(actions, "copy").name("📋 Copy params");
    this.gui.add(actions, "reset").name("↺ Reset to defaults");

    // How it behaves in conversation — shared by every variant that reads sig.body.
    const pr = this.gui.addFolder("Presence (shared): listening → speaking").close();
    const persistP = () => save(PRESENCE_KEY, presenceParams);
    const P: Array<[keyof typeof presenceParams, number, number, string]> = [
      ["breathRate", 0.05, 0.6, "breath rate (Hz)"],
      ["breathDepth", 0, 2, "breath depth"],
      ["listenBreath", 0, 1, "breath while listening (held)"],
      ["inhaleTime", 0.1, 2, "thinking: inhale time (s)"],
      ["attentionTime", 0.1, 2, "turn toward you (s)"],
      ["lean", 0, 2, "lean toward you"],
      ["gazeDrift", 0, 2, "idle drift"],
      ["nod", 0, 3, "acknowledging dips"],
      ["nodSpring", 10, 150, "dip spring"],
      ["nodDamping", 1, 20, "dip damping"],
      ["mirror", 0, 1.5, "entrain to your rhythm"],
      ["mirrorLag", 0.05, 1, "entrain lag (s)"],
      ["voiceAttack", 0.01, 0.3, "agent voice attack (s)"],
      ["voiceRelease", 0.05, 1, "agent voice release (s)"],
      ["syllable", 0, 3, "agent syllable spring"],
      ["settleTime", 0.3, 4, "settle after speaking (s)"],
      ["yieldTime", 0.1, 1.5, "yield on barge-in (s)"],
      ["wBreath", 0, 0.1, "size ← breath"],
      ["wInhale", 0, 0.2, "size ← inhale"],
      ["wVoice", 0, 0.3, "size ← agent voice"],
      ["wSyllable", 0, 0.12, "size ← agent syllables"],
      ["wMirror", 0, 0.1, "size ← your rhythm"],
      ["wYield", 0, 0.2, "size ← yield"],
      ["wLean", 0, 0.5, "move ← lean"],
      ["wGaze", 0, 0.2, "move ← drift"],
      ["wNod", 0, 0.25, "move ← dips"],
    ];
    for (const [k, lo, hi, label] of P) pr.add(presenceParams, k, lo, hi).name(label).onChange(persistP);
    pr.add({ reset: () => { Object.assign(presenceParams, PRESENCE_DEFAULTS); persistP(); pr.controllersRecursive().forEach((c) => c.updateDisplay()); } }, "reset").name("↺ Reset presence");

    const eng = this.gui.addFolder("Engine (shared)").close();
    const persistEngine = () => save(ENGINE_KEY, engineParams);
    eng.add(engineParams, "floorDb", -90, -30, 1).name("level floor dB").onChange(persistEngine);
    eng.add(engineParams, "ceilDb", -40, 0, 1).name("level ceil dB").onChange(persistEngine);
    eng.add(engineParams, "vadOn", 0.02, 0.8, 0.01).name("voice on").onChange(persistEngine);
    eng.add(engineParams, "vadOff", 0.01, 0.6, 0.01).name("voice off").onChange(persistEngine);
    eng.add(engineParams, "vadHangMs", 50, 1000, 10).name("voice hang ms").onChange(persistEngine);
    eng.add(engineParams, "onsetSensitivity", 1.05, 4, 0.05).name("onset threshold").onChange(persistEngine);
    eng.add(engineParams, "bargeIn", 0.1, 1, 0.01).name("barge-in level").onChange(persistEngine);
  }

  toggle() {
    this.gui.show(this.gui._hidden);
  }

  dispose() {
    this.gui.destroy();
  }
}
