import { useEffect, useState } from "react";
import type { PanelBodyProps } from "../../../core/types";

const STORE_PORT = 8785;

type AppEntry = {
  id: string;
  title: string;
  ui?: string;
};

// Shows the page of one app in a frame. The app is chosen by id, and its
// address comes from apps.json through the module store service.
export function AppViewPanel({ panel }: PanelBodyProps) {
  const appId = (panel.panelState as { appId?: string } | undefined)?.appId;
  const [app, setApp] = useState<AppEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appId) return;
    let cancelled = false;
    setApp(null);
    setError(null);
    fetch(`http://127.0.0.1:${STORE_PORT}/apps`, { signal: AbortSignal.timeout(3000) })
      .then((response) => response.json() as Promise<{ apps: AppEntry[] }>)
      .then((body) => {
        if (cancelled) return;
        const found = body.apps.find((entry) => entry.id === appId);
        if (!found?.ui) {
          setError(`"${appId}" has no page to show.`);
        } else {
          setApp(found);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not read the app list. Is the module store service running?");
      });
    return () => {
      cancelled = true;
    };
  }, [appId]);

  if (!appId) {
    return <p style={{ padding: 12 }}>Open an app from Modules.</p>;
  }
  if (error) {
    return <p style={{ padding: 12 }}>{error}</p>;
  }
  if (!app) {
    return <p style={{ padding: 12 }}>Loading…</p>;
  }
  return (
    <iframe
      title={app.title}
      src={app.ui}
      allow="microphone"
      style={{ width: "100%", height: "100%", border: 0 }}
    />
  );
}
