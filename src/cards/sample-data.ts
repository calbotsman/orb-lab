// Made-up but plausible data for the voice-cards experiment. Nothing here is real or personal.
// Times are built relative to "now" so the calendar always has a past, a next, and later events.

export type CalEvent = { start: Date; end: Date; title: string; where?: string };

function at(dayOffset: number, h: number, m = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
}

export function calendar(day: "today" | "tomorrow"): { label: string; events: CalEvent[] } {
  const off = day === "tomorrow" ? 1 : 0;
  const ev = (h: number, m: number, mins: number, title: string, where?: string): CalEvent => {
    const start = at(off, h, m);
    return { start, end: new Date(start.getTime() + mins * 60_000), title, where };
  };
  const events =
    day === "today"
      ? [
          ev(9, 30, 15, "Standup", "Video call"),
          ev(11, 0, 45, "Coffee with Maya", "Café on Bedford"),
          ev(13, 0, 60, "Lunch"),
          ev(15, 0, 60, "Design review: voice prototype", "Studio B"),
          ev(18, 30, 90, "Climbing", "Bouldering gym"),
        ]
      : [
          ev(8, 45, 30, "Dentist", "Dr. Okafor"),
          ev(11, 30, 60, "Client call: Q4 launch"),
          ev(16, 0, 30, "1:1 with Priya"),
          ev(19, 30, 120, "Dinner with Sam", "Lilia"),
        ];
  const label = at(off, 12).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  return { label: `${day === "today" ? "Today" : "Tomorrow"} · ${label}`, events };
}

export function weather() {
  const hour = new Date().getHours();
  const hourly = Array.from({ length: 6 }, (_, i) => {
    const h = (hour + i + 1) % 24;
    const temp = Math.round(63 + 5 * Math.sin(((h - 9) / 24) * Math.PI * 2));
    const rain = h >= 18 && h <= 22;
    return { label: new Date(0, 0, 0, h).toLocaleTimeString(undefined, { hour: "numeric" }), temp, icon: rain ? "🌧" : h >= 20 || h < 6 ? "🌙" : "⛅️" };
  });
  return {
    place: "Brooklyn, NY",
    now: { temp: 64, condition: "Partly cloudy", icon: "⛅️" },
    high: 68,
    low: 55,
    note: "Light rain likely after 6 pm",
    hourly,
  };
}

export const todo: { text: string; done: boolean }[] = [
  { text: "Buy oat milk", done: false },
  { text: "Book flights for December", done: false },
  { text: "Reply to Sam about Saturday", done: true },
  { text: "Water the plants", done: false },
];
