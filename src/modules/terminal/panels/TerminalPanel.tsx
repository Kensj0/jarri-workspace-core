import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { PanelBodyProps } from "../../../core/types";

// The shell runs in the terminal service (jarri-apps/terminal-service), not in
// Workspace. This panel only draws it.
const SERVICE_URL = "http://127.0.0.1:8781";
const OUTPUT_INTERVAL_MS = 40;

type OutputResponse = {
  next: number;
  data: string;
  exited: boolean;
};

// Panel state set by whoever opens this panel. Empty means a login shell.
export type TerminalLaunch = {
  cwd?: string;
  command?: string[];
};

const encoder = new TextEncoder();

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function TerminalPanel({ panel }: PanelBodyProps) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    let disposed = false;
    let sessionId: string | null = null;

    const style = getComputedStyle(element);

    const color = (token: string, fallback: string) =>
      style.getPropertyValue(token).trim() || fallback;

    // JARRI_TERMINAL_FONT_ADAPTER_V1
    // Font size belongs to Workspace PanelFrame, not the terminal.
    const frame = element.closest<HTMLElement>(".panel-frame");

    const readFontScale = () => {
      if (!frame) return 1;

      const value = Number.parseFloat(
        getComputedStyle(frame)
          .getPropertyValue("--panel-font-scale")
          .trim()
      );

      return Number.isFinite(value)
        ? Math.min(2, Math.max(0.75, value))
        : 1;
    };

    const baseFontSize = 13;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: baseFontSize * readFontScale(),
      fontFamily:
        "'JetBrains Mono', 'DejaVu Sans Mono', monospace",
      scrollback: 10000,
      convertEol: false,
      allowProposedApi: false,
      theme: {
        background: color("--theme-panel", "#101820"),
        foreground: color("--theme-text", "#e8edf2"),
        cursor: color("--theme-text", "#e8edf2"),
        selectionBackground: color("--theme-border-strong", "#42616a"),
      },
    });

    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    fit.fit();

    // Copy and paste, like a normal terminal:
    // - select text with the mouse: copied when the mouse button is released
    // - Ctrl+Shift+C, or Ctrl+C while text is selected: copy
    // - Ctrl+Shift+V: paste
    // Ctrl+C without a selection still sends Ctrl+C to the shell.
    const copySelection = () => {
      if (!terminal.hasSelection()) return;
      void navigator.clipboard
        .writeText(terminal.getSelection())
        .catch((error) => console.error("[terminal] copy:", error));
    };

    const copyOnSelect = () => copySelection();

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();

      if (event.ctrlKey && event.shiftKey && key === "c") {
        copySelection();
        return false;
      }

      if (event.ctrlKey && !event.shiftKey && key === "c" && terminal.hasSelection()) {
        copySelection();
        return false;
      }

      if (event.ctrlKey && event.shiftKey && key === "v") {
        void navigator.clipboard
          .readText()
          .then((text) => terminal.paste(text))
          .catch((error) => console.error("[terminal] paste:", error));
        return false;
      }

      return true;
    });

    element.addEventListener("mouseup", copyOnSelect);

    // Organize zooms the Workspace with a CSS transform. xterm does not take
    // that scale into account, so the mouse position is wrong. Here each mouse
    // event is corrected for the scale and passed on to xterm again.
    const correctedEvents = new WeakSet<Event>();
    const mouseEventTypes = ["mousedown", "mousemove", "mouseup", "click", "dblclick"];

    const correctForZoom = (event: Event) => {
      if (correctedEvents.has(event) || !(event instanceof MouseEvent)) return;
      const target = event.target;
      if (!(target instanceof Element)) return;

      const rect = element.getBoundingClientRect();
      const layoutWidth = element.offsetWidth;
      if (layoutWidth <= 0) return;
      const scale = rect.width / layoutWidth;
      if (Math.abs(scale - 1) < 0.001) return;

      event.stopImmediatePropagation();

      const corrected = new MouseEvent(event.type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: rect.left + (event.clientX - rect.left) / scale,
        clientY: rect.top + (event.clientY - rect.top) / scale,
        screenX: event.screenX,
        screenY: event.screenY,
        button: event.button,
        buttons: event.buttons,
        detail: event.detail,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      });
      correctedEvents.add(corrected);
      target.dispatchEvent(corrected);
    };

    for (const type of mouseEventTypes) {
      element.addEventListener(type, correctForZoom, { capture: true });
    }

    const writeSubscription = terminal.onData((data) => {
      if (!sessionId || disposed) return;

      void fetch(`${SERVICE_URL}/sessions/${sessionId}/input`, {
        method: "POST",
        body: encoder.encode(data),
      }).catch((error) => {
        console.error("[terminal] write:", error);
      });
    });

    const resizeSubscription = terminal.onResize(({ cols, rows }) => {
      if (!sessionId || disposed) return;

      void fetch(`${SERVICE_URL}/sessions/${sessionId}/resize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cols, rows }),
      }).catch((error) => {
        console.error("[terminal] resize:", error);
      });
    });

    const resizeObserver = new ResizeObserver(() => {
      if (!disposed) fit.fit();
    });
    resizeObserver.observe(element);

    // Existing frame controls update --panel-font-scale.
    // Update actual glyph dimensions, then refit the PTY.
    let fontFitFrame = 0;

    const synchronizeFontScale = () => {
      const desired = baseFontSize * readFontScale();

      if (terminal.options.fontSize === desired) return;

      terminal.options.fontSize = desired;

      cancelAnimationFrame(fontFitFrame);
      fontFitFrame = requestAnimationFrame(() => {
        if (!disposed) fit.fit();
      });
    };

    const fontObserver = new MutationObserver(
      synchronizeFontScale
    );

    if (frame) {
      fontObserver.observe(frame, {
        attributes: true,
        attributeFilter: ["style"],
      });
    }

    synchronizeFontScale();

    const syncTheme = () => {
      const current = getComputedStyle(element);
      terminal.options.theme = {
        ...terminal.options.theme,
        background:
          current.getPropertyValue("--theme-panel").trim() || "#101820",
        foreground:
          current.getPropertyValue("--theme-text").trim() || "#e8edf2",
        cursor:
          current.getPropertyValue("--theme-text").trim() || "#e8edf2",
      };
    };

    const shell = element.closest(".workspace-shell");
    const themeObserver = new MutationObserver(syncTheme);

    if (shell) {
      themeObserver.observe(shell, {
        attributes: true,
        attributeFilter: [
          "data-theme-mode",
          "data-theme-preset",
          "style",
          "class",
        ],
      });
    }

    async function start() {
      try {
        const launch = (panel.panelState ?? {}) as TerminalLaunch;
        const response = await fetch(`${SERVICE_URL}/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cols: terminal.cols,
            rows: terminal.rows,
            cwd: launch.cwd,
            command: launch.command,
          }),
        });
        if (!response.ok) {
          throw new Error(`service answered ${response.status}`);
        }
        const { id } = (await response.json()) as { id: string };

        if (disposed) {
          void fetch(`${SERVICE_URL}/sessions/${id}`, { method: "DELETE" });
          return;
        }

        sessionId = id;
        terminal.focus();
        await pumpOutput(id);
      } catch (error) {
        if (!disposed) {
          terminal.writeln(
            `\r\nTerminal service not reachable (${String(error)}). Start jarri-apps/terminal-service.`
          );
        }
      }
    }

    // Long-running loop: reads new output after the last cursor until the
    // session exits or the panel is disposed.
    async function pumpOutput(id: string) {
      let cursor = 0;
      while (!disposed) {
        const response = await fetch(
          `${SERVICE_URL}/sessions/${id}/output?after=${cursor}`
        );
        if (!response.ok) {
          throw new Error(`output answered ${response.status}`);
        }
        const body = (await response.json()) as OutputResponse;
        if (body.data) {
          terminal.write(base64ToBytes(body.data));
        }
        cursor = body.next;
        if (body.exited) {
          if (!disposed) terminal.write("\r\n[Shell exited]\r\n");
          return;
        }
        await sleep(OUTPUT_INTERVAL_MS);
      }
    }

    void start();

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      element.removeEventListener("mouseup", copyOnSelect);
      for (const type of mouseEventTypes) {
        element.removeEventListener(type, correctForZoom, { capture: true });
      }
      fontObserver.disconnect();
      cancelAnimationFrame(fontFitFrame);
      themeObserver.disconnect();
      writeSubscription.dispose();
      resizeSubscription.dispose();
      if (sessionId) {
        void fetch(`${SERVICE_URL}/sessions/${sessionId}`, {
          method: "DELETE",
        }).catch(console.error);
      }

      terminal.dispose();
    };
  }, []);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        padding: 8,
        background: "var(--theme-panel)",
      }}
    >
      <div
        ref={host}
        style={{
          width: "100%",
          height: "100%",
          minHeight: 0,
        }}
      />
    </div>
  );
}
