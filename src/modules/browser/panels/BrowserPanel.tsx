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
import type { PanelBodyProps } from "../../../core/types";
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

export function BrowserPanel({ openPanel }: { openPanel: PanelBodyProps["openPanel"] }) {
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

  // One button for the whole job: lift a pause if there is one, open Brave, and open Claude next to it.
  const start = async () => {
    if (snapshot?.status.paused) await browserApi.pause(false);
    if (!snapshot?.status.running) await browserApi.start();
    if (!openPanel("terminal", "shell", { command: ["jarri-claude-shell"] })) {
      throw new Error("Could not open the Claude terminal.");
    }
    openPanel("browser", "browser-view", {});
  };

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
          <h3>Claude can't reach its service</h3>
          <p>Type in the terminal: <code>systemctl --user start jarri-browser</code></p>
          <button className="cb__btn cb__btn--primary" type="button" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const { status, events, requests, approvals, permissions } = snapshot;
  const step = currentIntent(events);
  const focus = focusOf(status, approvals, requests, step);
  const grants = Object.entries(permissions);
  const worked = events.some((event) => event.type === "open" || event.type === "intent");

  return (
    <div className="cb">
      <header className="cb__top">
        <h2 className="cb__title">Claude in Brave</h2>
      </header>

      <FocusCard focus={focus} press={press} start={start} running={status.running} worked={worked} />

      {notice && <p className="cb__notice">{notice}</p>}

      {status.running && (
        <div className="cb__controls">
          {status.paused ? (
            <button className="cb__btn cb__btn--primary" type="button" onClick={() => press(() => browserApi.pause(false))}>
              ▶ Run
            </button>
          ) : (
            <button className="cb__btn" type="button" onClick={() => press(() => browserApi.pause(true))}>
              ❚❚ Pause
            </button>
          )}
          <button className="cb__btn cb__btn--danger" type="button" onClick={() => press(browserApi.stop)}>
            ■ Stop
          </button>
        </div>
      )}

      <Box title={`Sites Claude may use (${grants.length})`}>
        {grants.length === 0 && <p className="cb__muted">No site is approved yet. Claude asks you first.</p>}
        {grants.map(([origin, grant]) => (
          <div className="cb__row" key={origin}>
            <div>
              <strong>{origin.replace(/^https?:\/\//, "")}</strong>
              <div className="cb__muted">
                {grant.until === null ? "Until you remove it" : `Until ${clock(grant.until)}`}
              </div>
            </div>
            <button className="cb__btn" type="button" onClick={() => press(() => browserApi.revoke(origin))}>
              Remove
            </button>
          </div>
        ))}
      </Box>

      <Box title="What has Claude done?">
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

      <Box title="How it works">
        <ol className="cb__steps">
          <li>Press Start. Brave opens in its own window. Your normal Brave is not touched.</li>
          <li>Claude asks you before it opens a new site.</li>
          <li>You say yes or no. Yes can last one hour, or until you remove it.</li>
          <li>To stop everything, press Pause or Stop.</li>
        </ol>
      </Box>
    </div>
  );
}

// The one big card. Its buttons are the only things the user needs to press.
function FocusCard({
  focus,
  press,
  start,
  running,
  worked,
}: {
  focus: Focus;
  press: (action: () => Promise<unknown>) => Promise<void>;
  start: () => Promise<void>;
  running: boolean;
  worked: boolean;
}) {
  const card = (tone: string, title: string, body: ReactNode, buttons: ReactNode) => (
    <section className={`cb__card cb__card--${tone}`}>
      <h3>{title}</h3>
      {body}
      <div className="cb__buttons">{buttons}</div>
    </section>
  );

  switch (focus.kind) {
    case "closed":
      return card(
        "closed",
        focus.paused ? "Claude is stopped" : "Claude is not running",
        <p>Press the button. Brave and a Claude terminal open next to each other, ready for your task.</p>,
        <button className="cb__btn cb__btn--primary" type="button" onClick={() => press(start)}>
          Start Claude and open Brave
        </button>,
      );

    case "approval": {
      const what = focus.approval.action === "press"
        ? "press Enter in a form"
        : `click "${focus.approval.label.replace(/^\w+ "(.*)"$/, "$1")}"`;
      return card("ask", "Claude wants to do something",
        <p>Claude wants to <strong>{what}</strong>. It could send, pay, delete or log in. Only say yes if you want that.</p>,
        <>
          <button className="cb__btn cb__btn--primary" type="button"
            onClick={() => press(() => browserApi.decide(focus.approval.id, true))}>Yes</button>
          <button className="cb__btn" type="button"
            onClick={() => press(() => browserApi.decide(focus.approval.id, false))}>No</button>
        </>);
    }

    case "access":
      return card("ask", "Claude wants to open a site",
        <p>Site: <strong>{focus.request.origin.replace(/^https?:\/\//, "")}</strong>. Yes means Claude may read the site and click on it.</p>,
        <>
          <button className="cb__btn cb__btn--primary" type="button"
            onClick={() => press(() => browserApi.grant(focus.request.origin, 1))}>Yes, for 1 hour</button>
          <button className="cb__btn" type="button"
            onClick={() => press(() => browserApi.grant(focus.request.origin, null))}>Yes, until I remove it</button>
          <button className="cb__btn" type="button"
            onClick={() => press(() => browserApi.dismiss(focus.request.id))}>No</button>
        </>);

    case "login":
      return card("ask", "Log in first",
        <p>Log in to <strong>{focus.request.origin.replace(/^https?:\/\//, "")}</strong> in the Brave panel. Claude waits until you are done.</p>,
        <button className="cb__btn cb__btn--primary" type="button"
          onClick={() => press(() => browserApi.dismiss(focus.request.id))}>Done, I have logged in</button>);

    case "paused":
      return card("paused", "Claude is paused",
        <p>Claude is not doing anything now. Press Run when it should continue.</p>,
        <button className="cb__btn cb__btn--primary" type="button" onClick={() => press(() => browserApi.pause(false))}>
          ▶ Run
        </button>);

    case "working":
      return card("working", "Claude is working",
        <p>{plainStep(focus.step ?? "")}</p>,
        <button className="cb__btn" type="button" onClick={() => press(() => browserApi.pause(true))}>
          ❚❚ Pause Claude
        </button>);

    case "idle":
      return card(
        "idle",
        worked ? "Done" : "Claude is waiting for you",
        <p>{worked
          ? "Type the next task in the Claude terminal. The sites show in the Brave panel."
          : "Type in the Claude terminal what Claude should do. The sites show in the Brave panel."}</p>,
        <button className="cb__btn cb__btn--primary" type="button" onClick={() => press(start)}>
          {running ? "Open the Claude terminal" : "Start Claude and open Brave"}
        </button>,
      );
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

// The panel host passes openPanel in, so the start button can open the Claude terminal.
export function BrowserPanelHost({ openPanel }: PanelBodyProps) {
  return <BrowserPanel openPanel={openPanel} />;
}
