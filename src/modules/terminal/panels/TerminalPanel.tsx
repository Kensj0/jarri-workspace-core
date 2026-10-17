import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type TerminalOutput = {
  session_id: string;
  data: number[];
};

type TerminalExit = {
  session_id: string;
};

const encoder = new TextEncoder();

export function TerminalPanel() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    let disposed = false;
    let sessionId: string | null = null;
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

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

    const writeSubscription = terminal.onData((data) => {
      if (!sessionId || disposed) return;

      void invoke("terminal_write", {
        sessionId,
        data: Array.from(encoder.encode(data)),
      }).catch((error) => {
        console.error("[terminal] write:", error);
      });
    });

    const resizeSubscription = terminal.onResize(({ cols, rows }) => {
      if (!sessionId || disposed) return;

      void invoke("terminal_resize", {
        sessionId,
        cols,
        rows,
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
        const outputStop = await listen<TerminalOutput>(
          "jarri://terminal-output",
          ({ payload }) => {
            if (
              !disposed &&
              payload.session_id === sessionId
            ) {
              terminal.write(new Uint8Array(payload.data));
            }
          }
        );

        const exitStop = await listen<TerminalExit>(
          "jarri://terminal-exit",
          ({ payload }) => {
            if (payload.session_id === sessionId && !disposed) {
              terminal.write("\r\n[Shell exited]\r\n");
            }
          }
        );

        if (disposed) {
          outputStop();
          exitStop();
          return;
        }

        unlistenOutput = outputStop;
        unlistenExit = exitStop;

        const id = await invoke<string>("terminal_start", {
          cols: terminal.cols,
          rows: terminal.rows,
        });

        if (disposed) {
          await invoke("terminal_stop", {
            sessionId: id,
          }).catch(console.error);
          return;
        }

        sessionId = id;
        terminal.focus();
      } catch (error) {
        if (!disposed) {
          terminal.writeln(
            `\r\nTerminal startup failed: ${String(error)}`
          );
        }
      }
    }

    void start();

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      fontObserver.disconnect();
      cancelAnimationFrame(fontFitFrame);
      themeObserver.disconnect();
      writeSubscription.dispose();
      resizeSubscription.dispose();
      unlistenOutput?.();
      unlistenExit?.();

      if (sessionId) {
        void invoke("terminal_stop", {
          sessionId,
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
