// Pure rules for the panel: what to show first, and what each log line means in plain words.
import type { Approval, BrowserEvent, BrowserRequest, BrowserStatus } from "./browserClient";

export type Focus =
  | { kind: "closed"; paused: boolean }
  | { kind: "approval"; approval: Approval }
  | { kind: "access"; request: BrowserRequest }
  | { kind: "login"; request: BrowserRequest }
  | { kind: "paused" }
  | { kind: "working"; step: string | undefined }
  | { kind: "idle" };

// One thing at a time. The first rule that matches wins.
export function focusOf(
  status: BrowserStatus,
  approvals: Approval[],
  requests: BrowserRequest[],
  step: string | undefined,
): Focus {
  if (!status.running) return { kind: "closed", paused: status.paused };
  if (approvals.length > 0) return { kind: "approval", approval: approvals[0] };
  const access = requests.find((request) => request.kind === "access");
  if (access) return { kind: "access", request: access };
  const login = requests.find((request) => request.kind === "login");
  if (login) return { kind: "login", request: login };
  if (status.paused) return { kind: "paused" };
  if (step) return { kind: "working", step };
  return { kind: "idle" };
}

export function pillText(focus: Focus): string {
  switch (focus.kind) {
    case "closed":
      return "Brave is closed";
    case "approval":
      return "Claude asks you";
    case "access":
      return "Claude wants a site";
    case "login":
      return "You need to log in";
    case "paused":
      return "Paused";
    case "working":
      return "Claude is working";
    case "idle":
      return "Claude is waiting";
  }
}

// The text between the first pair of quotes, e.g. 'button "Skicka"' -> "Skicka".
function quoted(text: string): string {
  const match = text.match(/"([^"]*)"/);
  return match ? match[1] : text;
}

// "Next: click button "Skicka"" -> 'Claude is about to click "Skicka"'
export function plainStep(step: string): string {
  const match = step.match(/^Next: (click|type|press) (.*)$/);
  if (!match) return step;
  const [, action, rest] = match;
  if (action === "click") return `Claude is about to click "${quoted(rest)}"`;
  if (action === "type") return `Claude is about to type in "${quoted(rest)}"`;
  return `Claude is about to press ${rest.replace("key ", "")}`;
}

// One log line in plain words, or null for lines the panel already shows elsewhere.
export function plainEvent(event: BrowserEvent): string | null {
  const text = event.text;
  switch (event.type) {
    case "intent":
      return plainStep(text);
    case "open":
      return text.startsWith("Opening ")
        ? `Claude opened ${text.replace(/^Opening /, "")}`
        : `You opened ${text.replace(/^You opened /, "")}`;
    case "approval":
      if (text.startsWith("Waiting")) return `Claude asked you: ${quoted(text)}`;
      if (text.startsWith("Approved")) return `You said yes: ${quoted(text)}`;
      if (text.startsWith("Denied")) return `You said no: ${quoted(text)}`;
      return text;
    case "blocked":
      return `Claude could not go to ${text.replace(/^Blocked /, "")}. You have not said yes to that site.`;
    case "login":
      return `You need to log in to ${text.replace(/^Log in needed on /, "")}`;
    case "permission":
      if (text.startsWith("Access granted")) return `You said yes to ${text.replace(/^Access granted: /, "")}`;
      if (text.startsWith("Access removed")) return `You removed ${text.replace(/^Access removed: /, "")}`;
      return text;
    case "pause":
      if (text.startsWith("Paused")) return "Claude was paused";
      if (text.startsWith("Running")) return "Claude started again";
      return "Claude was stopped";
    case "browser":
      return text === "Brave started" ? "Brave opened" : "Brave closed";
    default:
      return null;
  }
}

// Errors from the service, in words a person can act on.
export function friendlyError(message: string): string {
  if (message === "paused") return "Claude is paused. Press Run first.";
  if (message === "origin_not_granted") return "You have not said yes to that site yet.";
  if (message === "brave_not_found") return "Brave was not found on this computer.";
  return message;
}
