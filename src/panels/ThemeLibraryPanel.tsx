import { useEffect, useState } from "react";
import {
  createThemeFile,
  themePatch,
  type WorkspaceThemeFile,
  type WorkspaceThemePreset,
} from "../core/themeFile";
import {
  deleteThemeFromLibrary,
  listThemeLibrary,
  saveThemeToLibrary,
  type ThemeLibrarySnapshot,
} from "../core/themeLibrary";
import type { PanelBodyProps } from "../core/types";

const PRESETS: Array<{ id: WorkspaceThemePreset; label: string }> = [
  { id: "neutral", label: "Neutral" },
  { id: "graphite", label: "Graphite" },
  { id: "contrast", label: "Contrast" },
  { id: "blueprint", label: "Blueprint" },
  { id: "pink-sparkle", label: "Pink Sparkle" },
  { id: "chronogit", label: "ChronoGit" },
];

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ThemeLibraryPanel({ preferences, updatePreferences }: PanelBodyProps) {
  const [snapshot, setSnapshot] = useState<ThemeLibrarySnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setSnapshot(await listThemeLibrary());
      setLoadError(null);
    } catch (error) {
      setLoadError(errorText(error));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function applyTheme(theme: WorkspaceThemeFile) {
    updatePreferences(themePatch(theme));
    setStatus(`Applied “${theme.name}”.`);
  }

  function applyPreset(preset: WorkspaceThemePreset) {
    updatePreferences({ themePreset: preset, colorOverrides: {} });
    setStatus(`Applied preset ${preset}.`);
  }

  async function saveCurrent() {
    const trimmed = name.trim();
    if (!trimmed) {
      setStatus("Give the theme a name first.");
      return;
    }
    setBusy(true);
    try {
      const fileName = await saveThemeToLibrary(createThemeFile(trimmed, preferences));
      setName("");
      setStatus(`Saved ${fileName}.`);
      await refresh();
    } catch (error) {
      setStatus(`Could not save: ${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeTheme(fileName: string) {
    if (pendingDelete !== fileName) {
      setPendingDelete(fileName);
      return;
    }
    setPendingDelete(null);
    try {
      await deleteThemeFromLibrary(fileName);
      setStatus(`Deleted ${fileName}.`);
      await refresh();
    } catch (error) {
      setStatus(`Could not delete: ${errorText(error)}`);
    }
  }

  const overrideCount = Object.keys(preferences.colorOverrides).length;

  return (
    <div className="panel-body theme-library-panel">
      <section className="settings-panel__section">
        <h3>Current appearance</h3>
        <p className="theme-library-panel__summary">
          {PRESETS.find((p) => p.id === preferences.themePreset)?.label ?? preferences.themePreset}
          {" · "}
          {preferences.themeMode}
          {" · corners "}
          {preferences.panelRadius}px
          {" · "}
          {overrideCount} colour override{overrideCount === 1 ? "" : "s"}
        </p>
        <div className="theme-library-panel__save">
          <input
            type="text"
            value={name}
            maxLength={60}
            placeholder="Name this theme"
            aria-label="Theme name"
            onChange={(event) => setName(event.target.value)}
          />
          <button type="button" disabled={busy} onClick={() => void saveCurrent()}>
            Save as theme file
          </button>
        </div>
      </section>

      <section className="settings-panel__section">
        <h3>Presets</h3>
        <div className="theme-library-panel__chips">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={preferences.themePreset === preset.id ? "is-active" : ""}
              onClick={() => applyPreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-panel__section">
        <h3>Theme files</h3>
        {loadError ? (
          <p className="theme-library-panel__error">
            Theme files are only available in the desktop app. ({loadError})
          </p>
        ) : null}
        {snapshot ? (
          <p className="theme-library-panel__folder">{snapshot.directory}</p>
        ) : null}
        {snapshot && snapshot.entries.length === 0 ? (
          <p className="theme-library-panel__empty">No theme files yet.</p>
        ) : null}
        <ul className="theme-library-panel__list">
          {snapshot?.entries.map((entry) => (
            <li key={entry.fileName} className="theme-library-panel__row">
              {entry.theme ? (
                <>
                  <div className="theme-library-panel__meta">
                    <strong>{entry.theme.name}</strong>
                    <small>
                      {entry.theme.basePreset} · {entry.theme.panelRadius}px ·{" "}
                      {entry.fileName}
                    </small>
                  </div>
                  <button type="button" onClick={() => applyTheme(entry.theme!)}>
                    Apply
                  </button>
                  <button type="button" onClick={() => void removeTheme(entry.fileName)}>
                    {pendingDelete === entry.fileName ? "Confirm delete" : "Delete"}
                  </button>
                </>
              ) : (
                <div className="theme-library-panel__meta theme-library-panel__meta--invalid">
                  <strong>{entry.fileName}</strong>
                  <small>{entry.error}</small>
                </div>
              )}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => void refresh()}>
          Reload folder
        </button>
        {status ? <p className="theme-library-panel__status">{status}</p> : null}
      </section>
    </div>
  );
}
