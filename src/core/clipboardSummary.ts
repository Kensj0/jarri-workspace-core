// Deterministic clipboard summary for the shell header.
// Follows ClipboardBytes' rule: only classify when structurally certain,
// otherwise fall back to plain text.

export type ClipboardKind = "empty" | "text" | "json" | "url" | "claude";

export type ClipboardSummary = {
  kind: ClipboardKind;
  bytes: number;
  lines: number;
  copiedAt: number;
};

// First line written by claude-handoff-render for a Claude Code session.
const CLAUDE_SESSION_MARKER = "===== CLAUDE CODE SESSION =====";
const URL_PATTERN = /^https?:\/\/\S+$/i;

export function classifyClipboardText(text: string): ClipboardKind {
  if (text.length === 0) {
    return "empty";
  }

  if (text.startsWith(CLAUDE_SESSION_MARKER)) {
    return "claude";
  }

  const trimmed = text.trim();

  if (URL_PATTERN.test(trimmed)) {
    return "url";
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // Not valid JSON; fall through to plain text.
    }
  }

  return "text";
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} kB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function summarizeClipboard(
  text: string,
  copiedAt = Date.now(),
): ClipboardSummary {
  return {
    kind: classifyClipboardText(text),
    bytes: new TextEncoder().encode(text).length,
    lines: text.length === 0 ? 0 : text.split("\n").length,
    copiedAt,
  };
}

export const clipboardKindLabel: Record<ClipboardKind, string> = {
  empty: "Empty",
  text: "Text",
  json: "JSON",
  url: "URL",
  claude: "Claude session",
};
