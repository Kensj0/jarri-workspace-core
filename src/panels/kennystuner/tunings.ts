export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export type NoteSpec = { label: string; oct: number };
export type Tuning = { name: string; notes: NoteSpec[] };
export type Instrument = { name: string; tunings: Tuning[] };

const N = (label: string, oct: number): NoteSpec => ({ label, oct });

export const INSTRUMENTS: Instrument[] = [
  {
    name: "Guitar",
    tunings: [
      { name: "Standard", notes: [N("E", 2), N("A", 2), N("D", 3), N("G", 3), N("B", 3), N("E", 4)] },
      { name: "Drop D", notes: [N("D", 2), N("A", 2), N("D", 3), N("G", 3), N("B", 3), N("E", 4)] },
      { name: "DADGAD", notes: [N("D", 2), N("A", 2), N("D", 3), N("G", 3), N("A", 3), N("D", 4)] },
      { name: "Open G", notes: [N("D", 2), N("G", 2), N("D", 3), N("G", 3), N("B", 3), N("D", 4)] },
      { name: "Open D", notes: [N("D", 2), N("A", 2), N("D", 3), N("F#", 3), N("A", 3), N("D", 4)] },
      { name: "Half Step Down", notes: [N("D#", 2), N("G#", 2), N("C#", 3), N("F#", 3), N("A#", 3), N("D#", 4)] },
      { name: "Drop C", notes: [N("C", 2), N("G", 2), N("C", 3), N("F", 3), N("A", 3), N("D", 4)] },
    ],
  },
  {
    name: "Bass",
    tunings: [
      { name: "Standard", notes: [N("E", 1), N("A", 1), N("D", 2), N("G", 2)] },
      { name: "Drop D", notes: [N("D", 1), N("A", 1), N("D", 2), N("G", 2)] },
      { name: "Half Step Down", notes: [N("D#", 1), N("G#", 1), N("C#", 2), N("F#", 2)] },
    ],
  },
  {
    name: "Violin",
    tunings: [{ name: "Standard", notes: [N("G", 3), N("D", 4), N("A", 4), N("E", 5)] }],
  },
  {
    name: "Ukulele",
    tunings: [
      { name: "Standard (High G)", notes: [N("G", 4), N("C", 4), N("E", 4), N("A", 4)] },
      { name: "Low G", notes: [N("G", 3), N("C", 4), N("E", 4), N("A", 4)] },
      { name: "Baritone", notes: [N("D", 3), N("G", 3), N("B", 3), N("E", 4)] },
      { name: "D Tuning", notes: [N("A", 4), N("D", 4), N("F#", 4), N("B", 4)] },
    ],
  },
  {
    name: "Banjo",
    tunings: [
      { name: "Open G (Standard)", notes: [N("G", 4), N("D", 3), N("G", 3), N("B", 3), N("D", 4)] },
      { name: "Double C", notes: [N("G", 4), N("C", 3), N("G", 3), N("C", 4), N("D", 4)] },
      { name: "Sawmill", notes: [N("G", 4), N("D", 3), N("G", 3), N("C", 4), N("D", 4)] },
      { name: "Drop C", notes: [N("G", 4), N("C", 3), N("G", 3), N("B", 3), N("D", 4)] },
    ],
  },
  {
    name: "Mandolin",
    tunings: [{ name: "Standard", notes: [N("G", 3), N("D", 4), N("A", 4), N("E", 5)] }],
  },
  {
    name: "Cello",
    tunings: [{ name: "Standard", notes: [N("C", 2), N("G", 2), N("D", 3), N("A", 3)] }],
  },
];

export function noteToMidi(label: string, oct: number) {
  return (oct + 1) * 12 + NOTE_NAMES.indexOf(label);
}

export function tuningToMidi(tuning: Tuning): number[] {
  return tuning.notes.map((n) => noteToMidi(n.label, n.oct));
}

export function midiToFreq(midi: number, a4: number) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidiF(freq: number, a4: number) {
  return 12 * Math.log2(freq / a4) + 69;
}

export function midiName(midi: number) {
  const pc = ((midi % 12) + 12) % 12;
  return NOTE_NAMES[pc] + (Math.floor(midi / 12) - 1);
}

export function pcHue(pcCont: number) {
  return (60 + (pcCont / 12) * 300) % 360;
}
