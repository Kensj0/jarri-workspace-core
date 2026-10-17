// Samma beräkning som ai-usage-modulen i Claude Code: förbrukningen hittills i
// fönstret, extrapolerad till 100 % vid nuvarande takt.

export type Tokens = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  messages: number;
};

export type Meter = {
  kind: string;
  percentUsed: number;
  resetsAt?: string;
  since?: number;
  tokens?: Tokens;
};

export type Limits = {
  measuredAt: number;
  meters: Meter[];
  costUsd?: number;
};

export function exhaustsInMs(meter: Meter, now: number): number | undefined {
  if (meter.since === undefined || meter.percentUsed <= 0) return undefined;
  const elapsed = now - meter.since;
  if (elapsed <= 0) return undefined;
  const perMs = meter.percentUsed / elapsed;
  return Math.max(0, (100 - meter.percentUsed) / perMs);
}

export function durationLabel(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

export function windowLabel(kind: string): string {
  if (kind === "five_hour") return "5-timmarsfönstret";
  if (kind === "seven_day") return "Veckofönstret";
  return kind;
}
