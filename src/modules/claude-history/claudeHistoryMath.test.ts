import { matchesQuery, relativeAge, shortPath, type HistorySession } from "./claudeHistoryMath";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function expectEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const session: HistorySession = {
  id: "abc",
  title: "Organize-knappen i Jarri workspace",
  cwd: "/home/sh0ken/projects/workspace-kenny",
  messages: 12,
  modified: 0,
};

// Tom sökning visar allt. Titel och mapp söks utan hänsyn till versaler.
expectEqual(matchesQuery(session, "   "), true, "empty query");
expectEqual(matchesQuery(session, "ORGANIZE"), true, "title, case-insensitive");
expectEqual(matchesQuery(session, "workspace-kenny"), true, "folder match");
expectEqual(matchesQuery(session, "phone"), false, "no match");
expectEqual(matchesQuery({ ...session, cwd: null }, "sh0ken"), false, "null folder");

expectEqual(shortPath("/home/sh0ken/projects/x"), "~/projects/x", "home shortened");
expectEqual(shortPath("/srv/data"), "/srv/data", "other path unchanged");
expectEqual(shortPath(null), "okänd mapp", "missing folder");

const NOW = 10 * DAY;
expectEqual(relativeAge(NOW - 10_000, NOW), "nu", "under a minute");
expectEqual(relativeAge(NOW - 5 * MINUTE, NOW), "för 5 min sedan", "minutes");
expectEqual(relativeAge(NOW - 3 * HOUR, NOW), "för 3 h sedan", "hours");
expectEqual(relativeAge(NOW - 2 * DAY, NOW), "för 2 d sedan", "days");
expectEqual(
  relativeAge(NOW - 30 * DAY, NOW),
  new Date(NOW - 30 * DAY).toLocaleDateString("sv-SE"),
  "older than a week",
);
