import { useEffect, useRef, useState } from "react";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import {
  clipboardKindLabel,
  formatByteSize,
  summarizeClipboard,
  type ClipboardSummary,
} from "../core/clipboardSummary";
import { playPling } from "./clipboardPing";

const POLL_MS = 1_000;

function describe(summary: ClipboardSummary): string {
  if (summary.kind === "empty") {
    return clipboardKindLabel.empty;
  }

  return `${clipboardKindLabel[summary.kind]} · ${formatByteSize(summary.bytes)}`;
}

export function ClipboardStatus() {
  const [summary, setSummary] = useState<ClipboardSummary | null>(null);
  const [changeCount, setChangeCount] = useState(0);
  const [readError, setReadError] = useState<string | null>(null);
  const lastTextRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      let text: string;

      try {
        text = await readText();
      } catch (error) {
        // Image-only or unsupported clipboard content also lands here.
        if (!cancelled) {
          setReadError(String(error));
        }
        return;
      }

      if (cancelled) {
        return;
      }

      setReadError(null);

      if (text === lastTextRef.current) {
        return;
      }

      const isFirstRead = lastTextRef.current === null;
      lastTextRef.current = text;
      setSummary(summarizeClipboard(text));

      // The startup read only records current state; it is not a copy event.
      if (!isFirstRead) {
        setChangeCount((count) => count + 1);
        playPling();
      }
    };

    void check();
    const intervalId = window.setInterval(() => void check(), POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const label = readError
    ? "Unavailable"
    : summary
      ? describe(summary)
      : "—";
  const tooltip = readError
    ? `Clipboard read failed: ${readError}`
    : summary
      ? `${clipboardKindLabel[summary.kind]}, ${formatByteSize(summary.bytes)}, ` +
        `${summary.lines} line(s), copied ${new Date(summary.copiedAt).toLocaleTimeString()}`
      : "Clipboard not read yet";

  return (
    <span className="workspace-shell__clipboard" title={tooltip}>
      <span className="workspace-shell__clipboard-label">Clipboard</span>
      <strong
        key={changeCount}
        className={
          changeCount > 0
            ? "workspace-shell__clipboard-value workspace-shell__clipboard-value--flash"
            : "workspace-shell__clipboard-value"
        }
      >
        {label}
      </strong>
    </span>
  );
}
