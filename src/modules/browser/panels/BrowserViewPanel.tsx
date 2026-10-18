import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";
import { browserApi } from "../browserClient";
import "./browser.css";

// Jarri's view of Claude's Brave. The page is a live picture; clicks, typing and scrolling go to Brave.
const FRAME_MS = 500;
const MOVE_MS = 120;
const SPECIAL_KEYS = ["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"];

export function BrowserViewPanel() {
  const [frame, setFrame] = useState<{ url: string; image: string | null } | null>(null);
  const [address, setAddress] = useState("");
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const image = useRef<HTMLImageElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const lastMove = useRef(0);
  const typingRef = useRef(false);
  typingRef.current = typing;

  useEffect(() => {
    let alive = true;
    const grab = () =>
      browserApi
        .screenshot()
        .then((next) => {
          if (!alive) return;
          setFrame(next);
          if (!typingRef.current) setAddress(next.url);
        })
        .catch(() => alive && setFrame(null));
    void grab();
    const timer = window.setInterval(() => void grab(), FRAME_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const send = (body: Record<string, unknown>) =>
    browserApi.input(body).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));

  // Where on the picture the mouse is, as 0-1 of its width and height.
  const at = (event: MouseEvent | WheelEvent) => {
    const rect = image.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };

  // The service expects "down", "up" or "move". The React event itself can not be sent as JSON.
  const mouse = (kind: "mousedown" | "mouseup" | "mousemove") => (event: MouseEvent) => {
    const point = at(event);
    if (!point) return;
    if (kind === "mousedown") surface.current?.focus();
    if (kind === "mousemove") {
      const now = Date.now();
      if (now - lastMove.current < MOVE_MS) return;
      lastMove.current = now;
    }
    const name = kind === "mousedown" ? "down" : kind === "mouseup" ? "up" : "move";
    void send({ type: "mouse", event: name, ...point });
  };

  const onWheel = (event: WheelEvent) => {
    const point = at(event);
    if (!point) return;
    event.preventDefault();
    void send({ type: "mouse", event: "wheel", deltaY: event.deltaY, ...point });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (SPECIAL_KEYS.includes(event.key)) {
      event.preventDefault();
      void send({ type: "key", key: event.key });
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      void send({ type: "text", value: event.key });
    }
  };

  const go = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = address.trim();
    if (!trimmed) return;
    const url = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
    setTyping(false);
    browserApi.navigate(url).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  };

  if (!frame) {
    return (
      <div className="cbv">
        <p className="cb__muted">Brave is not running. Open it from the Claude in Brave panel.</p>
      </div>
    );
  }

  return (
    <div className="cbv">
      <form className="cbv__bar" onSubmit={go}>
        <button type="button" className="cb__btn" aria-label="Back" onClick={() => void browserApi.back()}>
          ←
        </button>
        <input
          className="cbv__address"
          aria-label="Address"
          value={address}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="Type an address and press Enter"
        />
        <button type="submit" className="cb__btn cb__btn--primary">Go</button>
      </form>

      <div
        ref={surface}
        className="cbv__surface"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          event.preventDefault();
          void send({ type: "text", value: event.clipboardData.getData("text") });
        }}
      >
        {frame.image ? (
          <img
            ref={image}
            src={frame.image}
            alt={frame.url}
            draggable={false}
            onMouseDown={mouse("mousedown")}
            onMouseUp={mouse("mouseup")}
            onMouseMove={mouse("mousemove")}
            onWheel={onWheel}
          />
        ) : (
          <p className="cb__muted">The site shows here when Claude has opened it.</p>
        )}
      </div>

      <p className="cb__muted cbv__hint">
        What you do here happens in Claude's Brave. Click in the page and type as usual.
      </p>
      {error && <p className="cb__notice">{error}</p>}
    </div>
  );
}

export function BrowserViewHost() {
  return <BrowserViewPanel />;
}
