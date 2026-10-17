import { useCallback, useEffect, useState } from "react";

type Battery = { charging: boolean; level: number };

type PhoneDevice = {
  id: string;
  name: string;
  kind: string;
  connected: boolean;
  paired: boolean;
  battery: Battery | null;
};

type PhoneStatus = {
  available: boolean;
  devices: PhoneDevice[];
};

type PhoneCommand =
  | { kind: "ping"; message: string | null }
  | { kind: "ring" }
  | { kind: "clipboardPush" }
  | { kind: "clipboardPull" }
  | { kind: "shareText"; text: string }
  | { kind: "shareUri"; uri: string }
  | { kind: "shareFile" }
  | { kind: "sms" };

// The phone status and commands come from jarri-apps/phone-service. This panel only draws them.
const SERVICE_URL = "http://127.0.0.1:8782";
const REFRESH_MS = 5_000;

export function PhonePanel() {
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [uri, setUri] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${SERVICE_URL}/status`);
      if (!response.ok) {
        throw new Error(`service answered ${response.status}`);
      }
      setStatus((await response.json()) as PhoneStatus);
    } catch (error) {
      setStatus({ available: false, devices: [] });
      setMessage(String(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const send = async (deviceId: string, command: PhoneCommand, done: string) => {
    try {
      const response = await fetch(`${SERVICE_URL}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, command }),
      });
      if (!response.ok) {
        throw new Error((await response.json()).error ?? `service answered ${response.status}`);
      }
      setMessage(done);
    } catch (error) {
      setMessage(`Failed: ${String(error)}`);
    }
  };

  if (!status) {
    return <div className="phone-panel__empty">Loading…</div>;
  }

  if (!status.available) {
    return (
      <div className="phone-panel__empty">
        Zorin Connect is not running. Start it, then this panel updates by itself.
      </div>
    );
  }

  // Zorin only registers plugin actions (ping, ring, ...) for paired devices,
  // so an unpaired device must not enable the buttons.
  const canSend = (device: { connected: boolean; paired: boolean }) =>
    device.connected && device.paired;

  // Only phones are shown. Other Zorin devices on the network (desktops) are left out.
  const phones = status.devices.filter((device) => device.kind === "phone");

  if (phones.length === 0) {
    return <div className="phone-panel__empty">No phone paired in Zorin Connect.</div>;
  }

  return (
    <div className="phone-panel">
      {phones.map((device) => (
        <section key={device.id} className="phone-panel__device">
          <header>
            <strong>{device.name}</strong>
            <span className="phone-panel__state">
              {device.connected ? (device.paired ? "Connected" : "Connected, not paired") : "Not connected"}
              {device.battery
                ? ` · ${device.battery.level}%${device.battery.charging ? " (charging)" : ""}`
                : ""}
            </span>
          </header>

          <div className="phone-panel__buttons">
            <button type="button" disabled={!canSend(device)}
              onClick={() => void send(device.id, { kind: "ping", message: null }, "Ping sent")}>
              Ping
            </button>
            <button type="button" disabled={!canSend(device)}
              onClick={() => void send(device.id, { kind: "ring" }, "Phone is ringing")}>
              Ring phone
            </button>
            <button type="button" disabled={!canSend(device)}
              onClick={() => void send(device.id, { kind: "clipboardPush" }, "Desktop clipboard sent to phone")}>
              Send clipboard to phone
            </button>
            <button type="button" disabled={!canSend(device)}
              onClick={() => void send(device.id, { kind: "clipboardPull" }, "Phone clipboard requested")}>
              Get clipboard from phone
            </button>
            <button type="button" disabled={!canSend(device)}
              onClick={() => void send(device.id, { kind: "shareFile" }, "File picker opened")}>
              Send file
            </button>
            <button type="button" disabled={!canSend(device)}
              onClick={() => void send(device.id, { kind: "sms" }, "SMS opened")}>
              SMS
            </button>
          </div>

          <div className="phone-panel__row">
            <input value={text} placeholder="Text to send to phone"
              onChange={(event) => setText(event.target.value)} />
            <button type="button" disabled={!canSend(device) || !text.trim()}
              onClick={() => void send(device.id, { kind: "shareText", text }, "Text sent")}>
              Send
            </button>
          </div>

          <div className="phone-panel__row">
            <input value={uri} placeholder="Link to open on phone"
              onChange={(event) => setUri(event.target.value)} />
            <button type="button" disabled={!canSend(device) || !uri.trim()}
              onClick={() => void send(device.id, { kind: "shareUri", uri }, "Link sent")}>
              Open
            </button>
          </div>
        </section>
      ))}
      {message ? <p className="phone-panel__message">{message}</p> : null}
    </div>
  );
}
