import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function ChronoGitPanel() {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const launch = async () => {
    setBusy(true);
    try {
      const dir = await invoke<string>("chronogit_launch");
      setMessage(`Startar ChronoGit från ${dir}. Det kan ta en stund första gången.`);
    } catch (error) {
      setMessage(`Misslyckades: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chronogit-panel">
      <button type="button" onClick={() => void launch()} disabled={busy}>
        Starta ChronoGit
      </button>
      {message && <p className="chronogit-panel__message">{message}</p>}
    </div>
  );
}
