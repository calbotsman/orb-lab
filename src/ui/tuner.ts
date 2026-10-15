import { engineParams } from "../engine/features";
import { presenceParams } from "../engine/presence";
import { defaultsOf, isColor, type NumberParam, type ParamValues, type Variant } from "../variants/types";

const key = (id: string) => `orb-lab:params:${id}`;
const ENGINE_KEY = "orb-lab:engine";
const PRESENCE_KEY = "orb-lab:presence";
const OPEN_KEY = "orb-lab:tuner-open";

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
const ENGINE_DEFAULTS = { ...engineParams };

/** Persist the shared presence settings (used when a behaviour preset is picked). */
export function savePresence() {
  save(PRESENCE_KEY, presenceParams);
}

/** Current values for a variant: defaults overlaid with whatever you last tuned. */
export function paramsFor(v: Variant): ParamValues {
  const defaults = defaultsOf(v.params);
  const stored = load(key(v.id));
  for (const k of Object.keys(defaults)) if (k in stored) defaults[k] = stored[k] as number | string;
  return defaults;
}

// How the orb behaves in conversation — shared by every variant that reads sig.body.
const PRESENCE: Array<[keyof typeof presenceParams, number, number, string]> = [
  ["breathRate", 0.05, 0.6, "breath rate (Hz)"],
  ["breathDepth", 0, 2, "breath depth"],
  ["listenBreath", 0, 1, "breath while listening"],
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
const ENGINE: Array<[keyof typeof engineParams, number, number, number, string]> = [
  ["floorDb", -90, -30, 1, "level floor (dB)"],
  ["ceilDb", -40, 0, 1, "level ceiling (dB)"],
  ["vadOn", 0.02, 0.8, 0.01, "voice on"],
  ["vadOff", 0.01, 0.6, 0.01, "voice off"],
  ["vadHangMs", 50, 1000, 10, "voice hang (ms)"],
  ["onsetSensitivity", 1.05, 4, 0.05, "onset threshold"],
  ["bargeIn", 0.1, 1, 0.01, "barge-in level"],
];

// A variant's params are flat; sort them into what the orb is, how it answers voice, and its colours.
const isResponse = (label: string) => /[→←]|temperature|time \(s\)/.test(label);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const fmt = (v: number, step: number) => {
  const dp = step >= 1 ? 0 : Math.min(3, Math.max(0, Math.ceil(-Math.log10(step))));
  return String(Number(v.toFixed(dp)));
};

/** The right-hand drawer: one paper sheet of grouped controls, closed by default. */
export class Tuner {
  private root: HTMLElement;
  private syncers: Array<() => void> = [];

  constructor(variant: Variant, values: ParamValues, toast: (msg: string) => void, mapping = "") {
    const persist = () => save(key(variant.id), values);
    const defaults = defaultsOf(variant.params);

    this.root = el("aside", "drawer");
    this.root.setAttribute("aria-label", `${variant.name} controls`);

    const head = el("header", "drawer-head");
    const title = el("div", "drawer-title");
    title.append(el("h2", "", variant.name), el("p", "drawer-map", mapping));
    const close = el("button", "drawer-close", "×");
    close.setAttribute("aria-label", "Close controls");
    close.onclick = () => this.toggle(false);
    head.append(title, close);

    const body = el("div", "drawer-body");
    const shape = this.section("Shape");
    const response = this.section("Response");
    const colours = this.section("Colour");
    const strip = el("div", "swatches");
    colours.append(strip);

    for (const [k, d] of Object.entries(variant.params)) {
      const label = d.label ?? k;
      if (isColor(d)) {
        strip.append(this.swatch(values, k, label, () => persist()));
        continue;
      }
      const row = this.slider(label, d, () => values[k] as number, (v) => {
        values[k] = v;
        persist();
      }, defaults[k] as number);
      (isResponse(label) ? response : shape).append(row);
    }
    if (shape.childElementCount > 1) body.append(shape);
    if (response.childElementCount > 1) body.append(response);
    if (strip.childElementCount) body.append(colours);

    const presence = this.fold("Presence", "shared by every orb");
    const persistP = () => save(PRESENCE_KEY, presenceParams);
    for (const [k, lo, hi, label] of PRESENCE) {
      presence.append(this.slider(label, { min: lo, max: hi, value: PRESENCE_DEFAULTS[k], step: (hi - lo) / 200 }, () => presenceParams[k], (v) => {
        presenceParams[k] = v;
        persistP();
      }, PRESENCE_DEFAULTS[k]));
    }
    const engine = this.fold("Engine", "voice detection, shared");
    const persistE = () => save(ENGINE_KEY, engineParams);
    for (const [k, lo, hi, step, label] of ENGINE) {
      engine.append(this.slider(label, { min: lo, max: hi, value: ENGINE_DEFAULTS[k], step }, () => engineParams[k], (v) => {
        engineParams[k] = v;
        persistE();
      }, ENGINE_DEFAULTS[k]));
    }
    body.append(presence, engine);

    const foot = el("footer", "drawer-foot");
    const copy = el("button", "", "Copy params");
    copy.onclick = async () => {
      const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => defaults[k] !== v));
      const text = JSON.stringify({ variant: variant.id, changed, all: values, presence: presenceParams }, null, 2);
      try {
        await navigator.clipboard.writeText(text);
        toast("Params copied — paste them into the chat");
      } catch {
        console.log(text);
        toast("Clipboard blocked — params printed to console");
      }
    };
    const reset = el("button", "quiet", "Reset orb");
    reset.title = "Put this orb's own controls back to defaults (presence and engine stay)";
    reset.onclick = () => {
      Object.assign(values, defaults);
      persist();
      this.refresh();
    };
    foot.append(copy, reset);

    this.root.append(head, body, foot);
    document.body.append(this.root);
    this.toggle((load(OPEN_KEY) as unknown) === true);
  }

  private section(name: string) {
    const s = el("section", "drawer-sec");
    s.append(el("h3", "", name));
    return s;
  }

  private fold(name: string, note: string) {
    const d = el("details", "drawer-sec drawer-fold");
    const sum = el("summary");
    sum.append(el("span", "", name), el("small", "", note));
    d.append(sum);
    return d;
  }

  private slider(label: string, d: NumberParam, get: () => number, set: (v: number) => void, def: number) {
    const step = d.step ?? (d.max - d.min) / 200;
    const row = el("label", "ctl");
    const name = el("span", "ctl-name", label);
    const out = el("output", "ctl-val");
    const input = el("input");
    Object.assign(input, { type: "range", min: String(d.min), max: String(d.max), step: String(step) });
    const sync = () => {
      const v = get();
      input.value = String(v);
      out.textContent = fmt(v, step);
      row.classList.toggle("changed", Math.abs(v - def) > step / 2);
    };
    input.oninput = () => {
      set(Number(input.value));
      sync();
    };
    // double-click the name to put just this one back
    name.ondblclick = (e) => {
      e.preventDefault();
      set(def);
      sync();
    };
    name.title = "Double-click to reset";
    row.append(name, out, input);
    this.syncers.push(sync);
    sync();
    return row;
  }

  private swatch(values: ParamValues, k: string, label: string, persist: () => void) {
    const wrap = el("label", "swatch");
    wrap.title = label;
    const input = el("input");
    input.type = "color";
    const sync = () => {
      input.value = String(values[k]);
      wrap.style.setProperty("--c", String(values[k]));
    };
    input.oninput = () => {
      values[k] = input.value;
      persist();
      sync();
    };
    wrap.append(input, el("span", "", label));
    this.syncers.push(sync);
    sync();
    return wrap;
  }

  /** Re-read every control (after a behaviour preset changed the shared presence values). */
  refresh() {
    this.syncers.forEach((s) => s());
  }

  toggle(open = !this.root.classList.contains("open")) {
    this.root.classList.toggle("open", open);
    document.body.classList.toggle("tuning", open);
    save(OPEN_KEY, open);
  }

  dispose() {
    this.root.remove();
  }
}
