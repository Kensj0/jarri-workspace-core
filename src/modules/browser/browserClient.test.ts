import { currentIntent, recentEvents, type BrowserEvent } from "./browserClient";

function assertEqual<T>(actual: T, expected: T, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${message}: expected ${e}, got ${a}`);
  }
}

const at = (type: string, text: string): BrowserEvent => ({ t: 0, type, text });

assertEqual(currentIntent([]), undefined, "no events, no intent");
assertEqual(
  currentIntent([at("intent", "Nästa: click button \"Spara\"")]),
  "Nästa: click button \"Spara\"",
  "newest intent is shown",
);
assertEqual(
  currentIntent([at("intent", "Nästa: click button \"Spara\""), at("pause", "Pausad")]),
  undefined,
  "a pause after the last intent hides it",
);
assertEqual(
  recentEvents([at("open", "a"), at("open", "b"), at("open", "c")], 2).map((e) => e.text),
  ["c", "b"],
  "newest first, limited",
);
