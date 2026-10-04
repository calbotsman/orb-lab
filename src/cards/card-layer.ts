import { calendar, todo, weather, type CalEvent } from "./sample-data";

// Voice-summoned cards. The agent calls tools (show_calendar, show_weather, show_list,
// add_to_list, dismiss_card); each one opens, updates or folds away a card, and returns the
// data so the agent can talk about it. While any card is up, the orb rises and shrinks to
// make room (body.has-cards) and cards unfold out of it, then fold back into it.

type Kind = "calendar" | "weather" | "list";
type Child = Node | string | null | undefined | false;

/** Tiny DOM builder — text always goes in as text nodes, never parsed as HTML. */
function h(tag: string, cls?: string, ...children: Child[]) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export class CardLayer {
  private el: HTMLDivElement;
  private cards = new Map<Kind, HTMLElement>();

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "cards";
    parent.append(this.el);
  }

  get count() {
    return this.cards.size;
  }

  /** Tool entry point — returns the result the agent will see. */
  handleTool(name: string, args: Record<string, unknown>): Record<string, unknown> {
    switch (name) {
      case "show_calendar": {
        const day = args.day === "tomorrow" ? "tomorrow" : "today";
        const data = calendar(day);
        this.show("calendar", this.renderCalendar(data.label, data.events));
        const now = Date.now();
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
        this.show("weather", this.renderWeather(w));
        return { shown: "weather", ...w };
      }
      case "add_to_list": {
        const item = String(args.item ?? "").trim().slice(0, 120);
        if (item) todo.unshift({ text: item, done: false });
        this.show("list", this.renderList(item));
        return { shown: "list", added: item, items: todo };
      }
      case "show_list": {
        this.show("list", this.renderList());
        return { shown: "list", items: todo };
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
    return this.handleTool(kind === "calendar" ? "show_calendar" : kind === "weather" ? "show_weather" : "show_list", { day: "today" });
  }

  private show(kind: Kind, content: HTMLElement[]) {
    const existing = this.cards.get(kind);
    if (existing) {
      existing.replaceChildren(...content);
      existing.animate([{ transform: "scale(1)" }, { transform: "scale(1.02)" }, { transform: "scale(1)" }], { duration: 420, easing: "ease-out" });
      return;
    }
    const card = h("section", `card card-${kind}`, ...content);
    this.el.prepend(card);
    this.cards.set(kind, card);
    this.sync();
    // unfold out of the orb (which sits above the stack)
    card.animate(
      [
        { opacity: 0, transform: "translateY(-90px) scale(0.55)", filter: "blur(14px)" },
        { opacity: 1, transform: "translateY(0) scale(1)", filter: "blur(0)" },
      ],
      { duration: 760, easing: "cubic-bezier(.2,.9,.25,1)", fill: "backwards", delay: 120 },
    );
  }

  private dismiss(kind: Kind) {
    const card = this.cards.get(kind);
    if (!card) return;
    this.cards.delete(kind);
    const a = card.animate(
      [
        { opacity: 1, transform: "translateY(0) scale(1)", filter: "blur(0)" },
        { opacity: 0, transform: "translateY(-110px) scale(0.5)", filter: "blur(16px)" },
      ],
      { duration: 520, easing: "cubic-bezier(.5,0,.75,0)", fill: "forwards" },
    );
    a.onfinish = () => {
      card.remove();
      this.sync();
    };
  }

  private sync() {
    document.body.classList.toggle("has-cards", this.cards.size > 0);
  }

  // ── renderers ──────────────────────────────────────────
  private header(icon: string, title: string) {
    return h("header", "", h("span", "ico", icon), title);
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
    return [this.header("📅", label), h("ul", "events", ...rows)];
  }

  private renderWeather(w: ReturnType<typeof weather>) {
    const hours = w.hourly.map((x) => h("li", "", h("span", "", x.label), h("b", "", x.icon), h("span", "", `${x.temp}°`)));
    return [
      this.header(w.now.icon, w.place),
      h("div", "now", h("span", "big", `${w.now.temp}°`), h("span", "", w.now.condition, h("br"), h("small", "", `H ${w.high}° · L ${w.low}°`))),
      h("ul", "hours", ...hours),
      h("p", "note", w.note),
    ];
  }

  private renderList(added?: string) {
    const rows = todo.map((t) => h("li", [t.done ? "done" : "", added && t.text === added ? "added" : ""].join(" ").trim(), h("span", "box"), t.text));
    return [this.header("✓", "To do"), h("ul", "todo", ...rows)];
  }
}
