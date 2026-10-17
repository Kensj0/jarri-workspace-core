import { useCallback, useEffect, useState } from "react";
import {
  durationLabel,
  exhaustsInMs,
  windowLabel,
  type Limits,
  type Meter,
  type Tokens,
} from "../aiUsageMath";
import "./aiUsage.css";

type Snapshot = {
  now: number;
  fiveHourStart: number;
  sevenDayStart: number;
  tokens: Record<string, Tokens>;
  limits: Limits | null;
};

// The usage numbers come from jarri-apps/ai-usage-service. This panel only draws them.
const SERVICE_URL = "http://127.0.0.1:8783";
const REFRESH_MS = 60_000;

const count = (value: number) => value.toLocaleString("sv-SE");

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });

function TokenCounts({ tokens }: { tokens: Tokens }) {
  return (
    <dl className="ai-usage__counts">
      <div>
        <dt>in</dt>
        <dd>{count(tokens.input)}</dd>
      </div>
      <div>
        <dt>ut</dt>
        <dd>{count(tokens.output)}</dd>
      </div>
      <div>
        <dt>cache skrivet</dt>
        <dd>{count(tokens.cacheWrite)}</dd>
      </div>
      <div>
        <dt>cache läst</dt>
        <dd>{count(tokens.cacheRead)}</dd>
      </div>
      <div>
        <dt>svar</dt>
        <dd>{count(tokens.messages)}</dd>
      </div>
    </dl>
  );
}

function MeterCard({ meter, now }: { meter: Meter; now: number }) {
  const exhaust = exhaustsInMs(meter, now);
  const resetIn =
    meter.resetsAt === undefined ? undefined : Date.parse(meter.resetsAt) - now;
  const beforeReset = exhaust !== undefined && resetIn !== undefined && exhaust < resetIn;
  const fill = Math.min(100, Math.max(0, meter.percentUsed));

  return (
    <section className="ai-usage__meter">
      <h3>{windowLabel(meter.kind)}</h3>
      <div
        className="ai-usage__bar"
        role="meter"
        aria-label={windowLabel(meter.kind)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fill}
      >
        <span className={beforeReset ? "is-warning" : undefined} style={{ width: `${fill}%` }} />
      </div>
      <p>
        {meter.percentUsed.toFixed(1)} % använt · {(100 - meter.percentUsed).toFixed(1)} % kvar
      </p>
      {resetIn !== undefined && meter.resetsAt !== undefined && (
        <p>
          Återställs om {durationLabel(resetIn)} (kl {clock(meter.resetsAt)})
        </p>
      )}
      {exhaust !== undefined && (
        <p className={beforeReset ? "is-warning" : undefined}>
          Vid nuvarande takt: slut om {durationLabel(exhaust)}
          {beforeReset ? " (före återställning)" : " (räcker till återställning)"}
        </p>
      )}
      {meter.tokens !== undefined && <TokenCounts tokens={meter.tokens} />}
    </section>
  );
}

export function AiUsagePanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${SERVICE_URL}/snapshot`);
      if (!response.ok) {
        throw new Error(`service answered ${response.status}`);
      }
      setSnapshot((await response.json()) as Snapshot);
      setError(null);
    } catch (failure) {
      setError(String(failure));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (!snapshot) {
    return <div className="ai-usage__empty">{error ?? "Laddar…"}</div>;
  }

  const { now, limits, tokens, fiveHourStart, sevenDayStart } = snapshot;

  return (
    <div className="ai-usage">
      {error && <p className="ai-usage__error">{error}</p>}

      {limits ? (
        <>
          {limits.meters.map((meter) => (
            <MeterCard key={meter.kind} meter={meter} now={now} />
          ))}
          {limits.costUsd !== undefined && (
            <p className="ai-usage__note">Kostnad denna session: ${limits.costUsd.toFixed(2)}</p>
          )}
          <p className="ai-usage__note">
            Kvoten uppmättes {new Date(limits.measuredAt).toLocaleTimeString("sv-SE")}. Uppdateras av
            ai-usage-panelen i Claude Code.
          </p>
        </>
      ) : (
        <p className="ai-usage__note">
          Ingen kvotdata. Öppna /ai-usage i en Claude Code-session för att se procent och
          återställning.
        </p>
      )}

      <section className="ai-usage__meter">
        <h3>Senaste 5 timmarna</h3>
        {tokens[String(fiveHourStart)] ? (
          <TokenCounts tokens={tokens[String(fiveHourStart)]} />
        ) : (
          <p className="ai-usage__note">Inga tokens hittades.</p>
        )}
      </section>

      <section className="ai-usage__meter">
        <h3>Senaste 7 dagarna</h3>
        {tokens[String(sevenDayStart)] ? (
          <TokenCounts tokens={tokens[String(sevenDayStart)]} />
        ) : (
          <p className="ai-usage__note">Inga tokens hittades.</p>
        )}
      </section>
    </div>
  );
}
