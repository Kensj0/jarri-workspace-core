export type HistorySession = {
  id: string;
  title: string;
  cwd: string | null;
  messages: number;
  modified: number;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function matchesQuery(session: HistorySession, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase("sv-SE");
  if (needle === "") return true;
  return [session.title, session.cwd ?? ""].some((field) =>
    field.toLocaleLowerCase("sv-SE").includes(needle),
  );
}

// The panel runs in Workspace, which does not know the home directory, so the
// first /home/<user> segment is shortened to ~.
export function shortPath(cwd: string | null): string {
  if (cwd === null) return "okänd mapp";
  return cwd.replace(/^\/home\/[^/]+/, "~");
}

export function relativeAge(modified: number, now: number): string {
  const elapsed = now - modified;
  if (elapsed < MINUTE) return "nu";
  if (elapsed < HOUR) return `för ${Math.floor(elapsed / MINUTE)} min sedan`;
  if (elapsed < DAY) return `för ${Math.floor(elapsed / HOUR)} h sedan`;
  if (elapsed < 7 * DAY) return `för ${Math.floor(elapsed / DAY)} d sedan`;
  return new Date(modified).toLocaleDateString("sv-SE");
}
