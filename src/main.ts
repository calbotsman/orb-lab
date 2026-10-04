import { AudioGraph } from "./engine/audio-graph";
import { Conversation } from "./engine/conversation";
import { FeatureExtractor } from "./engine/features";
import { Mic } from "./engine/mic";
import { Player } from "./engine/player";
import { GeminiAgent } from "./engine/gemini-agent";
import { SimConversation } from "./engine/sim";
import { Hud } from "./ui/hud";
import { Tuner, loadEngineParams, paramsFor } from "./ui/tuner";
import { VARIANTS } from "./variants";
import type { Variant, VariantInstance } from "./variants/types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $<HTMLDivElement>("stage");
const talkBtn = $<HTMLButtonElement>("talk");
const simBtn = $<HTMLButtonElement>("sim");
const micBtn = $<HTMLButtonElement>("mic-only");
const toastEl = $<HTMLDivElement>("toast");

let toastTimer = 0;
function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 2600);
}

loadEngineParams();

// ── audio engine (created lazily inside the first user gesture) ──
let graph: AudioGraph | null = null;
let mic: Mic | null = null;
let player: Player | null = null;
let youFx: FeatureExtractor | null = null;
let agentFx: FeatureExtractor | null = null;
let convo: Conversation | null = null;
let agent: GeminiAgent | null = null;
let sim: SimConversation | null = null;
let status = "offline";

function ensureGraph() {
  if (graph) return graph;
  graph = new AudioGraph();
  mic = new Mic(graph);
  player = new Player(graph);
  youFx = new FeatureExtractor(graph.youAnalyser);
  agentFx = new FeatureExtractor(graph.agentAnalyser);
  convo = new Conversation(youFx.f, agentFx.f);
  return graph;
}

async function startTalk() {
  const g = ensureGraph();
  await g.resume();
  stopSim();
  status = "connecting…";
  talkBtn.textContent = "Connecting…";
  agent = new GeminiAgent({
    onReady: (i) => toast(`Agent is live · say hello (${Math.round(i.sessionSeconds / 60)} min session)`),
    onAudio: (b64) => player!.enqueue(b64),
    onInterrupted: () => player!.stop(),
    onError: (m) => toast(m),
    onClose: () => {
      if (agent) stopTalk("session ended");
    },
  });
  try {
    await agent.connect();
    await mic!.start((b64) => agent?.sendAudio(b64));
    status = "live";
    talkBtn.textContent = "Hang up";
    talkBtn.classList.add("on");
  } catch (e) {
    agent?.close();
    agent = null;
    mic?.stop();
    status = "offline";
    talkBtn.textContent = "Talk to agent";
    const msg = e instanceof Error ? e.message : String(e);
    toast(msg);
  }
}

function stopTalk(reason = "offline") {
  const r = agent;
  agent = null;
  r?.close();
  mic?.stop();
  player?.stop();
  status = reason;
  talkBtn.textContent = "Talk to agent";
  talkBtn.classList.remove("on");
}

function startSim() {
  const g = ensureGraph();
  void g.resume();
  if (agent) stopTalk();
  sim = new SimConversation(g);
  status = "sim";
  simBtn.classList.add("on");
}
function stopSim() {
  sim?.dispose();
  sim = null;
  if (status === "sim") status = "offline";
  simBtn.classList.remove("on");
}

async function toggleMicOnly() {
  const g = ensureGraph();
  await g.resume();
  if (mic!.on && !agent) {
    mic!.stop();
    micBtn.classList.remove("on");
    if (status === "mic") status = "offline";
    return;
  }
  if (agent) return;
  try {
    await mic!.start(null);
    micBtn.classList.add("on");
    status = "mic";
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}

talkBtn.onclick = () => (agent ? stopTalk() : void startTalk());
simBtn.onclick = () => (sim ? stopSim() : startSim());
micBtn.onclick = () => void toggleMicOnly();

// ── variants ──
const hud = new Hud(document.body);
let current: { id: string; inst: VariantInstance; tuner: Tuner; mapping: string } | null = null;

function select(id: string) {
  const v = VARIANTS.find((x) => x.id === id) ?? VARIANTS[0];
  if (current) {
    current.inst.dispose();
    current.tuner.dispose();
    stage.replaceChildren();
  }
  document.body.classList.toggle("dark", v.theme === "dark");
  const values = paramsFor(v);
  const inst = v.mount(stage, values);
  inst.resize(stage.clientWidth, stage.clientHeight);
  current = { id: v.id, inst, tuner: new Tuner(v, values, toast), mapping: `${v.credit ? `concept: ${v.credit} · ` : ""}${v.mapping}` };
  const url = new URL(location.href);
  url.searchParams.set("v", v.id);
  history.replaceState(null, "", url);
  group = groupOf(v);
  renderTabs();
}

// Tabs are grouped by each variant's `group` (default "Lab").
const groupOf = (v: Variant) => v.group ?? "Lab";
const GROUPS = [...new Set(VARIANTS.map(groupOf))];
let group = "";
const groupsEl = $<HTMLElement>("groups");
const tabs = $<HTMLElement>("tabs");
const inGroup = () => VARIANTS.filter((v) => groupOf(v) === group);

function renderTabs() {
  groupsEl.replaceChildren(
    ...GROUPS.map((g) => {
      const b = document.createElement("button");
      b.textContent = g;
      b.classList.toggle("on", g === group);
      b.onclick = () => select(VARIANTS.find((v) => groupOf(v) === g)!.id);
      return b;
    }),
  );
  tabs.replaceChildren(
    ...inGroup().map((v, i) => {
      const b = document.createElement("button");
      b.dataset.id = v.id;
      b.textContent = `${i < 9 ? `${i + 1} ` : ""}${v.name}${v.credit ? ` · ${v.credit.split(" ")[0]}` : ""}`;
      b.classList.toggle("on", v.id === current?.id);
      b.onclick = () => select(v.id);
      return b;
    }),
  );
}

window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest(".lil-gui")) return;
  const n = Number(e.key);
  if (n >= 1 && n <= inGroup().length) select(inGroup()[n - 1].id);
  else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    const i = VARIANTS.findIndex((x) => x.id === current?.id);
    const step = e.key === "ArrowRight" ? 1 : -1;
    select(VARIANTS[(i + step + VARIANTS.length) % VARIANTS.length].id);
  } else if (e.key === " ") {
    e.preventDefault();
    talkBtn.click();
  } else if (e.key === "s" || e.key === "S") simBtn.click();
  else if (e.key === "h" || e.key === "H") hud.toggle();
  else if (e.key === "g" || e.key === "G") current?.tuner.toggle();
});
window.addEventListener("resize", () => current?.inst.resize(stage.clientWidth, stage.clientHeight));

select(new URLSearchParams(location.search).get("v") ?? VARIANTS[0].id);

// ── frame loop ──
// Before the first gesture there is no AudioContext; run a silent stand-in so variants idle.
const silentAnalyserCtx = new OfflineAudioContext(1, 128, 48000);
const silentA = new FeatureExtractor(silentAnalyserCtx.createAnalyser());
const silentB = new FeatureExtractor(silentAnalyserCtx.createAnalyser());
const silentConvo = new Conversation(silentA.f, silentB.f);

let last = performance.now();
function frame(nowMs: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;
  const now = nowMs / 1000;
  let sig = silentConvo.sig;
  if (graph && youFx && agentFx && convo) {
    youFx.update(dt, now);
    agentFx.update(dt, now);
    const live = !!agent || !!sim || !!mic?.on;
    convo.update(dt, now, live, !!player?.playing || !!sim?.agentPlaying);
    sig = convo.sig;
  } else {
    silentConvo.update(dt, now, false, false);
  }
  current?.inst.frame(sig, dt);
  hud.draw(sig, current?.mapping ?? "", status);
}
requestAnimationFrame(frame);
