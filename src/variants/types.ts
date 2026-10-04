import type { ConversationSignal } from "../engine/conversation";

export type NumberParam = { min: number; max: number; step?: number; value: number; label?: string };
export type ColorParam = { color: string; label?: string };
export type ParamDef = NumberParam | ColorParam;
export type ParamSchema = Record<string, ParamDef>;
/** Live values — the tuner mutates this object in place, so read it every frame. */
export type ParamValues = Record<string, number | string>;

export interface VariantInstance {
  frame(sig: ConversationSignal, dt: number): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

export interface Variant {
  id: string;
  name: string;
  theme: "light" | "dark";
  /** One line: what each voice drives. Shown in the HUD. */
  mapping: string;
  /** Optional author / attribution, shown in the HUD and on the tab. */
  credit?: string;
  /** Tab group; defaults to "Lab". */
  group?: string;
  params: ParamSchema;
  mount(el: HTMLElement, p: ParamValues): VariantInstance;
}

export const isColor = (d: ParamDef): d is ColorParam => "color" in d;

export function defaultsOf(schema: ParamSchema): ParamValues {
  const out: ParamValues = {};
  for (const [k, d] of Object.entries(schema)) out[k] = isColor(d) ? d.color : d.value;
  return out;
}

export const num = (p: ParamValues, k: string) => p[k] as number;
export const col = (p: ParamValues, k: string) => p[k] as string;
