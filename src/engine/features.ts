// Per-voice "vocal pattern" features, computed every animation frame from an AnalyserNode.
// Everything is normalised to 0..1 (pitchDelta is -1..1) so variants never touch raw dB/Hz.

export type VoiceFeatures = {
  /** Loudness, fast follower (0..1, dB-mapped). */
  level: number;
  /** Loudness, slow follower — good for breathing/scale. */
  levelSlow: number;
  /** Fast-attack / slow-release envelope (spec: attack 0.6, release 0.93). */
  peak: number;
  bass: number;
  mid: number;
  high: number;
  /** Fundamental frequency in Hz (held while unvoiced; 0 until first voiced frame). */
  pitchHz: number;
  /** Pitch mapped log-scale 80–320 Hz → 0..1. */
  pitch: number;
  /** Intonation: smoothed pitch slope, -1 (falling) .. +1 (rising). */
  pitchDelta: number;
  /** 0..1 confidence the current frame is voiced. */
  voiced: number;
  /** Spectral centroid, log 400–4000 Hz → 0..1. */
  brightness: number;
  /** Decaying pulse that jumps to 1 on a syllable-ish onset. */
  onset: number;
  /** Monotonic count of onsets (variants can diff it to spawn events). */
  onsets: number;
  /** Onsets per second over the last ~2 s, /6 → 0..1. */
  rate: number;
  /** Voice activity with hysteresis. */
  active: boolean;
  /** Smoothed 0..1 version of `active`. */
  presence: number;
  /** 48 log-spaced bins 80 Hz–8 kHz, 0..1 — for meters/rings. */
  spectrum: Float32Array;
};

export const SPECTRUM_BINS = 48;

export function emptyFeatures(): VoiceFeatures {
  return {
    level: 0, levelSlow: 0, peak: 0, bass: 0, mid: 0, high: 0,
    pitchHz: 0, pitch: 0.5, pitchDelta: 0, voiced: 0, brightness: 0,
    onset: 0, onsets: 0, rate: 0, active: false, presence: 0,
    spectrum: new Float32Array(SPECTRUM_BINS),
  };
}

/** Engine-level tunables (exposed in the tuner's "Engine" folder). */
export const engineParams = {
  floorDb: -62, // level 0
  ceilDb: -14, // level 1
  vadOn: 0.22,
  vadOff: 0.12,
  vadHangMs: 280,
  onsetSensitivity: 1.6,
  bargeIn: 0.45, // you must exceed this while the agent talks to count as speaking
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Frame-rate independent exponential smoothing; k is the per-60fps-frame coefficient. */
const ease = (cur: number, target: number, k: number, dt: number) => cur + (target - cur) * (1 - Math.pow(1 - k, dt * 60));

export class FeatureExtractor {
  readonly f = emptyFeatures();
  private time: Float32Array<ArrayBuffer>;
  private freqDb: Float32Array<ArrayBuffer>;
  private mag: Float32Array;
  private prevMag: Float32Array;
  private ds: Float32Array; // 4× decimated buffer for pitch
  private binHz: number;
  private fluxAvg = 0;
  private lastOnsetT = -1;
  private onsetTimes: number[] = [];
  private lastActiveT = -1;
  private prevPitchNorm = 0.5;
  private specEdges: number[];
  private corr: Float32Array;

  constructor(private analyser: AnalyserNode) {
    this.time = new Float32Array(analyser.fftSize);
    this.freqDb = new Float32Array(analyser.frequencyBinCount);
    this.mag = new Float32Array(analyser.frequencyBinCount);
    this.prevMag = new Float32Array(analyser.frequencyBinCount);
    this.ds = new Float32Array(analyser.fftSize >> 2);
    this.corr = new Float32Array(this.ds.length);
    this.binHz = analyser.context.sampleRate / analyser.fftSize;
    this.specEdges = [];
    for (let i = 0; i <= SPECTRUM_BINS; i++) {
      const hz = 80 * Math.pow(8000 / 80, i / SPECTRUM_BINS);
      this.specEdges.push(Math.max(1, Math.round(hz / this.binHz)));
    }
  }

  /** Pull one analyser frame and update every feature. `now` in seconds. */
  update(dt: number, now: number) {
    const f = this.f;
    const p = engineParams;
    this.analyser.getFloatTimeDomainData(this.time);
    this.analyser.getFloatFrequencyData(this.freqDb);

    // ── loudness ────────────────────────────────────────────
    let sum = 0;
    for (let i = 0; i < this.time.length; i++) sum += this.time[i] * this.time[i];
    const rms = Math.sqrt(sum / this.time.length);
    const db = 20 * Math.log10(rms + 1e-9);
    const rawLevel = clamp01((db - p.floorDb) / (p.ceilDb - p.floorDb));
    f.level = ease(f.level, rawLevel, rawLevel > f.level ? 0.5 : 0.18, dt);
    f.levelSlow = ease(f.levelSlow, rawLevel, 0.08, dt);
    if (rawLevel > f.peak) f.peak += (rawLevel - f.peak) * 0.6;
    else f.peak *= Math.pow(0.93, dt * 60);

    // ── spectrum → linear magnitude ─────────────────────────
    for (let i = 0; i < this.freqDb.length; i++) this.mag[i] = Math.pow(10, this.freqDb[i] / 20);

    // bands by Hz (not bin index — works at any sample rate)
    f.bass = ease(f.bass, this.bandLevel(80, 300), 0.3, dt);
    f.mid = ease(f.mid, this.bandLevel(300, 2000), 0.25, dt);
    f.high = ease(f.high, this.bandLevel(2000, 8000), 0.2, dt);

    // log spectrum for rings / meters
    for (let b = 0; b < SPECTRUM_BINS; b++) {
      const lo = this.specEdges[b];
      const hi = Math.max(lo + 1, this.specEdges[b + 1]);
      let m = -Infinity;
      for (let i = lo; i < hi && i < this.freqDb.length; i++) m = Math.max(m, this.freqDb[i]);
      const v = clamp01((m - (p.floorDb - 30)) / 60);
      f.spectrum[b] = ease(f.spectrum[b], v, v > f.spectrum[b] ? 0.55 : 0.15, dt);
    }

    // brightness: spectral centroid 100 Hz – 8 kHz
    let num = 0;
    let den = 0;
    const c0 = Math.round(100 / this.binHz);
    const c1 = Math.min(this.mag.length, Math.round(8000 / this.binHz));
    for (let i = c0; i < c1; i++) {
      num += i * this.binHz * this.mag[i];
      den += this.mag[i];
    }
    const centroid = den > 0 ? num / den : 0;
    const bright = centroid > 0 ? clamp01(Math.log2(centroid / 400) / Math.log2(10)) : 0;
    if (rawLevel > 0.08) f.brightness = ease(f.brightness, bright, 0.12, dt);

    // ── onsets: positive spectral flux 100 Hz – 4 kHz ───────
    let flux = 0;
    const o1 = Math.min(this.mag.length, Math.round(4000 / this.binHz));
    for (let i = c0; i < o1; i++) {
      const d = this.mag[i] - this.prevMag[i];
      if (d > 0) flux += d;
    }
    this.prevMag.set(this.mag);
    const isOnset =
      flux > this.fluxAvg * p.onsetSensitivity + 0.002 && rawLevel > p.vadOff && now - this.lastOnsetT > 0.09;
    this.fluxAvg = ease(this.fluxAvg, flux, 0.05, dt);
    if (isOnset) {
      this.lastOnsetT = now;
      f.onset = 1;
      f.onsets++;
      this.onsetTimes.push(now);
    } else {
      f.onset *= Math.pow(0.86, dt * 60);
    }
    while (this.onsetTimes.length && now - this.onsetTimes[0] > 2) this.onsetTimes.shift();
    f.rate = ease(f.rate, clamp01(this.onsetTimes.length / 2 / 6), 0.08, dt);

    // ── pitch: autocorrelation on 4× decimated signal ───────
    this.detectPitch(rawLevel, dt);

    // ── voice activity with hysteresis ──────────────────────
    if (f.level > p.vadOn) {
      f.active = true;
      this.lastActiveT = now;
    } else if (f.level > p.vadOff) {
      if (f.active) this.lastActiveT = now;
    } else if (f.active && (now - this.lastActiveT) * 1000 > p.vadHangMs) {
      f.active = false;
    }
    f.presence = ease(f.presence, f.active ? 1 : 0, f.active ? 0.2 : 0.06, dt);
  }

  private bandLevel(loHz: number, hiHz: number) {
    const lo = Math.max(1, Math.round(loHz / this.binHz));
    const hi = Math.min(this.freqDb.length, Math.round(hiHz / this.binHz));
    let s = 0;
    for (let i = lo; i < hi; i++) s += this.freqDb[i];
    const meanDb = s / Math.max(1, hi - lo);
    return clamp01((meanDb - (engineParams.floorDb - 35)) / 50);
  }

  private detectPitch(rawLevel: number, dt: number) {
    const f = this.f;
    const sr = this.analyser.context.sampleRate / 4;
    const x = this.ds;
    for (let i = 0; i < x.length; i++) {
      const j = i * 4;
      x[i] = (this.time[j] + this.time[j + 1] + this.time[j + 2] + this.time[j + 3]) * 0.25;
    }
    const minLag = Math.floor(sr / 400);
    const maxLag = Math.min(x.length - 32, Math.ceil(sr / 70));
    let r0 = 0;
    for (let i = 0; i < x.length; i++) r0 += x[i] * x[i];
    let best = 0;
    let bestLag = -1;
    const corr = this.corr;
    for (let lag = minLag; lag <= maxLag + 1; lag++) {
      let s = 0;
      for (let i = 0; i < x.length - lag; i++) s += x[i] * x[i + lag];
      corr[lag] = s / (r0 + 1e-9);
    }
    // first strong peak (avoids octave-down errors)
    for (let lag = minLag + 1; lag <= maxLag; lag++) {
      const v = corr[lag];
      if (v > corr[lag - 1] && v >= corr[lag + 1] && v > 0.45) {
        if (v > best * 1.1) {
          best = v;
          bestLag = lag;
        }
        if (v > 0.75) break;
      }
    }
    const voiced = bestLag > 0 && rawLevel > engineParams.vadOff ? clamp01((best - 0.45) / 0.4) : 0;
    f.voiced = ease(f.voiced, voiced, 0.3, dt);
    if (voiced > 0.2) {
      // parabolic interpolation
      const a = corr[bestLag - 1];
      const b = corr[bestLag];
      const c = corr[bestLag + 1];
      const den = a - 2 * b + c;
      const shift = den < 0 ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * den))) : 0;
      const hz = Math.max(70, Math.min(400, sr / (bestLag + shift)));
      f.pitchHz = f.pitchHz ? ease(f.pitchHz, hz, 0.35, dt) : hz;
      const norm = clamp01(Math.log2(f.pitchHz / 80) / 2);
      const slope = (norm - this.prevPitchNorm) / Math.max(dt, 1 / 240);
      f.pitchDelta = ease(f.pitchDelta, Math.max(-1, Math.min(1, slope * 0.6)), 0.12, dt);
      this.prevPitchNorm = norm;
      f.pitch = ease(f.pitch, norm, 0.2, dt);
    } else {
      f.pitchDelta = ease(f.pitchDelta, 0, 0.05, dt);
    }
  }
}
