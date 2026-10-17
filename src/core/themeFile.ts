import { WORKSPACE_COLOR_TOKEN_KEYS } from "./colorTokens";
import {
  PANEL_RADIUS_MAX,
  PANEL_RADIUS_MIN,
  type WorkspaceColorTokens,
  type WorkspacePreferences,
} from "./types";

export const THEME_FILE_FORMAT = "jarri-workspace-theme";
export const THEME_FILE_VERSION = 1;
export const THEME_FILE_EXTENSION = ".jarri-theme.json";

export type WorkspaceThemePreset = WorkspacePreferences["themePreset"];
export type WorkspaceThemeMode = WorkspacePreferences["themeMode"];

export type WorkspaceThemeFile = {
  format: typeof THEME_FILE_FORMAT;
  version: typeof THEME_FILE_VERSION;
  name: string;
  basePreset: WorkspaceThemePreset;
  themeMode?: WorkspaceThemeMode;
  panelRadius: number;
  colorOverrides: Partial<WorkspaceColorTokens>;
};

export type WorkspaceThemePatch = Pick<
  WorkspacePreferences,
  "themePreset" | "colorOverrides" | "panelRadius"
> &
  Partial<Pick<WorkspacePreferences, "themeMode">>;

export type ThemeFileParseResult =
  | { ok: true; theme: WorkspaceThemeFile }
  | { ok: false; error: string };

const PRESET_IDS: readonly WorkspaceThemePreset[] = [
  "neutral",
  "graphite",
  "contrast",
  "blueprint",
  "pink-sparkle",
  "chronogit",
];

const THEME_MODES: readonly WorkspaceThemeMode[] = ["system", "light", "dark"];

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

const MAX_NAME_LENGTH = 60;

export function createThemeFile(
  name: string,
  preferences: Pick<WorkspacePreferences, "themePreset" | "themeMode" | "panelRadius" | "colorOverrides">,
): WorkspaceThemeFile {
  return {
    format: THEME_FILE_FORMAT,
    version: THEME_FILE_VERSION,
    name: name.trim().slice(0, MAX_NAME_LENGTH) || "Untitled theme",
    basePreset: preferences.themePreset,
    themeMode: preferences.themeMode,
    panelRadius: preferences.panelRadius,
    colorOverrides: { ...preferences.colorOverrides },
  };
}

export function serializeThemeFile(theme: WorkspaceThemeFile): string {
  return `${JSON.stringify(theme, null, 2)}\n`;
}

export function themeFileNameFor(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "theme"}${THEME_FILE_EXTENSION}`;
}

export function themePatch(theme: WorkspaceThemeFile): WorkspaceThemePatch {
  return {
    themePreset: theme.basePreset,
    colorOverrides: { ...theme.colorOverrides },
    panelRadius: theme.panelRadius,
    ...(theme.themeMode ? { themeMode: theme.themeMode } : {}),
  };
}

export function parseThemeFile(text: string): ThemeFileParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "The file is not valid JSON." };
  }
  if (!isRecord(raw)) return { ok: false, error: "The theme must be a JSON object." };
  if (raw.format !== THEME_FILE_FORMAT) {
    return { ok: false, error: `Not a ${THEME_FILE_FORMAT} file.` };
  }
  if (raw.version !== THEME_FILE_VERSION) {
    return { ok: false, error: `Unsupported theme version: ${String(raw.version)}.` };
  }

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `The name must be 1–${MAX_NAME_LENGTH} characters.` };
  }

  if (!PRESET_IDS.includes(raw.basePreset as WorkspaceThemePreset)) {
    return { ok: false, error: `Unknown base preset: ${String(raw.basePreset)}.` };
  }

  let themeMode: WorkspaceThemeMode | undefined;
  if (raw.themeMode !== undefined) {
    if (!THEME_MODES.includes(raw.themeMode as WorkspaceThemeMode)) {
      return { ok: false, error: `Unknown theme mode: ${String(raw.themeMode)}.` };
    }
    themeMode = raw.themeMode as WorkspaceThemeMode;
  }

  if (typeof raw.panelRadius !== "number" || !Number.isFinite(raw.panelRadius)) {
    return { ok: false, error: "panelRadius must be a number." };
  }
  const panelRadius = Math.min(
    PANEL_RADIUS_MAX,
    Math.max(PANEL_RADIUS_MIN, Math.round(raw.panelRadius)),
  );

  const colorOverrides: Partial<WorkspaceColorTokens> = {};
  const overridesSource = raw.colorOverrides ?? {};
  if (!isRecord(overridesSource)) {
    return { ok: false, error: "colorOverrides must be an object." };
  }
  for (const key of WORKSPACE_COLOR_TOKEN_KEYS) {
    const value = overridesSource[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !HEX_COLOUR.test(value)) {
      return { ok: false, error: `colorOverrides.${key} must be a #rrggbb colour.` };
    }
    colorOverrides[key] = value.toLowerCase();
  }

  return {
    ok: true,
    theme: {
      format: THEME_FILE_FORMAT,
      version: THEME_FILE_VERSION,
      name,
      basePreset: raw.basePreset as WorkspaceThemePreset,
      ...(themeMode ? { themeMode } : {}),
      panelRadius,
      colorOverrides,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
