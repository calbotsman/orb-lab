import type { ConversationSignal } from "../engine/conversation";
import { calendar, todo, weather, type CalEvent } from "./sample-data";

// Voice-summoned cards. The agent calls tools (show_calendar, show_weather, show_list,
// add_to_list, set_timer, dismiss_card); each one opens, updates or folds away a card, and
// returns the data so the agent can talk about it.
//
// How a card arrives and leaves is the experiment. Four styles:
//   unfold    — the orb rises and shrinks; cards unfold out of it, fold back in on dismiss
//   morph     — the orb *becomes* the card: it pours out of a circle into the card shape and the
//               orb dims while it's open; on dismiss the card drains back into the orb
//   narrate   — like unfold, but rows appear as the agent talks, paced by its syllables
//   satellite — the orb stays centre stage; cards arrive as small chips beside it, tap to open

export type Kind = "calendar" | "weather" | "list" | "timer";
export type CardStyle = "unfold" | "morph" | "narrate" | "satellite";
export const CARD_STYLES: CardStyle[] = ["unfold", "morph", "narrate", "satellite"];
type Child = Node | string | null | undefined | false;

/** Tiny DOM builder — text always goes in as text nodes, never parsed as HTML. */
function h(tag: string, cls?: string, ...children: Child[]) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const EASE_OUT = "cubic-bezier(.2,.8,.2,1)";
const EASE_IN = "cubic-bezier(.5,0,.75,0)";
const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;

// Mono sigils, not emoji: the cards are readouts the bench prints.
const SIGIL: Record<Kind, string> = { calendar: "CAL", weather: "WX", list: "DO", timer: "TMR" };
const SKY: Record<string, [string, string]> = { "🌧": ["RN", "rain"], "🌙": ["CLR", "night"], "⛅️": ["CLD", "cloud"] };
const sky = (icon: string) => SKY[icon] ?? ["—", ""];

type Card = {
  el: HTMLElement;
  summary: () => string; // one line, for satellite chips
  full: () => HTMLElement[];
  revealed: number; // narrate: rows shown so far
  shownAt: number;
};

export class CardLayer {
  private el: HTMLDivElement;
  private cards = new Map<Kind, Card>();
  private style: CardStyle = "unfold";
  private timer: { endsAt: number; label: string; total: number } | null = null;
  private lastAgentOnsets = 0;
  private agentQuietSince = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "cards";
    parent.append(this.el);
    this.setStyle(this.style);
  }

  get count() {
    return this.cards.size;
  }

  setStyle(style: CardStyle) {
    // swap styles cleanly: clear what's up, then switch layout
    for (const k of [...this.cards.keys()]) this.remove(k);
    this.style = style;
    this.el.className = `cards cards-${style}`;
    document.body.dataset.cardStyle = style;
    this.sync();
  }

  /** Tool entry point — returns the result the agent will see. */
  handleTool(name: string, args: Record<string, unknown>): Record<string, unknown> {
    switch (name) {
      case "show_calendar": {
        const day = args.day === "tomorrow" ? "tomorrow" : "today";
        const data = calendar(day);
        const now = Date.now();
        const next = data.events.find((e) => e.end.getTime() >= now);
        this.show("calendar", () => this.renderCalendar(data.label, data.events), () =>
          `${data.events.length} events${next && day === "today" ? ` · next ${time(next.start)} ${next.title}` : ""}`,
        );
        return {
          shown: "calendar",
          day: data.label,
          now: time(new Date()),
          events: data.events.map((e) => ({
            time: time(e.start),
            title: e.title,
            where: e.where ?? null,
            status: e.end.getTime() < now ? "done" : e.start.getTime() <= now ? "happening now" : "upcoming",
          })),
        };
      }
      case "show_weather": {
        const w = weather();
        this.show("weather", () => this.renderWeather(w), () => `${w.now.temp}° ${w.now.condition.toLowerCase()} · ${w.note.toLowerCase()}`);
        return { shown: "weather", ...w };
      }
      case "add_to_list": {
        const item = String(args.item ?? "").trim().slice(0, 120);
        if (item) todo.unshift({ text: item, done: false });
        this.show("list", () => this.renderList(item), () => this.listSummary());
        return { shown: "list", added: item, items: todo };
      }
      case "show_list": {
        this.show("list", () => this.renderList(), () => this.listSummary());
        return { shown: "list", items: todo };
      }
      case "set_timer": {
        const minutes = Math.max(0.05, Math.min(180, Number(args.minutes) || 1));
        const label = String(args.label ?? "").trim().slice(0, 40);
        this.timer = { endsAt: Date.now() + minutes * 60_000, label, total: minutes * 60 };
        this.show("timer", () => this.renderTimer(), () => `${label || "Timer"} · ${mmss(this.timer ? (this.timer.endsAt - Date.now()) / 1000 : 0)}`);
        return { shown: "timer", minutes, label: label || null, endsAt: time(new Date(this.timer.endsAt)) };
      }
      case "dismiss_card": {
        const which = String(args.card ?? "all");
        const dismissed = which === "all" ? [...this.cards.keys()] : this.cards.has(which as Kind) ? [which] : [];
        dismissed.forEach((k) => this.dismiss(k as Kind));
        return { dismissed, stillShowing: [...this.cards.keys()].filter((k) => !dismissed.includes(k)) };
      }
      default:
        return { error: `unknown tool ${name}` };
    }
  }

  /** Dev shortcut: toggle a card without a voice session. */
  toggle(kind: Kind | "all") {
    if (kind === "all") return this.handleTool("dismiss_card", { card: "all" });
    if (this.cards.has(kind)) return this.handleTool("dismiss_card", { card: kind });
    const tool = { calendar: "show_calendar", weather: "show_weather", list: "show_list", timer: "set_timer" }[kind];
    return this.handleTool(tool, { day: "today", minutes: 0.5, label: "Tea" });
  }

  /** Per frame: narrate pacing, live timer. `now` in seconds. */
  frame(s: ConversationSignal, now: number) {
    // narrate: one more row per few of the agent's syllables; everything once it goes quiet
    const ag = s.agent;
    const newSyllables = ag.onsets - this.lastAgentOnsets;
    this.lastAgentOnsets = ag.onsets;
    if (ag.active) this.agentQuietSince = now;
    if (this.style === "narrate") {
      for (const card of this.cards.values()) {
        const rows = card.el.querySelectorAll<HTMLElement>("li");
        const quietFor = now - this.agentQuietSince;
        const age = now - card.shownAt;
        let target = card.revealed;
        if (newSyllables > 0 && ag.active) target += newSyllables * 0.34;
        if (age > 1.2 && quietFor > 1.4) target = rows.length; // the agent stopped: hold nothing back
        card.revealed = Math.min(rows.length, target);
        rows.forEach((r, i) => r.classList.toggle("pending", i >= Math.floor(card.revealed)));
      }
    }
    // live timer
    const t = this.cards.get("timer");
    if (t && this.timer) {
      const left = (this.timer.endsAt - Date.now()) / 1000;
      const big = t.el.querySelector(".timer-big");
      if (big) big.textContent = left > 0 ? mmss(left) : "Done";
      const ring = t.el.querySelector<HTMLElement>(".timer-ring");
      if (ring) ring.style.setProperty("--p", String(Math.max(0, Math.min(1, left / this.timer.total))));
      t.el.classList.toggle("timer-done", left <= 0);
      // done: two red pulses, then it folds itself away
      if (left <= -1.4) this.dismiss("timer");
      const chip = t.el.querySelector(".chip-line");
      if (chip) chip.textContent = t.summary();
    }
  }

  // ── show / dismiss per style ─────────────────────────────
  private show(kind: Kind, full: () => HTMLElement[], summary: () => string) {
    const existing = this.cards.get(kind);
    if (existing) {
      existing.full = full;
      existing.summary = summary;
      this.fill(existing, kind);
      // an update is a state change, not a bounce: the edge inks for a beat
      existing.el.animate([{ borderColor: "var(--fg)" }, { borderColor: "var(--line)" }], { duration: 480, easing: EASE_OUT });
      return;
    }
    const card: Card = { el: h("section", `card card-${kind}`), full, summary, revealed: 0, shownAt: performance.now() / 1000 };
    this.fill(card, kind);
    this.el.prepend(card.el);
    this.cards.set(kind, card);
    this.sync();
    this.animateIn(card.el);
  }

  private fill(card: Card, kind: Kind) {
    if (this.style === "satellite") {
      const head = h("button", "chip-head", h("span", "sigil", SIGIL[kind]), h("span", "chip-line", card.summary()));
      head.onclick = () => card.el.classList.toggle("open");
      card.el.replaceChildren(head, h("div", "chip-body", ...card.full()));
      card.el.classList.add("chip");
    } else {
      card.el.replaceChildren(...card.full());
      if (this.style === "narrate") card.el.querySelectorAll("li").forEach((r, i) => r.classList.toggle("pending", i >= Math.floor(card.revealed)));
    }
  }

  // Quick and quiet: 160–320 ms, ease-out in, ease-in out, nothing bounces.
  private animateIn(el: HTMLElement) {
    if (this.style === "morph") {
      // the orb's iris opens into the sheet, then the contents settle
      el.animate([{ clipPath: "circle(22px at 50% -40px)" }, { clipPath: "circle(150% at 50% 0)" }], { duration: 320, easing: EASE_OUT, fill: "backwards" });
      el.querySelectorAll<HTMLElement>(":scope > *").forEach((c, i) =>
        c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: 180 + i * 40, fill: "backwards" }),
      );
      return;
    }
    // unfold, narrate, satellite: a slip drops out of the orb
    el.animate(
      [
        { opacity: 0, transform: "translateY(-16px) scale(0.96)", filter: "blur(4px)" },
        { opacity: 1, transform: "none", filter: "blur(0)" },
      ],
      { duration: 240, easing: EASE_OUT, fill: "backwards", delay: this.style === "satellite" ? 0 : 60 },
    );
  }

  private dismiss(kind: Kind) {
    const card = this.cards.get(kind);
    if (!card) return;
    this.cards.delete(kind);
    if (kind === "timer") this.timer = null;
    const el = card.el;
    const frames: Keyframe[] =
      this.style === "morph"
        ? [{ clipPath: "circle(150% at 50% 0)" }, { clipPath: "circle(18px at 50% -40px)" }]
        : [{ opacity: 1, transform: "none", filter: "blur(0)" }, { opacity: 0, transform: "translateY(-20px) scale(0.96)", filter: "blur(4px)" }];
    const a = el.animate(frames, { duration: this.style === "morph" ? 240 : 200, easing: EASE_IN, fill: "forwards" });
    a.onfinish = () => el.remove();
    // the orb starts returning while the last card leaves
    if (this.cards.size === 0) setTimeout(() => this.sync(), 120);
  }

  private remove(kind: Kind) {
    this.cards.get(kind)?.el.remove();
    this.cards.delete(kind);
    if (kind === "timer") this.timer = null;
  }

  private sync() {
    document.body.classList.toggle("has-cards", this.cards.size > 0);
  }

  // ── renderers ──────────────────────────────────────────
  private header(kind: Kind, title: string, meta?: string) {
    return h("header", "", h("span", "sigil", SIGIL[kind]), h("span", "title", title), meta && h("span", "meta", meta));
  }

  private listSummary() {
    const open = todo.filter((t) => !t.done).length;
    return `${open} to do${todo[0] ? ` · ${todo[0].text}` : ""}`;
  }

  private renderCalendar(label: string, events: CalEvent[]) {
    const now = Date.now();
    const nextIdx = events.findIndex((e) => e.end.getTime() >= now);
    const rows = events.map((e, i) =>
      h(
        "li",
        e.end.getTime() < now ? "past" : i === nextIdx ? "next" : "",
        h("span", "t", time(e.start)),
        h("span", "what", e.title, e.where && h("em", "", e.where)),
      ),
    );
    const [day, date] = label.split(" · ");
    return [this.header("calendar", day, date), h("ul", "events", ...rows)];
  }

  private renderWeather(w: ReturnType<typeof weather>) {
    const hours = w.hourly.map((x) => {
      const [code, cls] = sky(x.icon);
      return h("li", "", h("span", "h", x.label), h("span", `sky ${cls}`, code), h("span", "", `${x.temp}°`));
    });
    return [
      this.header("weather", w.place, "now"),
      h("div", "now", h("span", "big", `${w.now.temp}°`), h("span", "cond", w.now.condition, h("small", "", `H ${w.high}° · L ${w.low}°`))),
      h("ul", "hours", ...hours),
      h("p", "note", w.note),
    ];
  }

  private renderList(added?: string) {
    const rows = todo.map((t) => h("li", [t.done ? "done" : "", added && t.text === added ? "added" : ""].join(" ").trim(), h("span", "box"), t.text));
    const open = todo.filter((t) => !t.done).length;
    return [this.header("list", "To do", `${open} open`), h("ul", "todo", ...rows)];
  }

  private renderTimer() {
    const t = this.timer;
    const ring = h("div", "timer-ring", h("span", "timer-big", mmss(t ? (t.endsAt - Date.now()) / 1000 : 0)));
    return [this.header("timer", t?.label || "Timer", t ? `ends ${time(new Date(t.endsAt))}` : undefined), ring];
  }
}
