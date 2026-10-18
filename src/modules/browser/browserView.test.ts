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
assertEqual(focusOf(open, [], [], "Nästa: click button \"Spara\""), { kind: "working", step: "Nästa: click button \"Spara\"" }, "working");
assertEqual(focusOf(open, [], [], undefined).kind, "idle", "idle");

assertEqual(plainStep('Nästa: click button "Skicka"'), 'Claude tänker klicka på "Skicka"', "click step");
assertEqual(plainStep("Nästa: press tangent Enter"), "Claude tänker trycka Enter", "press step");
assertEqual(
  plainEvent({ t: 0, type: "approval", text: 'Väntar på godkännande: click "Dela"' }),
  'Claude frågade dig: Dela',
  "approval asked",
);
assertEqual(plainEvent({ t: 0, type: "request", text: "access: x" }), null, "requests are hidden in the log");
console.log("browserView tests passed");
