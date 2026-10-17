import { autoCorrelate, hslToRgb, makeFFT, type FFT } from "./dsp";
import { NOTE_NAMES, freqToMidiF, midiName, midiToFreq, pcHue } from "./tunings";

export type LabParams = {
  fftN: number;
  win: number;
  reassign: number;
  reasMax: number;
  span: number;
  rowsPerSemi: number;
  scroll: number;
  cols: number;
  floorDb: number;
  rangeDb: number;
  gainDb: number;
  gamma: number;
  thick: number;
  decay: number;
  bright: number;
  accum: number;
  follow: number;
  eqOn: number;
  eqLowMargin: number;
  eqHarm: number;
  eqSlope: number;
  hum: number;
  nsStrength: number;
  nsTime: number;
  nsFloor: number;
  harmEmph: number;
  harmCount: number;
  harmTol: number;
  persist: number;
  pitchSrc: number;
  followHold: number;
  confMin: number;
};

export const DEFAULT_LAB: LabParams = {
  fftN: 8192,
  win: 1,
  reassign: 1,
  reasMax: 0.9,
  span: 13,
  rowsPerSemi: 40,
  scroll: 30,
  cols: 460,
  floorDb: -96,
  rangeDb: 26,
  gainDb: 0,
  gamma: 1.0,
  thick: 1,
  decay: 0.55,
  bright: 1.0,
  accum: 0,
  follow: 1,
  eqOn: 1,
  eqLowMargin: 6,
  eqHarm: 5,
  eqSlope: 2,
  hum: 50,
  nsStrength: 1.5,
  nsTime: 3,
  nsFloor: 0.06,
  harmEmph: 0.6,
  harmCount: 6,
  harmTol: 30,
  persist: 4,
  pitchSrc: 1,
  followHold: 8,
  confMin: 0.25,
};

export type AxisWindow = { lo: number; hi: number };

export type LabRebuild = "fft" | "buf" | "eq";

export type EngineElements = {
  canvas: HTMLCanvasElement;
  needle: SVGGElement;
  needleShadow: SVGGElement;
  noteEl: HTMLElement;
  centsEl: HTMLElement;
  freqEl: HTMLElement;
  specReadoutEl: HTMLElement;
  markerEl: HTMLElement;
};

export type EngineEvents = {
  onStatus: (text: string, isError: boolean) => void;
  onListening: (on: boolean) => void;
  onActiveString: (index: number) => void;
  onAxis: (win: AxisWindow) => void;
};

const MIDI_MIN = 24;
const MIDI_MAX = 96;

export class TunerEngine {
  readonly P: LabParams;
  private a4: number;
  private strings: number[] = [];
  private hlSet = new Set<number>();
  private canTrack = true;

  private midiCenter = 52;
  private midiLo = 46;
  private midiHi = 59;
  private axisInitialised = false;
  private lastAxisEmit = "";
  private followPauseUntil = 0;

  private bandLo = 60;
  private bandHi = 1200;

  private audioCtx: AudioContext | null = null;
  private anTime: AnalyserNode | null = null;
  private anFreq: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private rafId = 0;
  private listening = false;
  private hp1: BiquadFilterNode | null = null;
  private hp2: BiquadFilterNode | null = null;
  private lp1: BiquadFilterNode | null = null;
  private lp2: BiquadFilterNode | null = null;
  private humNodes: BiquadFilterNode[] = [];
  private eqHp: BiquadFilterNode[] = [];
  private eqLp: BiquadFilterNode[] = [];
  private timeData: Float32Array<ArrayBuffer> = new Float32Array(0);

  private fftN = 0;
  private fftRun: FFT | null = null;
  private winBuf: Float32Array = new Float32Array(0);
  private winSum = 1;
  private re1: Float32Array = new Float32Array(0);
  private im1: Float32Array = new Float32Array(0);
  private re2: Float32Array = new Float32Array(0);
  private im2: Float32Array = new Float32Array(0);
  private tap: Float32Array<ArrayBuffer> = new Float32Array(0);
  private binPow: Float32Array = new Float32Array(0);
  private binFreq: Float32Array = new Float32Array(0);
  private binKeep: Uint8Array = new Uint8Array(0);
  private noiseEst: Float32Array = new Float32Array(0);
  private noiseInit = false;

  private COLS: number;
  private ROWS: number;
  private readonly off = document.createElement("canvas");
  private readonly offctx: CanvasRenderingContext2D;
  private colImg: ImageData | null = null;
  private colMag: Float32Array = new Float32Array(0);
  private colPrev: Float32Array = new Float32Array(0);
  private rowHits: Float32Array = new Float32Array(0);
  private rowRGB: [number, number, number][] = [];
  private lastPush = 0;

  private readonly sctx: CanvasRenderingContext2D;
  private CW = 0;
  private CH = 0;

  private specPitch = { f0: 0, conf: 0, string: -1, t: 0 };
  private followCand = -1;
  private followRun = 0;

  private smoothedCents = 0;
  private centsHist: number[] = [];
  private needleInit = false;

  private readonly els: EngineElements;
  private readonly events: EngineEvents;

  constructor(els: EngineElements, events: EngineEvents, params: LabParams, a4: number) {
    this.els = els;
    this.events = events;
    this.P = { ...params };
    this.a4 = a4;
    this.COLS = this.P.cols;
    this.ROWS = this.P.rowsPerSemi * this.P.span;
    const ctx = els.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.sctx = ctx;
    const offCtx = this.off.getContext("2d");
    if (!offCtx) throw new Error("2D canvas unavailable");
    this.offctx = offCtx;
    this.buildFFT();
    this.rebuildSpectro();
    this.resize();
    this.setNeedle(0);
  }

  setStrings(strings: number[], options: { canTrack: boolean; resetAxis: boolean }) {
    this.strings = strings.slice();
    this.hlSet = new Set(strings);
    this.canTrack = options.canTrack;
    if (options.resetAxis) this.axisInitialised = false;
    this.computeAxis();
    this.buildRowColors();
    this.renderSpectro();
    this.applyBandFilter();
    this.applyEQ();
  }

  setA4(a4: number) {
    this.a4 = a4;
    this.applyBandFilter();
    this.applyEQ();
  }

  getCenter() {
    return this.midiCenter;
  }

  panTo(target: number) {
    let c = Math.round(target);
    if (c < MIDI_MIN) c = MIDI_MIN;
    else if (c > MIDI_MAX) c = MIDI_MAX;
    const delta = c - this.midiCenter;
    if (!delta) return;
    this.midiCenter = c;
    this.applyWindow();
    const dy = Math.round(delta * (this.ROWS / this.P.span));
    if (this.off.width && this.off.height && dy) {
      this.offctx.drawImage(this.off, 0, 0, this.COLS, this.ROWS, 0, dy, this.COLS, this.ROWS);
      this.offctx.fillStyle = "#080807";
      if (dy > 0) this.offctx.fillRect(0, 0, this.COLS, dy);
      else this.offctx.fillRect(0, this.ROWS + dy, this.COLS, -dy);
    }
    this.buildRowColors();
    this.renderSpectro();
  }

  pauseFollow(ms: number) {
    this.followPauseUntil = performance.now() + ms;
  }

  setParam<K extends keyof LabParams>(key: K, value: LabParams[K], rebuild?: LabRebuild) {
    this.P[key] = value;
    this.applyParam(key, rebuild);
  }

  applyParam(key: keyof LabParams, rebuild?: LabRebuild) {
    if (rebuild === "fft") {
      this.buildFFT();
      this.rebuildSpectro();
    } else if (rebuild === "buf") {
      this.rebuildSpectro();
      this.computeAxis();
    } else if (rebuild === "eq") {
      this.applyEQ();
      this.noiseInit = false;
    }
    if (key === "nsStrength" || key === "nsTime") this.noiseInit = false;
    this.resize();
  }

  resetParams(defaults: LabParams) {
    Object.assign(this.P, defaults);
    this.buildFFT();
    this.rebuildSpectro();
    this.computeAxis();
    this.resize();
  }

  resize() {
    const r = this.els.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.CW = Math.max(2, Math.round(r.width));
    this.CH = Math.max(2, Math.round(r.height));
    this.els.canvas.width = this.CW * dpr;
    this.els.canvas.height = this.CH * dpr;
    this.sctx.setTransform(1, 0, 0, 1, 0, 0);
    this.sctx.imageSmoothingEnabled = false;
    this.computeAxis();
    this.buildRowColors();
    this.renderSpectro();
  }

  async start(): Promise<void> {
    const bad = insecureReason();
    if (bad) {
      this.events.onStatus(bad, true);
      return;
    }
    this.events.onStatus("Requesting microphone…", false);
    const pending = window.setTimeout(() => {
      this.events.onStatus(
        "Still waiting for microphone permission. Check the permission prompt or the site settings.",
        true,
      );
    }, 6000);
    try {
      const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtor();
      this.audioCtx = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      this.stream = stream;
      const source = ctx.createMediaStreamSource(stream);

      this.humNodes = [1, 2, 3].map(() => {
        const b = ctx.createBiquadFilter();
        b.type = "peaking";
        b.Q.value = 30;
        b.gain.value = 0;
        return b;
      });
      source.connect(this.humNodes[0]);
      this.humNodes[0].connect(this.humNodes[1]);
      this.humNodes[1].connect(this.humNodes[2]);
      const pre = this.humNodes[2];

      const hp1 = ctx.createBiquadFilter();
      hp1.type = "highpass";
      hp1.Q.value = 0.707;
      const hp2 = ctx.createBiquadFilter();
      hp2.type = "highpass";
      hp2.Q.value = 0.707;
      const lp1 = ctx.createBiquadFilter();
      lp1.type = "lowpass";
      lp1.Q.value = 0.707;
      const lp2 = ctx.createBiquadFilter();
      lp2.type = "lowpass";
      lp2.Q.value = 0.707;
      this.hp1 = hp1;
      this.hp2 = hp2;
      this.lp1 = lp1;
      this.lp2 = lp2;
      const anTime = ctx.createAnalyser();
      anTime.fftSize = 2048;
      this.anTime = anTime;
      pre.connect(hp1);
      hp1.connect(hp2);
      hp2.connect(lp1);
      lp1.connect(lp2);
      lp2.connect(anTime);

      this.eqHp = [1, 2, 3].map(() => {
        const b = ctx.createBiquadFilter();
        b.type = "highpass";
        b.Q.value = 0.707;
        return b;
      });
      this.eqLp = [1, 2, 3].map(() => {
        const b = ctx.createBiquadFilter();
        b.type = "lowpass";
        b.Q.value = 0.707;
        return b;
      });
      const anFreq = ctx.createAnalyser();
      anFreq.fftSize = Math.min(32768, this.P.fftN * 2);
      anFreq.smoothingTimeConstant = 0;
      this.anFreq = anFreq;
      pre.connect(this.eqHp[0]);
      this.eqHp[0].connect(this.eqHp[1]);
      this.eqHp[1].connect(this.eqHp[2]);
      this.eqHp[2].connect(this.eqLp[0]);
      this.eqLp[0].connect(this.eqLp[1]);
      this.eqLp[1].connect(this.eqLp[2]);
      this.eqLp[2].connect(anFreq);

      this.applyBandFilter();
      this.applyEQ();
      this.buildFFT();
      this.timeData = new Float32Array(anTime.fftSize);
      window.clearTimeout(pending);
      this.resize();
      this.listening = true;
      this.events.onListening(true);
      this.events.onStatus("Listening through the microphone…", false);
      this.update();
    } catch (err) {
      window.clearTimeout(pending);
      const name = err instanceof Error ? err.name : String(err);
      const message = err instanceof Error ? err.message : String(err);
      if (name === "NotAllowedError" || name === "SecurityError") {
        this.events.onStatus(
          "Microphone access was denied. Allow the microphone for this app and try again.",
          true,
        );
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        this.events.onStatus("No microphone was found on this device.", true);
      } else {
        this.events.onStatus(`Could not access the microphone: ${message}`, true);
      }
      this.closeAudio();
    }
  }

  stop() {
    this.listening = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.closeAudio();
    this.events.onListening(false);
    this.events.onStatus("The microphone is used only locally on this computer", false);
    this.els.noteEl.textContent = "–";
    this.els.noteEl.classList.remove("in-tune");
    this.els.centsEl.textContent = "Spectrum view: the dot above";
    this.els.freqEl.innerHTML = "&nbsp;";
    this.setNeedle(0);
    this.els.needle.classList.remove("tuned");
    this.centsHist = [];
    this.needleInit = false;
    this.smoothedCents = 0;
    this.events.onActiveString(-1);
    this.els.markerEl.style.opacity = "0";
  }

  dispose() {
    this.stop();
  }

  private closeAudio() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
  }

  private computeAxis() {
    if (!this.axisInitialised && this.strings.length) {
      const lo = Math.min(...this.strings);
      const hi = Math.max(...this.strings);
      this.midiCenter = Math.round((lo + hi) / 2);
      this.axisInitialised = true;
    }
    this.applyWindow();
  }

  private applyWindow() {
    this.midiLo = this.midiCenter - Math.floor(this.P.span / 2);
    this.midiHi = this.midiLo + this.P.span;
    const key = `${this.midiLo}:${this.midiHi}`;
    if (key !== this.lastAxisEmit) {
      this.lastAxisEmit = key;
      this.events.onAxis({ lo: this.midiLo, hi: this.midiHi });
    }
  }

  private yForMidi(m: number) {
    return (this.midiHi - m) / (this.midiHi - this.midiLo);
  }

  private midiForRow(r: number, rows: number) {
    return this.midiHi - (r / (rows - 1)) * (this.midiHi - this.midiLo);
  }

  private buildFFT() {
    this.fftN = this.P.fftN;
    this.fftRun = makeFFT(this.fftN);
    this.re1 = new Float32Array(this.fftN);
    this.im1 = new Float32Array(this.fftN);
    this.re2 = new Float32Array(this.fftN);
    this.im2 = new Float32Array(this.fftN);
    const nb = this.fftN >> 1;
    this.binPow = new Float32Array(nb);
    this.binFreq = new Float32Array(nb);
    this.binKeep = new Uint8Array(nb);
    this.noiseEst = new Float32Array(nb);
    this.noiseInit = false;
    this.winBuf = new Float32Array(this.fftN);
    this.winSum = 0;
    for (let n = 0; n < this.fftN; n++) {
      const t = n / (this.fftN - 1);
      let v: number;
      switch (this.P.win) {
        case 0:
          v = 1;
          break;
        case 2:
          v = 0.54 - 0.46 * Math.cos(2 * Math.PI * t);
          break;
        case 3:
          v = 0.42 - 0.5 * Math.cos(2 * Math.PI * t) + 0.08 * Math.cos(4 * Math.PI * t);
          break;
        default:
          v = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
      }
      this.winBuf[n] = v;
      this.winSum += v;
    }
    if (this.anFreq) {
      try {
        this.anFreq.fftSize = Math.min(32768, this.fftN * 2);
      } catch {
        /* keep the analyser's current size */
      }
      this.tap = new Float32Array(this.anFreq.fftSize);
    }
  }

  private rebuildSpectro() {
    this.COLS = this.P.cols;
    this.ROWS = this.P.rowsPerSemi * this.P.span;
    this.off.width = this.COLS;
    this.off.height = this.ROWS;
    this.colImg = this.offctx.createImageData(1, this.ROWS);
    this.colMag = new Float32Array(this.ROWS);
    this.colPrev = new Float32Array(this.ROWS);
    this.rowHits = new Float32Array(this.ROWS);
    this.offctx.fillStyle = "#080807";
    this.offctx.fillRect(0, 0, this.COLS, this.ROWS);
    this.buildRowColors();
  }

  private buildRowColors() {
    this.rowRGB = new Array(this.ROWS);
    for (let r = 0; r < this.ROWS; r++) {
      const pc = ((this.midiForRow(r, this.ROWS) % 12) + 12) % 12;
      this.rowRGB[r] = hslToRgb(pcHue(pc) / 360, 0.95, 0.5);
    }
  }

  private renderSpectro() {
    if (!this.off.width) return;
    this.sctx.drawImage(this.off, 0, 0, this.COLS, this.ROWS, 0, 0, this.els.canvas.width, this.els.canvas.height);
  }

  private harmonicSieve(sr: number) {
    const binHz = sr / this.fftN;
    const nb = this.fftN >> 1;
    const H = this.P.harmCount | 0;
    const search = Math.pow(2, 90 / 1200);
    let best = -1;
    let bestSal = 0;
    let bestF0 = 0;
    let second = 0;
    let total = 0;
    for (let k = 1; k < nb; k++) {
      if (this.binKeep[k]) {
        const f = this.binFreq[k];
        if (f > 35 && f < 5000) total += this.binPow[k];
      }
    }
    if (total <= 0) return null;
    for (let s = 0; s < this.strings.length; s++) {
      const fs = midiToFreq(this.strings[s], this.a4);
      let sal = 0;
      let fNum = 0;
      let fDen = 0;
      for (let h = 1; h <= H; h++) {
        const lo = (h * fs) / search;
        const hi = h * fs * search;
        const k0 = Math.max(1, Math.floor(lo / binHz) - 2);
        const k1 = Math.min(nb - 1, Math.ceil(hi / binHz) + 2);
        let hp = 0;
        let hf = 0;
        for (let k = k0; k <= k1; k++) {
          if (!this.binKeep[k]) continue;
          const f = this.binFreq[k];
          if (f < lo || f > hi) continue;
          const p = this.binPow[k];
          hp += p;
          hf += p * f;
        }
        if (hp <= 0) continue;
        sal += Math.sqrt(hp) / Math.sqrt(h);
        if (h <= 3) {
          const w = hp / (h * h);
          fNum += w * (hf / hp / h);
          fDen += w;
        }
      }
      if (sal > bestSal) {
        second = bestSal;
        bestSal = sal;
        best = s;
        bestF0 = fDen > 0 ? fNum / fDen : 0;
      } else if (sal > second) {
        second = sal;
      }
    }
    if (best < 0 || bestF0 <= 0) return null;
    let explained = 0;
    for (let k = 1; k < nb; k++) {
      if (!this.binKeep[k]) continue;
      const f = this.binFreq[k];
      if (f <= 35 || f >= 5000) continue;
      const n = Math.round(f / bestF0);
      if (n < 1 || n > H) continue;
      const c = Math.abs(1200 * Math.log2(f / (n * bestF0)));
      if (c <= this.P.harmTol * 2) explained += this.binPow[k];
    }
    return { string: best, f0: bestF0, conf: explained / total };
  }

  private pushColumn() {
    if (!this.anFreq || !this.fftRun || !this.colImg) return;
    if (this.tap.length !== this.anFreq.fftSize) this.tap = new Float32Array(this.anFreq.fftSize);
    this.anFreq.getFloatTimeDomainData(this.tap);
    const T = this.tap.length;
    const fftN = this.fftN;
    if (T < fftN + 1 || !this.audioCtx) return;
    const base = T - fftN - 1;
    for (let n = 0; n < fftN; n++) {
      const w = this.winBuf[n];
      this.re1[n] = this.tap[base + n] * w;
      this.im1[n] = 0;
      this.re2[n] = this.tap[base + n + 1] * w;
      this.im2[n] = 0;
    }
    this.fftRun(this.re1, this.im1);
    if (this.P.reassign) this.fftRun(this.re2, this.im2);

    const sr = this.audioCtx.sampleRate;
    const bins = fftN >> 1;
    const binHz = sr / fftN;
    const norm = 2 / this.winSum;
    const gain = Math.pow(10, this.P.gainDb / 20);
    const maxDev = this.P.reasMax;

    for (let k = 1; k < bins; k++) {
      const rr = this.re1[k];
      const ii = this.im1[k];
      const a = Math.sqrt(rr * rr + ii * ii) * norm * gain;
      this.binPow[k] = a * a;
      let f = k * binHz;
      let keep = 1;
      if (this.P.reassign && a > 1e-9) {
        const p1 = Math.atan2(ii, rr);
        const p2 = Math.atan2(this.im2[k], this.re2[k]);
        const expect = (2 * Math.PI * k) / fftN;
        let d = p2 - p1 - expect;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        f = ((expect + d) * sr) / (2 * Math.PI);
        if (Math.abs(f - k * binHz) / binHz > maxDev) keep = 0;
      }
      this.binFreq[k] = f;
      this.binKeep[k] = keep && f > 0 ? 1 : 0;
    }

    if (this.P.nsStrength > 0) {
      const rise = Math.pow(100, 1 / Math.max(1, this.P.nsTime * this.P.scroll));
      if (!this.noiseInit) {
        for (let k = 1; k < bins; k++) this.noiseEst[k] = this.binPow[k];
        this.noiseInit = true;
      }
      const alpha = this.P.nsStrength;
      const beta = this.P.nsFloor;
      for (let k = 1; k < bins; k++) {
        const p = this.binPow[k];
        let n = this.noiseEst[k] * rise;
        if (p < n) n = p;
        this.noiseEst[k] = n;
        const c = p - alpha * n;
        const fl = beta * p;
        this.binPow[k] = c > fl ? c : fl;
      }
    }

    const sv = this.harmonicSieve(sr);
    const now = performance.now();
    const confident = !!(sv && sv.conf >= this.P.confMin);
    if (sv && confident) {
      this.specPitch.f0 = sv.f0;
      this.specPitch.conf = sv.conf;
      this.specPitch.string = sv.string;
      this.specPitch.t = now;
      if (sv.string === this.followCand) this.followRun++;
      else {
        this.followCand = sv.string;
        this.followRun = 1;
      }
      if (this.P.follow && this.followRun >= this.P.followHold && now > this.followPauseUntil) {
        const target = this.strings[sv.string];
        if (Math.abs(target - this.midiCenter) >= 1) this.panTo(target);
      }
    } else {
      this.followRun = 0;
    }

    this.colMag.fill(0);
    const thick = this.P.thick | 0;
    const accumMax = this.P.accum === 0;
    const emph = confident ? this.P.harmEmph : 0;
    const f0 = confident && sv ? sv.f0 : 0;
    const tol = this.P.harmTol;
    const Hc = this.P.harmCount | 0;
    for (let k = 1; k < bins; k++) {
      if (!this.binKeep[k]) continue;
      let pw = this.binPow[k];
      if (pw <= 1e-14) continue;
      const f = this.binFreq[k];
      if (emph > 0) {
        const n = Math.round(f / f0);
        let onSeries = false;
        if (n >= 1 && n <= Hc) {
          const c = Math.abs(1200 * Math.log2(f / (n * f0)));
          onSeries = c <= tol;
        }
        if (!onSeries) pw *= (1 - emph) * (1 - emph);
      }
      const mag = Math.sqrt(pw);
      const midi = freqToMidiF(f, this.a4);
      const r0 = Math.round(((this.midiHi - midi) / (this.midiHi - this.midiLo)) * (this.ROWS - 1));
      if (r0 < -thick || r0 >= this.ROWS + thick) continue;
      for (let dr = -thick; dr <= thick; dr++) {
        const r = r0 + dr;
        if (r < 0 || r >= this.ROWS) continue;
        const v = mag * (thick === 0 ? 1 : 1 - Math.abs(dr) / (thick + 1));
        if (accumMax) {
          if (v > this.colMag[r]) this.colMag[r] = v;
        } else {
          this.colMag[r] += v;
        }
      }
    }

    const dec = this.P.decay;
    if (dec > 0) {
      for (let r = 0; r < this.ROWS; r++) {
        const prev = this.colPrev[r] * dec;
        if (prev > this.colMag[r]) this.colMag[r] = prev;
      }
    }
    this.colPrev.set(this.colMag);

    const { floorDb, rangeDb, gamma, bright } = this.P;
    const need = this.P.persist | 0;
    const litThr = Math.pow(10, (floorDb + rangeDb * 0.12) / 20);
    if (need > 0) {
      for (let r = 0; r < this.ROWS; r++) {
        const m = Math.max(this.colMag[r], r > 0 ? this.colMag[r - 1] : 0, r < this.ROWS - 1 ? this.colMag[r + 1] : 0);
        if (m > litThr) this.rowHits[r] = Math.min(need, this.rowHits[r] + 1);
        else this.rowHits[r] = Math.max(0, this.rowHits[r] - 2);
      }
    }

    const d = this.colImg.data;
    for (let r = 0; r < this.ROWS; r++) {
      const m = this.colMag[r];
      let v = 0;
      if (m > 0) {
        const db = 20 * Math.log10(m);
        v = (db - floorDb) / rangeDb;
        if (v < 0) v = 0;
        else if (v > 1) v = 1;
        if (v > 0) {
          v = Math.pow(v, gamma) * bright;
          if (need > 0) v *= this.rowHits[r] / need;
        }
      }
      const idx = r * 4;
      if (v <= 0.015) {
        d[idx] = 8;
        d[idx + 1] = 8;
        d[idx + 2] = 7;
        d[idx + 3] = 255;
        continue;
      }
      if (v > 1) v = 1;
      const bc = this.rowRGB[r];
      const br = 0.2 + v * 1.05;
      d[idx] = Math.min(255, bc[0] * br);
      d[idx + 1] = Math.min(255, bc[1] * br);
      d[idx + 2] = Math.min(255, bc[2] * br);
      d[idx + 3] = 255;
    }
    this.offctx.drawImage(this.off, 1, 0, this.COLS - 1, this.ROWS, 0, 0, this.COLS - 1, this.ROWS);
    this.offctx.putImageData(this.colImg, this.COLS - 1, 0);

    this.updateSpecReadout(confident && sv ? sv : null);
  }

  private updateSpecReadout(sv: { string: number; f0: number } | null) {
    const el = this.els.specReadoutEl;
    if (!sv) {
      el.classList.add("idle");
      return;
    }
    const target = midiToFreq(this.strings[sv.string], this.a4);
    const c = 1200 * Math.log2(sv.f0 / target);
    const name = midiName(this.strings[sv.string]);
    const ok = Math.abs(c) <= 4;
    el.classList.remove("idle");
    el.classList.toggle("ok", ok);
    el.innerHTML = `<b>${name}</b> ${ok ? "in tune" : (c > 0 ? "+" : "") + Math.round(c) + "c"}`;
  }

  private nearestStringIdx(f: number) {
    let best = -1;
    let bestDist = Infinity;
    this.strings.forEach((m, i) => {
      const dist = Math.abs(Math.log2(f / midiToFreq(m, this.a4)));
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  }

  private setNeedle(cents: number) {
    const ang = angleForCents(cents) + 90;
    this.els.needle.style.transform = `rotate(${ang}deg)`;
    this.els.needleShadow.style.transform = `rotate(${ang}deg) translate(2px,2px)`;
  }

  private applyEQ() {
    const ctx = this.audioCtx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const nyq = ctx.sampleRate / 2;
    if (this.humNodes.length) {
      const base = this.P.hum;
      this.humNodes.forEach((b, i) => {
        if (base > 0) {
          b.frequency.setTargetAtTime(base * (i + 1), t, 0.01);
          b.gain.setTargetAtTime(-30, t, 0.01);
        } else {
          b.gain.setTargetAtTime(0, t, 0.01);
        }
      });
    }
    if (!this.eqHp.length || !this.eqLp.length) return;
    let hpF = 10;
    let lpF = Math.min(20000, nyq * 0.9);
    if (this.P.eqOn && this.strings.length) {
      const fr = this.strings.map((m) => midiToFreq(m, this.a4));
      hpF = Math.max(20, Math.min(...fr) * Math.pow(2, -this.P.eqLowMargin / 12));
      lpF = Math.min(nyq * 0.9, Math.max(...fr) * this.P.eqHarm);
    }
    const stages = this.P.eqOn ? this.P.eqSlope | 0 : 0;
    this.eqHp.forEach((b, i) => b.frequency.setTargetAtTime(i < stages ? hpF : 10, t, 0.01));
    this.eqLp.forEach((b, i) =>
      b.frequency.setTargetAtTime(i < stages ? lpF : Math.min(20000, nyq * 0.9), t, 0.01),
    );
  }

  private computeBand() {
    if (!this.strings.length) return { lo: 60, hi: 1200 };
    const freqs = this.strings.map((m) => midiToFreq(m, this.a4));
    const lowest = Math.min(...freqs);
    const highest = Math.max(...freqs);
    return {
      lo: Math.max(26, lowest * 0.72),
      hi: Math.min(3000, Math.max(900, highest * 3.2)),
    };
  }

  private applyBandFilter() {
    const b = this.computeBand();
    this.bandLo = b.lo;
    this.bandHi = b.hi;
    if (this.hp1 && this.hp2 && this.lp1 && this.lp2 && this.audioCtx) {
      const t = this.audioCtx.currentTime;
      this.hp1.frequency.setTargetAtTime(this.bandLo, t, 0.01);
      this.hp2.frequency.setTargetAtTime(this.bandLo, t, 0.01);
      this.lp1.frequency.setTargetAtTime(this.bandHi, t, 0.01);
      this.lp2.frequency.setTargetAtTime(this.bandHi, t, 0.01);
    }
  }

  private update = (ts?: number) => {
    if (!this.listening) return;
    const now = ts ?? performance.now();
    if (now - this.lastPush >= 1000 / this.P.scroll) {
      this.pushColumn();
      this.lastPush = now;
    }
    this.renderSpectro();

    let freq: number;
    const fresh = this.specPitch.t && performance.now() - this.specPitch.t < 350;
    if (this.P.pitchSrc === 1 && fresh) {
      freq = this.specPitch.f0;
    } else if (this.anTime && this.audioCtx) {
      this.anTime.getFloatTimeDomainData(this.timeData);
      freq = autoCorrelate(this.timeData, this.audioCtx.sampleRate);
    } else {
      freq = -1;
    }

    const marker = this.els.markerEl;
    if (freq === -1 || freq < this.bandLo * 0.9 || freq > this.bandHi) {
      this.els.centsEl.textContent = "Listening…";
      this.els.freqEl.innerHTML = "&nbsp;";
      this.els.noteEl.classList.remove("in-tune");
      this.centsHist.length = 0;
      marker.style.opacity = "0";
    } else {
      const noteNum = Math.round(freqToMidiF(freq, this.a4));
      const targetFreq = midiToFreq(noteNum, this.a4);
      const rawCents = 1200 * Math.log2(freq / targetFreq);

      this.centsHist.push(rawCents);
      if (this.centsHist.length > 5) this.centsHist.shift();
      const sorted = this.centsHist.slice().sort((a, b) => a - b);
      const medCents = sorted[Math.floor(sorted.length / 2)];

      if (!this.needleInit) {
        this.smoothedCents = medCents;
        this.needleInit = true;
      } else {
        this.smoothedCents = this.smoothedCents * 0.86 + medCents * 0.14;
      }

      const name = NOTE_NAMES[((noteNum % 12) + 12) % 12];
      const octave = Math.floor(noteNum / 12) - 1;
      const isSharp = name.includes("#");
      this.els.noteEl.innerHTML = isSharp ? `${name.replace("#", "")}<span class="kt-sharp">♯</span>${octave}` : `${name}${octave}`;
      const inTune = Math.abs(this.smoothedCents) <= 4;
      this.els.noteEl.classList.toggle("in-tune", inTune);
      this.els.needle.classList.toggle("tuned", inTune);
      this.els.centsEl.innerHTML = inTune
        ? "<b>In tune</b>"
        : this.smoothedCents > 0
          ? `<b>+${Math.round(this.smoothedCents)}</b> cents · too high`
          : `<b>${Math.round(this.smoothedCents)}</b> cents · too low`;
      this.els.freqEl.textContent = `${freq.toFixed(2)} Hz`;
      this.setNeedle(this.smoothedCents);
      if (this.canTrack) this.events.onActiveString(this.nearestStringIdx(freq));

      const m = freqToMidiF(freq, this.a4);
      const yf = this.yForMidi(m);
      if (yf < 0 || yf > 1) {
        marker.style.opacity = "0";
      } else {
        marker.style.top = `${(yf * 100).toFixed(3)}%`;
        marker.style.opacity = "0.9";
      }
    }
    this.rafId = requestAnimationFrame(this.update);
  };
}

function angleForCents(c: number) {
  const startAngle = -160;
  const endAngle = -20;
  const cl = Math.max(-50, Math.min(50, c));
  return startAngle + ((cl + 50) / 100) * (endAngle - startAngle);
}

function insecureReason(): string | null {
  const p = window.location.protocol;
  const host = window.location.hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "tauri.localhost";
  if (p !== "https:" && !local && p !== "tauri:") {
    return `This page runs over ${p.replace(":", "")}, not https. The microphone is blocked on insecure pages.`;
  }
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return "The microphone is not available in this webview.";
  }
  return null;
}
