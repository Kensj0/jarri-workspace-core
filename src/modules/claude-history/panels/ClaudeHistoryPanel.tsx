import { useCallback, useEffect, useMemo, useState } from "react";
import type { PanelBodyProps } from "../../../core/types";
import {
  matchesQuery,
  relativeAge,
  shortPath,
  type HistorySession,
} from "../claudeHistoryMath";
import "./claudeHistory.css";

// The session list comes from the history service (jarri-apps/claude-history-service).
const SERVICE_URL = "http://127.0.0.1:8784";
const REFRESH_MS = 60_000;

const messageLabel = (count: number) =>
  count === 1 ? "1 meddelande" : `${count.toLocaleString("sv-SE")} meddelanden`;

export function ClaudeHistoryPanel({ openPanel }: PanelBodyProps) {
  const [sessions, setSessions] = useState<HistorySession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${SERVICE_URL}/sessions`);
      if (!response.ok) {
        throw new Error(`service answered ${response.status}`);
      }
      setSessions((await response.json()) as HistorySession[]);
      setError(null);
    } catch (failure) {
      setError(
        `Historiktjänsten svarar inte (${String(failure)}). Starta jarri-claude-history.service.`,
      );
    }
    setNow(Date.now());
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const visible = useMemo(
    () => (sessions ?? []).filter((session) => matchesQuery(session, query)),
    [sessions, query],
  );

  const openSession = (session: HistorySession) => {
    const opened = openPanel("terminal", "shell", {
      cwd: session.cwd ?? undefined,
      command: ["jarri-claude-shell", "--resume", session.id],
    });
    if (opened === null) {
      setError("Kunde inte öppna terminalen.");
    }
  };

  return (
    <div className="claude-history">
      <div className="claude-history__toolbar">
        <input
          type="search"
          className="claude-history__search"
          placeholder="Sök i titel eller mapp"
          aria-label="Sök i chattar"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" onClick={() => void refresh()}>
          Uppdatera
        </button>
      </div>

      {error && <p className="claude-history__error">{error}</p>}

      {sessions === null ? (
        !error && <p className="claude-history__empty">Laddar…</p>
      ) : visible.length === 0 ? (
        <p className="claude-history__empty">
          {query.trim() ? "Inga chattar matchar sökningen." : "Inga chattar hittades."}
        </p>
      ) : (
        <ul className="claude-history__list">
          {visible.map((session) => (
            <li key={session.id}>
              <button
                type="button"
                className="claude-history__item"
                onClick={() => openSession(session)}
              >
                <span className="claude-history__title">{session.title}</span>
                <span className="claude-history__meta">
                  {shortPath(session.cwd)} · {relativeAge(session.modified, now)} ·{" "}
                  {messageLabel(session.messages)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
