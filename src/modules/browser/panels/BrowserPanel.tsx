import { useCallback, useEffect, useState } from "react";
import {
  browserApi,
  currentIntent,
  recentEvents,
  type Approval,
  type BrowserEvent,
  type BrowserRequest,
  type BrowserStatus,
  type Permissions,
} from "../browserClient";
import "./browser.css";

// Shows what Claude does in Brave and lets the user stop, pause, approve and grant access.
// The browser service decides everything. This panel only draws its state and presses its buttons.
const REFRESH_MS = 1500;

type Snapshot = {
  status: BrowserStatus;
  events: BrowserEvent[];
  requests: BrowserRequest[];
  approvals: Approval[];
  permissions: Permissions;
};

const clock = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function BrowserPanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [status, events, requests, approvals, permissions] = await Promise.all([
        browserApi.status(),
        browserApi.events(),
        browserApi.requests(),
        browserApi.approvals(),
        browserApi.permissions(),
      ]);
      setSnapshot({ status, events, requests, approvals, permissions });
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const press = async (action: () => Promise<unknown>) => {
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
    await refresh();
  };

  if (offline || !snapshot) {
    return (
      <div className="browser-panel">
        <p className="browser-panel__empty">
          Tjänsten svarar inte. Starta den i terminalen med{" "}
          <code>systemctl --user start jarri-browser</code>.
        </p>
      </div>
    );
  }

  const { status, events, requests, approvals, permissions } = snapshot;
  const grants = Object.entries(permissions);
  const intent = status.paused ? "Pausad" : currentIntent(events) ?? "Inget just nu";

  return (
    <div className="browser-panel">
      <section className="browser-panel__head">
        <p>
          Brave: <strong>{status.running ? "öppen" : "stängd"}</strong> · Claude:{" "}
          <strong>{status.paused ? "pausad" : "kan arbeta"}</strong>
        </p>
        <p className="browser-panel__intent">{intent}</p>
        <div className="browser-panel__buttons">
          {status.paused ? (
            <button type="button" onClick={() => press(() => browserApi.pause(false))}>
              ▶ Kör
            </button>
          ) : (
            <button type="button" onClick={() => press(() => browserApi.pause(true))}>
              ❚❚ Paus
            </button>
          )}
          {status.running ? (
            <button type="button" onClick={() => press(browserApi.stop)}>
              ■ Stopp
            </button>
          ) : (
            <button type="button" onClick={() => press(browserApi.start)}>
              Starta Brave
            </button>
          )}
        </div>
        {notice && <p className="browser-panel__notice">{notice}</p>}
      </section>

      {(approvals.length > 0 || requests.length > 0) && (
        <section className="browser-panel__section">
          <h3>Väntar på dig</h3>
          {approvals.map((approval) => (
            <div className="browser-panel__item" key={approval.id}>
              <p>Claude vill klicka: <strong>{approval.label}</strong></p>
              <div className="browser-panel__buttons">
                <button type="button" onClick={() => press(() => browserApi.decide(approval.id, true))}>
                  Godkänn
                </button>
                <button type="button" onClick={() => press(() => browserApi.decide(approval.id, false))}>
                  Neka
                </button>
              </div>
            </div>
          ))}
          {requests.map((request) => (
            <div className="browser-panel__item" key={request.id}>
              {request.kind === "login" ? (
                <p>Logga in på <strong>{request.origin}</strong> i Brave. Tryck sedan på knappen.</p>
              ) : (
                <p>Claude vill använda <strong>{request.origin}</strong>.</p>
              )}
              <div className="browser-panel__buttons">
                {request.kind === "login" && (
                  <button type="button" onClick={() => press(() => browserApi.dismiss(request.id))}>
                    Jag är inloggad
                  </button>
                )}
                <button type="button" onClick={() => press(() => browserApi.grant(request.origin, 1))}>
                  Ge åtkomst 1 timme
                </button>
                <button type="button" onClick={() => press(() => browserApi.grant(request.origin, null))}>
                  Ge åtkomst tills vidare
                </button>
                <button type="button" onClick={() => press(() => browserApi.dismiss(request.id))}>
                  Avvisa
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="browser-panel__section">
        <h3>Åtkomst</h3>
        {grants.length === 0 && <p className="browser-panel__empty">Ingen sajt är godkänd.</p>}
        {grants.map(([origin, grant]) => (
          <div className="browser-panel__item browser-panel__row" key={origin}>
            <span>
              {origin}
              <small>{grant.until === null ? " · tills vidare" : ` · till ${clock(grant.until)}`}</small>
            </span>
            <button type="button" onClick={() => press(() => browserApi.revoke(origin))}>
              Återkalla
            </button>
          </div>
        ))}
      </section>

      <section className="browser-panel__section">
        <h3>Senaste</h3>
        {recentEvents(events).map((event) => (
          <p className="browser-panel__event" key={`${event.t}-${event.type}-${event.text}`}>
            <small>{clock(event.t)}</small> {event.text}
          </p>
        ))}
      </section>
    </div>
  );
}
