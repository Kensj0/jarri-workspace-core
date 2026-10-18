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
      return "Brave är stängd";
    case "approval":
      return "Claude frågar dig";
    case "access":
      return "Claude vill gå in på en sida";
    case "login":
      return "Du behöver logga in";
    case "paused":
      return "Pausad";
    case "working":
      return "Claude jobbar";
    case "idle":
      return "Claude väntar";
  }
}

// The text between the first pair of quotes, e.g. 'button "Skicka"' -> "Skicka".
function quoted(text: string): string {
  const match = text.match(/"([^"]*)"/);
  return match ? match[1] : text;
}

// "Nästa: click button "Skicka"" -> 'Claude tänker klicka på "Skicka"'
export function plainStep(step: string): string {
  const match = step.match(/^Nästa: (click|type|press) (.*)$/);
  if (!match) return step;
  const [, action, rest] = match;
  if (action === "click") return `Claude tänker klicka på "${quoted(rest)}"`;
  if (action === "type") return `Claude tänker skriva i "${quoted(rest)}"`;
  return `Claude tänker trycka ${rest.replace("tangent ", "")}`;
}

// One log line in plain words, or null for lines the panel already shows elsewhere.
export function plainEvent(event: BrowserEvent): string | null {
  const text = event.text;
  switch (event.type) {
    case "intent":
      return plainStep(text);
    case "open":
      return `Claude öppnade ${text.replace(/^Öppnar /, "")}`;
    case "approval":
      if (text.startsWith("Väntar")) return `Claude frågade dig: ${quoted(text)}`;
      if (text.startsWith("Godkänd")) return `Du sa ja: ${quoted(text)}`;
      if (text.startsWith("Nekad")) return `Du sa nej: ${quoted(text)}`;
      return text;
    case "blocked":
      return `Claude fick inte gå till ${text.replace(/^Blockerade /, "")}, du har inte sagt ja till den sidan`;
    case "login":
      return `Du behöver logga in på ${text.replace(/^Inloggning krävs på /, "")}`;
    case "permission":
      if (text.startsWith("Åtkomst beviljad")) return `Du sa ja till ${text.replace(/^Åtkomst beviljad: /, "")}`;
      if (text.startsWith("Åtkomst återkallad")) return `Du tog bort ${text.replace(/^Åtkomst återkallad: /, "")}`;
      return text;
    case "pause":
      return text.startsWith("Pausad") ? "Claude pausades" : text.startsWith("Igång") ? "Claude startade igen" : "Claude stoppades";
    case "browser":
      return text === "Brave startad" ? "Brave öppnades" : "Brave stängdes";
    default:
      return null;
  }
}

// Errors from the service, in words a person can act on.
export function friendlyError(message: string): string {
  if (message === "paused") return "Claude är pausad. Tryck på Kör först.";
  if (message === "origin_not_granted") return "Du har inte sagt ja till den sidan än.";
  if (message === "brave_not_found") return "Brave hittades inte på datorn.";
  return message;
}
