import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  browserApi,
  currentIntent,
  type Approval,
  type BrowserEvent,
  type BrowserRequest,
  type BrowserStatus,
  type Permissions,
} from "../browserClient";
import { focusOf, friendlyError, plainEvent, plainStep, type Focus } from "../browserView";
import "./browser.css";

// The panel shows one question at a time: what does Claude need from you right now?
const REFRESH_MS = 1500;

type Snapshot = {
  status: BrowserStatus;
  events: BrowserEvent[];
  requests: BrowserRequest[];
  approvals: Approval[];
  permissions: Permissions;
};

const clock = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });

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

  // Runs one button press, shows a plain error if it fails, then looks at the new state.
  const press = async (action: () => Promise<unknown>) => {
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice(friendlyError(error instanceof Error ? error.message : String(error)));
    }
    await refresh();
  };

  if (offline || !snapshot) {
    return (
      <div className="cb">
        <div className="cb__card cb__card--alert">
          <h3>Claude når inte sin tjänst</h3>
          <p>Skriv i terminalen: <code>systemctl --user start jarri-browser</code></p>
          <button className="cb__btn cb__btn--primary" type="button" onClick={() => void refresh()}>
            Försök igen
          </button>
        </div>
      </div>
    );
  }

  const { status, events, requests, approvals, permissions } = snapshot;
  const step = currentIntent(events);
  const focus = focusOf(status, approvals, requests, step);
  const grants = Object.entries(permissions);

  return (
    <div className="cb">
      <header className="cb__top">
        <h2 className="cb__title">Claude i Brave</h2>
      </header>

      <FocusCard focus={focus} press={press} />

      {notice && <p className="cb__notice">{notice}</p>}

      {status.running && (
        <div className="cb__controls">
          {status.paused ? (
            <button className="cb__btn cb__btn--primary" type="button" onClick={() => press(() => browserApi.pause(false))}>
              ▶ Kör
            </button>
          ) : (
            <button className="cb__btn" type="button" onClick={() => press(() => browserApi.pause(true))}>
              ❚❚ Paus
            </button>
          )}
          <button className="cb__btn cb__btn--danger" type="button" onClick={() => press(browserApi.stop)}>
            ■ Stoppa
          </button>
        </div>
      )}

      <Box title={`Sidor Claude får gå in på (${grants.length})`}>
        {grants.length === 0 && <p className="cb__muted">Ingen sida är godkänd än. Claude frågar dig först.</p>}
        {grants.map(([origin, grant]) => (
          <div className="cb__row" key={origin}>
            <div>
              <strong>{origin.replace(/^https?:\/\//, "")}</strong>
              <div className="cb__muted">
                {grant.until === null ? "Tills du tar bort det" : `Till kl ${clock(grant.until)}`}
              </div>
            </div>
            <button className="cb__btn" type="button" onClick={() => press(() => browserApi.revoke(origin))}>
              Ta bort
            </button>
          </div>
        ))}
      </Box>

      <Box title="Vad har Claude gjort?">
        {events
          .slice(-40)
          .reverse()
          .map((event) => ({ event, text: plainEvent(event) }))
          .filter((row): row is { event: BrowserEvent; text: string } => row.text !== null)
          .map(({ event, text }) => (
            <p className="cb__log" key={`${event.t}-${event.type}-${event.text}`}>
              <span className="cb__muted">{clock(event.t)}</span> {text}
            </p>
          ))}
      </Box>

      <Box title="Så funkar det">
        <ol className="cb__steps">
          <li>Öppna Brave med knappen. Det är Claudes eget fönster.</li>
          <li>Claude frågar dig innan den går in på en ny sida.</li>
          <li>Du säger ja eller nej. Ja kan vara i en timme eller tills du tar bort det.</li>
          <li>Vill du stoppa allt, tryck Paus eller Stoppa.</li>
        </ol>
      </Box>
    </div>
  );
}

// The one big card. Its buttons are the only things the user needs to press.
function FocusCard({ focus, press }: { focus: Focus; press: (action: () => Promise<unknown>) => Promise<void> }) {
  const card = (tone: string, title: string, body: ReactNode, buttons: ReactNode) => (
    <section className={`cb__card cb__card--${tone}`}>
      <h3>{title}</h3>
      {body}
      <div className="cb__buttons">{buttons}</div>
    </section>
  );

  switch (focus.kind) {
    case "closed":
      return focus.paused
        ? card("paused", "Claude är stoppad", <p>Tryck på knappen för att starta Claude igen. Brave öppnas då också.</p>,
            <button className="cb__btn cb__btn--primary" type="button"
              onClick={() => press(async () => { await browserApi.pause(false); await browserApi.start(); })}>
              Starta Claude och öppna Brave
            </button>)
        : card("closed", "Brave är inte öppen", <p>Claude kan inte göra något förrän du öppnar Brave.</p>,
            <button className="cb__btn cb__btn--primary" type="button" onClick={() => press(browserApi.start)}>
              Öppna Brave
            </button>);

    case "approval": {
      const what = focus.approval.action === "press"
        ? "trycka Enter i ett formulär"
        : `klicka på "${focus.approval.label.replace(/^\w+ "(.*)"$/, "$1")}"`;
      return card("ask", "Claude vill göra något",
        <p>Claude vill <strong>{what}</strong>. Det kan skicka, betala, ta bort eller logga in. Säg ja bara om du vill det.</p>,
        <>
          <button className="cb__btn cb__btn--primary" type="button"
            onClick={() => press(() => browserApi.decide(focus.approval.id, true))}>Ja</button>
          <button className="cb__btn" type="button"
            onClick={() => press(() => browserApi.decide(focus.approval.id, false))}>Nej</button>
        </>);
    }

    case "access":
      return card("ask", "Claude vill gå in på en sida",
        <p>Sidan: <strong>{focus.request.origin.replace(/^https?:\/\//, "")}</strong>. Ja betyder att Claude får läsa sidan och klicka på den.</p>,
        <>
          <button className="cb__btn cb__btn--primary" type="button"
            onClick={() => press(() => browserApi.grant(focus.request.origin, 1))}>Ja, i 1 timme</button>
          <button className="cb__btn" type="button"
            onClick={() => press(() => browserApi.grant(focus.request.origin, null))}>Ja, tills jag tar bort det</button>
          <button className="cb__btn" type="button"
            onClick={() => press(() => browserApi.dismiss(focus.request.id))}>Nej</button>
        </>);

    case "login":
      return card("ask", "Logga in först",
        <p>Logga in på <strong>{focus.request.origin.replace(/^https?:\/\//, "")}</strong> i Brave-fönstret. Claude väntar tills du är klar.</p>,
        <button className="cb__btn cb__btn--primary" type="button"
          onClick={() => press(() => browserApi.dismiss(focus.request.id))}>Klar, jag har loggat in</button>);

    case "paused":
      return card("paused", "Claude är pausad",
        <p>Claude gör ingenting nu. Tryck på Kör när den ska fortsätta.</p>,
        <button className="cb__btn cb__btn--primary" type="button" onClick={() => press(() => browserApi.pause(false))}>
          ▶ Kör
        </button>);

    case "working":
      return card("working", "Claude jobbar",
        <p>{plainStep(focus.step ?? "")}</p>,
        <button className="cb__btn" type="button" onClick={() => press(() => browserApi.pause(true))}>
          ❚❚ Pausa Claude
        </button>);

    case "idle":
      return card("idle", "Claude väntar",
        <p>Be Claude göra något i terminalen. Då syns det här.</p>,
        null);
  }
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="cb__box">
      <summary>{title}</summary>
      <div className="cb__boxBody">{children}</div>
    </details>
  );
}
