import {
  classifyClipboardText,
  formatByteSize,
  summarizeClipboard,
} from "./clipboardSummary";

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

assertEqual(classifyClipboardText(""), "empty", "empty text");
assertEqual(classifyClipboardText("hello"), "text", "plain text");
assertEqual(classifyClipboardText('{"a": 1}'), "json", "json object");
assertEqual(classifyClipboardText("[1, 2]\n"), "json", "json array with trailing newline");
assertEqual(classifyClipboardText("{not json"), "text", "broken json falls back to text");
assertEqual(classifyClipboardText("https://example.com/a?b=c"), "url", "url");
assertEqual(classifyClipboardText("see https://example.com"), "text", "url inside prose is text");
assertEqual(
  classifyClipboardText("===== CLAUDE CODE SESSION =====\n\nUSER: hi"),
  "claude",
  "claude handoff marker",
);

const summary = summarizeClipboard("a\nb\nc", 1000);
assertEqual(summary.lines, 3, "line count");
assertEqual(summary.bytes, 5, "byte count");
assertEqual(summary.copiedAt, 1000, "copiedAt is kept");
assertEqual(summarizeClipboard("").lines, 0, "empty has zero lines");

assertEqual(formatByteSize(512), "512 B", "bytes");
assertEqual(formatByteSize(2048), "2.0 kB", "kilobytes");
assertEqual(formatByteSize(5 * 1024 * 1024), "5.0 MB", "megabytes");
