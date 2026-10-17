import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PanelBodyProps } from "../../core/types";
import {
  DEFAULT_LAB,
  TunerEngine,
  type AxisWindow,
  type LabParams,
  type LabRebuild,
} from "./engine";
import {
  INSTRUMENTS,
  NOTE_NAMES,
  midiName,
  midiToFreq,
  pcHue,
  tuningToMidi,
} from "./tunings";
import "./kennystuner.css";

export type KennystunerState = {
  instrIdx: number;
  tuningIdx: number;
  customStrings: number[] | null;
  a4: 432 | 440;
  lab: LabParams;
};

const PICKER_LO = 28;
const PICKER_HI = 88;

export function normalizeKennystunerState(input: unknown): KennystunerState {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const instrIdx =
    typeof src.instrIdx === "number" && src.instrIdx >= 0 && src.instrIdx < INSTRUMENTS.length
      ? Math.floor(src.instrIdx)
      : 0;
  const tunings = INSTRUMENTS[instrIdx].tunings;
  const tuningIdx =
    typeof src.tuningIdx === "number" && src.tuningIdx >= 0 && src.tuningIdx < tunings.length
      ? Math.floor(src.tuningIdx)
      : 0;
  const customStrings =
    Array.isArray(src.customStrings) &&
    src.customStrings.length > 0 &&
    src.customStrings.length <= 12 &&
    src.customStrings.every((v) => typeof v === "number" && Number.isInteger(v) && v >= PICKER_LO && v <= PICKER_HI)
      ? (src.customStrings as number[]).slice()
      : null;
  const a4: 432 | 440 = src.a4 === 432 ? 432 : 440;
  const labSrc = (src.lab && typeof src.lab === "object" ? src.lab : {}) as Record<string, unknown>;
  const lab = { ...DEFAULT_LAB };
  for (const key of Object.keys(DEFAULT_LAB) as Array<keyof LabParams>) {
    const v = labSrc[key];
    if (typeof v === "number" && Number.isFinite(v)) lab[key] = v;
  }
  return { instrIdx, tuningIdx, customStrings, a4, lab };
}

type LabDef =
  | { sep: string }
  | {
      k: keyof LabParams;
      l: string;
      min?: number;
      max?: number;
      step?: number;
      opts?: number[];
      names?: string[];
      hint?: string;
      rebuild?: LabRebuild;
    };

const LAB: LabDef[] = [
  { sep: "Noise & background" },
  { k: "nsStrength", l: "Noise reduction", min: 0, max: 4, step: 0.05, hint: "how much of the learned background is subtracted (0 = off)" },
  { k: "nsTime", l: "Noise learn time (s)", min: 0.5, max: 10, step: 0.25, hint: "how slowly the background estimate may rise — longer protects held notes" },
  { k: "nsFloor", l: "Noise residual", min: 0, max: 0.5, step: 0.01, hint: 'how much of each bin is always kept, to avoid "musical noise"' },
  { k: "hum", l: "Mains hum notch", opts: [0, 50, 60], names: ["Off", "50 Hz", "60 Hz"], rebuild: "eq" },
  { sep: "Tuning EQ" },
  { k: "eqOn", l: "EQ", opts: [0, 1], names: ["Off", "On"], rebuild: "eq" },
  { k: "eqLowMargin", l: "Low cut (semitones under lowest string)", min: 1, max: 18, step: 1, rebuild: "eq" },
  { k: "eqHarm", l: "High cut (× highest string)", min: 2, max: 12, step: 0.5, rebuild: "eq" },
  { k: "eqSlope", l: "Slope", opts: [1, 2, 3], names: ["12 dB/oct", "24 dB/oct", "36 dB/oct"], rebuild: "eq" },
  { sep: "Focus on your string" },
  { k: "harmEmph", l: "Harmonic emphasis", min: 0, max: 0.95, step: 0.05, hint: "dims everything that is not part of the detected string's harmonic series" },
  { k: "harmCount", l: "Harmonics used", min: 2, max: 12, step: 1 },
  { k: "harmTol", l: "Harmonic tolerance (cents)", min: 5, max: 80, step: 1 },
  { k: "confMin", l: "Confidence needed", min: 0.05, max: 0.9, step: 0.01, hint: "share of energy the string must explain before it counts" },
  { k: "persist", l: "Persistence (frames)", min: 0, max: 16, step: 1, hint: "a line must hold this long before it is drawn at full strength" },
  { k: "pitchSrc", l: "Needle pitch source", opts: [0, 1], names: ["Autocorr", "Spectrum"] },
  { k: "follow", l: "Follow string", opts: [0, 1], names: ["Off", "On"] },
  { k: "followHold", l: "Follow hold (columns)", min: 1, max: 40, step: 1, hint: "same string must win this many columns in a row before the view moves" },
  { sep: "Analysis" },
  { k: "fftN", l: "FFT size", opts: [2048, 4096, 8192, 16384], rebuild: "fft" },
  { k: "win", l: "Window", opts: [0, 1, 2, 3], names: ["Rect", "Hann", "Hamming", "Blackman"], rebuild: "fft" },
  { k: "reassign", l: "Reassignment", opts: [0, 1], names: ["Off", "On"] },
  { k: "reasMax", l: "Reassign reject", min: 0.2, max: 3, step: 0.05, hint: "bins a partial may move before it is treated as noise" },
  { sep: "Display" },
  { k: "span", l: "Span (semitones)", min: 5, max: 36, step: 1, rebuild: "buf" },
  { k: "rowsPerSemi", l: "Rows/semitone", min: 8, max: 80, step: 2, rebuild: "buf" },
  { k: "cols", l: "History columns", min: 150, max: 900, step: 10, rebuild: "buf" },
  { k: "scroll", l: "Scroll (col/s)", min: 8, max: 60, step: 1 },
  { k: "floorDb", l: "Floor (dB)", min: -130, max: -30, step: 1 },
  { k: "rangeDb", l: "Range (dB)", min: 4, max: 70, step: 1 },
  { k: "gainDb", l: "Gain (dB)", min: -20, max: 60, step: 1 },
  { k: "gamma", l: "Gamma", min: 0.3, max: 3.5, step: 0.05 },
  { k: "bright", l: "Brightness", min: 0.3, max: 2.5, step: 0.05 },
  { k: "thick", l: "Line thickness", min: 0, max: 6, step: 1 },
  { k: "decay", l: "Trail decay", min: 0, max: 0.98, step: 0.02 },
  { k: "accum", l: "Accumulate", opts: [0, 1], names: ["Max", "Sum"] },
];

const GAUGE = { cx: 170, cy: 168, rOuter: 128, rInner: 112, rLabel: 100 };

function gaugeAngle(cents: number) {
  const cl = Math.max(-50, Math.min(50, cents));
  return -160 + ((cl + 50) / 100) * 140;
}

function polar(r: number, angle: number): [number, number] {
  const rad = (angle * Math.PI) / 180;
  return [GAUGE.cx + r * Math.cos(rad), GAUGE.cy + r * Math.sin(rad)];
}

const TICKS = [-50, -25, 0, 25, 50].map((c) => {
  const a = gaugeAngle(c);
  const [x1, y1] = polar(GAUGE.rOuter, a);
  const [x2, y2] = polar(GAUGE.rInner, a);
  const [lx, ly] = polar(GAUGE.rLabel, a);
  return { c, x1, y1, x2, y2, lx, ly: ly + 3 };
});

const MINOR_TICKS = [-50, -40, -30, -20, -10, 10, 20, 30, 40, 50].map((c) => {
  const a = gaugeAngle(c);
  const [x1, y1] = polar(GAUGE.rOuter, a);
  const [x2, y2] = polar(GAUGE.rOuter - 8, a);
  return { c, x1, y1, x2, y2 };
});

const README = [
  { h: "Tuner", p: "Tap Start tuner, allow the microphone, and play a note. The needle shows if you are sharp or flat; the big letter is the detected note and turns green when you are in tune. The input is filtered to your instrument's frequency range, so wind, rumble and hiss are largely ignored." },
  { h: "Instrument & tuning", p: "Pick your instrument from the tabs, then choose a tuning from the dropdown. Choose Custom… to set each string yourself — the strings blink until you have picked a note for every one." },
  { h: "Reference pitch", p: "The 440hz / 432hz toggle sets the reference. Everything retunes to the chosen reference." },
  { h: "Spectrum", p: "A spectrogram of everything the microphone hears, scrolling in real time. It shows about one octave at a time and follows the string you are tuning. Drag the spectrum up or down to look at another range — it resumes following after a few seconds." },
  { h: "Tune through noise", p: "The app learns the steady background — fans, hum, traffic — and subtracts it, then looks for the harmonic series of one of your strings. The readout in the corner of Spectrum shows which string you are on and how many cents you are off." },
  { h: "Spectrum lab", p: "Every parameter of the spectrum engine is exposed under the Spectrum view. Adjust until it looks right, then use Copy settings." },
];

export function KennystunerPanel({ panel, updatePanelState }: PanelBodyProps) {
  const initial = useMemo(() => normalizeKennystunerState(panel.panelState), [panel.panelState]);

  const [instrIdx, setInstrIdx] = useState(initial.instrIdx);
  const [tuningIdx, setTuningIdx] = useState(initial.tuningIdx);
  const [a4, setA4] = useState<432 | 440>(initial.a4);
  const [lab, setLab] = useState<LabParams>(initial.lab);
  const [applied, setApplied] = useState<number[]>(() =>
    initial.customStrings ?? tuningToMidi(INSTRUMENTS[initial.instrIdx].tunings[initial.tuningIdx]),
  );
  const [draft, setDraft] = useState<(number | null)[] | null>(initial.customStrings ? initial.customStrings.slice() : null);

  const [view, setView] = useState<0 | 1>(0);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("The microphone is used only locally on this computer");
  const [statusErr, setStatusErr] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [axis, setAxis] = useState<AxisWindow>({ lo: 46, hi: 59 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [readmeOpen, setReadmeOpen] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const needleRef = useRef<SVGGElement>(null);
  const needleShadowRef = useRef<SVGGElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const centsRef = useRef<HTMLDivElement>(null);
  const freqRef = useRef<HTMLDivElement>(null);
  const specReadoutRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const pickerListRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<TunerEngine | null>(null);
  const resetAxisRef = useRef(false);
  const dragRef = useRef<{ startY: number; startCenter: number; moved: boolean } | null>(null);

  const customMode = draft !== null;
  const draftComplete = draft !== null && draft.every((v) => v !== null);
  const trackPegs = !(customMode && !draftComplete);
  const pegStrings: (number | null)[] = customMode ? (draft as (number | null)[]) : applied;
  const preset = INSTRUMENTS[instrIdx].tunings;
  const tuningLabel = customMode ? "Custom" : preset[tuningIdx].name;
  const hlSet = useMemo(() => new Set(applied), [applied]);

  const persistKey = JSON.stringify({
    instrIdx,
    tuningIdx,
    customStrings: draftComplete ? draft : null,
    a4,
    lab,
  });
  const persistedOnce = useRef(false);
  useEffect(() => {
    if (!persistedOnce.current) {
      persistedOnce.current = true;
      return;
    }
    const state: KennystunerState = {
      instrIdx,
      tuningIdx,
      customStrings: draftComplete ? (draft as number[]) : null,
      a4,
      lab,
    };
    updatePanelState(state);
  }, [persistKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const needle = needleRef.current;
    const needleShadow = needleShadowRef.current;
    const noteEl = noteRef.current;
    const centsEl = centsRef.current;
    const freqEl = freqRef.current;
    const specReadoutEl = specReadoutRef.current;
    const markerEl = markerRef.current;
    if (!canvas || !needle || !needleShadow || !noteEl || !centsEl || !freqEl || !specReadoutEl || !markerEl) return;
    const engine = new TunerEngine(
      { canvas, needle, needleShadow, noteEl, centsEl, freqEl, specReadoutEl, markerEl },
      {
        onStatus: (text, isError) => {
          setStatus(text);
          setStatusErr(isError);
        },
        onListening: setListening,
        onActiveString: setActiveIdx,
        onAxis: setAxis,
      },
      lab,
      a4,
    );
    engineRef.current = engine;
    noteEl.textContent = "–";
    centsEl.textContent = "Spectrum view: the dot above";
    const observer = new ResizeObserver(() => engine.resize());
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      engine.dispose();
      engineRef.current = null;
    };
    // created once per mount; later changes are pushed by the effects below
  }, []);

  useEffect(() => {
    engineRef.current?.setA4(a4);
  }, [a4]);

  useEffect(() => {
    const resetAxis = resetAxisRef.current;
    resetAxisRef.current = false;
    engineRef.current?.setStrings(applied, { canTrack: trackPegs, resetAxis });
  }, [applied, trackPegs]);

  useLayoutEffect(() => {
    if (pickerSlot === null) return;
    const list = pickerListRef.current;
    if (!list) return;
    const current = draft?.[pickerSlot] ?? null;
    const focus = current ?? (tuningToMidi(preset[0])[pickerSlot] ?? 45);
    const el = list.querySelector<HTMLElement>(`[data-midi="${focus}"]`);
    if (el) list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2;
  }, [pickerSlot]);

  function chooseInstrument(i: number) {
    resetAxisRef.current = true;
    setInstrIdx(i);
    setTuningIdx(0);
    setDraft(null);
    setApplied(tuningToMidi(INSTRUMENTS[i].tunings[0]));
    setActiveIdx(-1);
  }

  function chooseTuning(i: number) {
    setTuningIdx(i);
    setDraft(null);
    setApplied(tuningToMidi(preset[i]));
    setMenuOpen(false);
  }

  function startCustom() {
    const len = applied.length || tuningToMidi(preset[0]).length;
    setDraft(new Array<number | null>(len).fill(null));
    setMenuOpen(false);
  }

  function chooseCustomNote(slot: number, midi: number) {
    if (!draft) return;
    const next = draft.slice();
    next[slot] = midi;
    setDraft(next);
    if (next.every((v) => v !== null)) setApplied(next as number[]);
  }

  function pegClick(i: number) {
    if (customMode) setPickerSlot(i);
    else setActiveIdx(i);
  }

  function setLabValue(def: Extract<LabDef, { k: keyof LabParams }>, value: number) {
    setLab((prev) => ({ ...prev, [def.k]: value }));
    engineRef.current?.setParam(def.k, value, def.rebuild);
  }

  function toggleListening() {
    const engine = engineRef.current;
    if (!engine) return;
    if (listening) engine.stop();
    else void engine.start();
  }

  function resetLab() {
    setLab({ ...DEFAULT_LAB });
    engineRef.current?.resetParams({ ...DEFAULT_LAB });
  }

  async function copySettings() {
    const text = JSON.stringify(lab);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* the clipboard may be blocked in the webview; nothing else to do */
    }
  }

  function onFramePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const engine = engineRef.current;
    if (!engine) return;
    dragRef.current = { startY: e.clientY, startCenter: engine.getCenter(), moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onFramePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const engine = engineRef.current;
    if (!drag || !engine) return;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dy) > 4) drag.moved = true;
    const pxPerSemi = e.currentTarget.getBoundingClientRect().height / lab.span;
    const target = drag.startCenter - Math.round(dy / pxPerSemi);
    if (target !== engine.getCenter()) engine.panTo(target);
  }

  function onFramePointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) engineRef.current?.pauseFollow(6000);
  }

  const axisRows: number[] = [];
  for (let m = axis.lo; m <= axis.hi; m++) axisRows.push(m);
  const span = axis.hi - axis.lo || 1;

  return (
    <div className="kt">
      <header className="kt-top">
        <button className="kt-readme" onClick={() => setReadmeOpen(true)} aria-label="Readme">
          Readme
        </button>
        <div className="kt-head">
          <div className="kt-eyebrow">Kenny´s Workshop</div>
          <h2>{view === 0 ? "Tuner" : "Spectrum"}</h2>
          <div className="kt-dots">
            <button className={`kt-dot${view === 0 ? " on" : ""}`} onClick={() => setView(0)} aria-label="Tuner" />
            <button className={`kt-dot${view === 1 ? " on" : ""}`} onClick={() => setView(1)} aria-label="Spectrum" />
          </div>
        </div>
        <div className="kt-hz">
          <button className={a4 === 440 ? "on" : ""} onClick={() => setA4(440)}>440hz</button>
          <button className={a4 === 432 ? "on" : ""} onClick={() => setA4(432)}>432hz</button>
        </div>
      </header>

      <section className={`kt-view${view === 0 ? "" : " kt-hidden"}`}>
        <div className="kt-gauge">
          <svg viewBox="0 0 340 190" aria-hidden="true">
            {TICKS.map((t) => (
              <g key={t.c}>
                <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className={t.c === 0 ? "kt-tick zero" : "kt-tick"} />
                <text x={t.lx} y={t.ly} textAnchor="middle" className="kt-tick-label">
                  {t.c === 0 ? "0" : t.c > 0 ? `+${t.c}` : t.c}
                </text>
              </g>
            ))}
            {MINOR_TICKS.map((t) => (
              <line key={t.c} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className="kt-tick minor" />
            ))}
            <g ref={needleShadowRef} className="kt-needle-shadow">
              <line x1="170" y1="168" x2="170" y2="40" stroke="#000" strokeWidth="3" strokeLinecap="round" />
            </g>
            <g ref={needleRef} className="kt-needle">
              <line x1="170" y1="168" x2="170" y2="34" strokeLinecap="round" />
            </g>
            <circle className="kt-pivot-ring" cx="170" cy="168" r="12" />
            <circle className="kt-pivot" cx="170" cy="168" r="7" />
          </svg>
        </div>

        <div className="kt-readout">
          <div ref={noteRef} className="kt-note" />
          <div ref={centsRef} className="kt-cents" />
          <div ref={freqRef} className="kt-freq">&nbsp;</div>
        </div>

        <div className="kt-instr-tabs">
          {INSTRUMENTS.map((ins, i) => (
            <button
              key={ins.name}
              className={`kt-instr-tab${i === instrIdx ? " active" : ""}`}
              onClick={() => chooseInstrument(i)}
            >
              {ins.name}
            </button>
          ))}
        </div>

        <div className="kt-tuning-row">
          <span className="kt-lbl">Tuning</span>
          <div className="kt-menu-anchor">
            <button className="kt-tuning-btn" onClick={() => setMenuOpen((o) => !o)}>
              <span>{tuningLabel}</span>
              <span className="kt-chev">▾</span>
            </button>
            {menuOpen && (
              <>
                <div className="kt-menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="kt-menu">
                  {preset.map((t, i) => (
                    <div
                      key={t.name}
                      className={`kt-menu-opt${!customMode && i === tuningIdx ? " sel" : ""}`}
                      onClick={() => chooseTuning(i)}
                    >
                      <span>{t.name}</span>
                      <small>{tuningToMidi(t).map((m) => midiName(m)).join(" ")}</small>
                    </div>
                  ))}
                  <div className={`kt-menu-opt custom${customMode ? " sel" : ""}`} onClick={startCustom}>
                    <span>Custom…</span>
                    <small>set your own</small>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="kt-strings" style={{ gridTemplateColumns: `repeat(${pegStrings.length}, 1fr)` }}>
          {pegStrings.map((m, i) => {
            const empty = customMode && m === null;
            const cls = `kt-peg${empty ? " empty" : ""}${!empty && i === activeIdx ? " active" : ""}`;
            return (
              <div key={i} className={cls} onClick={() => pegClick(i)}>
                {empty || m === null ? (
                  <>
                    <div className="kt-peg-n">?</div>
                    <div className="kt-peg-f">tap</div>
                  </>
                ) : (
                  <>
                    <div className="kt-peg-n">{midiName(m)}</div>
                    <div className="kt-peg-f">{midiToFreq(m, a4).toFixed(1)} Hz</div>
                  </>
                )}
              </div>
            );
          })}
        </div>
        {customMode && <div className="kt-hint">Tap each string and choose its note</div>}

        <div className="kt-control">
          <button className={`kt-toggle${listening ? " listening" : ""}`} onClick={toggleListening}>
            {listening ? "Stop tuner" : "Start tuner"}
          </button>
          <div className={`kt-status${statusErr ? " err" : ""}`}>{status}</div>
          <a className="kt-coffee" href="https://www.paypal.com/ncp/payment/5PU52AGKWEQVA" target="_blank" rel="noopener noreferrer">
            Buy me a coffee
          </a>
        </div>
      </section>

      <section className={`kt-view kt-spectrum${view === 1 ? "" : " kt-hidden"}`}>
        <div
          className="kt-frame"
          onPointerDown={onFramePointerDown}
          onPointerMove={onFramePointerMove}
          onPointerUp={onFramePointerUp}
          onPointerCancel={onFramePointerUp}
        >
          <canvas ref={canvasRef} className="kt-canvas" />
          <div className="kt-grid" aria-hidden="true">
            {axisRows.map((m) => {
              const y = ((axis.hi - m) / span) * 100;
              const pc = ((m % 12) + 12) % 12;
              const natural = !NOTE_NAMES[pc].includes("#");
              const hl = hlSet.has(m);
              return (
                <Fragment key={m}>
                  <div className={`kt-gridline${natural ? "" : " faint"}`} style={{ top: `${y}%` }} />
                  <div
                    className={`kt-gridlabel${hl ? " hl" : natural ? "" : " dim"}`}
                    style={{ top: `${y}%`, color: hl ? "#ffe9b0" : `hsl(${pcHue(pc)}, 55%, 58%)` }}
                  >
                    {NOTE_NAMES[pc]}
                    {Math.floor(m / 12) - 1}
                  </div>
                </Fragment>
              );
            })}
          </div>
          <div ref={markerRef} className="kt-marker" style={{ opacity: 0 }} />
          <div ref={specReadoutRef} className="kt-spec-readout idle" />
        </div>

        <div className="kt-lab">
          <div className="kt-lab-head">
            <span>Spectrum lab</span>
            <div className="kt-lab-btns">
              <button onClick={copySettings}>Copy settings</button>
              <button onClick={resetLab}>Reset</button>
            </div>
          </div>
          {LAB.map((def, idx) => {
            if ("sep" in def) return <div key={`sep-${idx}`} className="kt-lab-sep">{def.sep}</div>;
            const value = lab[def.k];
            const shown = def.opts
              ? def.names
                ? def.names[def.opts.indexOf(value)]
                : String(value)
              : def.step !== undefined && def.step < 1
                ? value.toFixed(2)
                : String(value);
            return (
              <div key={def.k} className="kt-lab-cell">
                <div className="kt-lab-row">
                  <div className="kt-lab-lbl">{def.l}</div>
                  <div className="kt-lab-val">{shown}</div>
                </div>
                {def.opts ? (
                  <div className="kt-lab-opts">
                    {def.opts.map((o, i) => (
                      <button
                        key={o}
                        className={value === o ? "on" : ""}
                        onClick={() => setLabValue(def, o)}
                      >
                        {def.names ? def.names[i] : String(o)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    type="range"
                    min={def.min}
                    max={def.max}
                    step={def.step}
                    value={value}
                    onChange={(e) => setLabValue(def, parseFloat(e.target.value))}
                  />
                )}
                {def.hint && <div className="kt-lab-hint">{def.hint}</div>}
              </div>
            );
          })}
        </div>
      </section>

      {pickerSlot !== null && (
        <div className="kt-sheet-backdrop" onClick={(e) => e.target === e.currentTarget && setPickerSlot(null)}>
          <div className="kt-sheet">
            <div className="kt-sheet-head">
              String {pickerSlot + 1}
              <span className="kt-sheet-close" onClick={() => setPickerSlot(null)}>✕</span>
            </div>
            <div className="kt-sheet-list" ref={pickerListRef}>
              {Array.from({ length: PICKER_HI - PICKER_LO + 1 }, (_, i) => PICKER_HI - i).map((m) => {
                const current = draft?.[pickerSlot] === m;
                return (
                  <div
                    key={m}
                    data-midi={m}
                    className={`kt-picker-item${current ? " cur" : ""}`}
                    onClick={() => {
                      chooseCustomNote(pickerSlot, m);
                      setPickerSlot(null);
                    }}
                  >
                    <span>{midiName(m)}</span>
                    <small>{midiToFreq(m, a4).toFixed(1)} Hz</small>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {readmeOpen && (
        <div className="kt-sheet-backdrop kt-readme-backdrop" onClick={(e) => e.target === e.currentTarget && setReadmeOpen(false)}>
          <div className="kt-readme-card">
            <h3>Kenny´s Tuner</h3>
            <div className="kt-readme-sub">A quick guide to everything it does.</div>
            {README.map((s) => (
              <div key={s.h} className="kt-readme-sec">
                <div className="kt-readme-h">{s.h}</div>
                <p>{s.p}</p>
              </div>
            ))}
            <button className="kt-readme-close" onClick={() => setReadmeOpen(false)}>
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
