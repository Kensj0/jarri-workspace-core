// Talks to jarri-apps/browser-service over localhost HTTP. The panel only shows and presses buttons.
export const BROWSER_URL = "http://127.0.0.1:8786";

export type BrowserStatus = { running: boolean; paused: boolean; tabs: number };
export type BrowserEvent = { t: number; type: string; text: string };
export type BrowserRequest = {
  id: string;
  kind: "access" | "login";
  origin: string;
  url: string;
  at: number;
};
export type Approval = { id: string; label: string; action: string; approved: boolean; at: number };
export type Permissions = Record<string, { until: number | null }>;

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const response = await fetch(BROWSER_URL + path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload as T;
}

export const browserApi = {
  status: () => call<BrowserStatus>("GET", "/status"),
  events: () => call<BrowserEvent[]>("GET", "/events"),
  requests: () => call<BrowserRequest[]>("GET", "/requests"),
  approvals: () => call<Approval[]>("GET", "/approvals"),
  permissions: () => call<Permissions>("GET", "/permissions"),
  start: () => call<BrowserStatus>("POST", "/browser/start"),
  stop: () => call<BrowserStatus>("POST", "/browser/stop"),
  pause: (on: boolean) => call<{ paused: boolean }>("POST", "/pause", { on }),
  grant: (origin: string, hours: number | null) => call("POST", "/permissions", { origin, hours }),
  revoke: (origin: string) => call("POST", "/permissions/revoke", { origin }),
  decide: (id: string, approve: boolean) => call("POST", "/approvals", { id, approve }),
  dismiss: (id: string) => call("POST", "/requests/dismiss", { id }),
  screenshot: () => call<{ url: string; title: string; image: string | null }>("GET", "/screenshot"),
  navigate: (url: string) => call("POST", "/navigate", { url }),
  back: () => call("POST", "/navigate/back", {}),
  input: (body: Record<string, unknown>) => call("POST", "/input", body),
};

// What Claude is about to do: the newest intent, unless the log has a newer pause or stop.
export function currentIntent(events: BrowserEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type === "pause") return undefined;
    if (events[i].type === "intent") return events[i].text;
  }
  return undefined;
}

export function recentEvents(events: BrowserEvent[], limit = 30): BrowserEvent[] {
  return events.slice(-limit).reverse();
}
