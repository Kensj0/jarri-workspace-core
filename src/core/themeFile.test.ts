import {
  createThemeFile,
  parseThemeFile,
  serializeThemeFile,
  themeFileNameFor,
  themePatch,
} from "./themeFile";

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

const theme = createThemeFile("Dashboard Night", {
  themePreset: "neutral",
  themeMode: "dark",
  panelRadius: 16,
  colorOverrides: { page: "#060607", panel: "#161618" },
});

const roundTrip = parseThemeFile(serializeThemeFile(theme));
assertEqual(roundTrip.ok, true, "serialized theme parses");
if (roundTrip.ok) {
  assertEqual(roundTrip.theme.name, "Dashboard Night", "name survives round trip");
  assertEqual(roundTrip.theme.panelRadius, 16, "radius survives round trip");
  assertEqual(roundTrip.theme.colorOverrides.panel, "#161618", "override survives round trip");
}

assertEqual(
  themeFileNameFor("Dashboard Night — UX Planet!"),
  "dashboard-night-ux-planet.jarri-theme.json",
  "file name is a slug",
);

assertEqual(
  themeFileNameFor("   "),
  "theme.jarri-theme.json",
  "empty name falls back",
);

const clamped = parseThemeFile(
  JSON.stringify({ ...theme, panelRadius: 99 }),
);
assertEqual(clamped.ok && clamped.theme.panelRadius, 24, "radius is clamped to 24");

const badColour = parseThemeFile(
  JSON.stringify({ ...theme, colorOverrides: { page: "red" } }),
);
assertEqual(badColour.ok, false, "non-hex colour is rejected");

const wrongFormat = parseThemeFile(JSON.stringify({ format: "other", version: 1 }));
assertEqual(wrongFormat.ok, false, "other formats are rejected");

const notJson = parseThemeFile("{ nope");
assertEqual(notJson.ok, false, "invalid JSON is rejected");

const patch = themePatch(theme);
assertEqual(patch.themePreset, "neutral", "patch carries base preset");
assertEqual(patch.panelRadius, 16, "patch carries radius");
assertEqual(patch.themeMode, "dark", "patch carries mode");
