import { focusOf, plainEvent, plainStep } from "./browserView";
import type { Approval, BrowserRequest, BrowserStatus } from "./browserClient";

function assertEqual<T>(actual: T, expected: T, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}

const open: BrowserStatus = { running: true, paused: false, tabs: 1 };
const approval: Approval = { id: "a", label: "Skicka", action: "click", approved: false, at: 0 };
const access: BrowserRequest = { id: "r", kind: "access", origin: "https://netlify.com", url: "", at: 0 };
const login: BrowserRequest = { id: "l", kind: "login", origin: "https://netlify.com", url: "", at: 0 };

assertEqual(focusOf({ running: false, paused: false, tabs: 0 }, [], [], undefined).kind, "closed", "closed");
assertEqual(focusOf({ running: false, paused: true, tabs: 0 }, [], [], undefined), { kind: "closed", paused: true }, "closed after stop");
assertEqual(focusOf(open, [approval], [access], "x").kind, "approval", "approval beats everything");
assertEqual(focusOf(open, [], [login, access], undefined).kind, "access", "access before login");
assertEqual(focusOf(open, [], [login], undefined).kind, "login", "login");
assertEqual(focusOf({ ...open, paused: true }, [], [], "x").kind, "paused", "paused beats working");
assertEqual(focusOf(open, [], [], "Next: click button \"Spara\""), { kind: "working", step: "Next: click button \"Spara\"" }, "working");
assertEqual(focusOf(open, [], [], undefined).kind, "idle", "idle");

assertEqual(plainStep('Next: click button "Skicka"'), 'Claude is about to click "Skicka"', "click step");
assertEqual(plainStep("Next: press key Enter"), "Claude is about to press Enter", "press step");
assertEqual(
  plainEvent({ t: 0, type: "approval", text: 'Waiting for approval: click "Dela"' }),
  'Claude asked you: Dela',
  "approval asked",
);
assertEqual(plainEvent({ t: 0, type: "request", text: "access: x" }), null, "requests are hidden in the log");
console.log("browserView tests passed");
