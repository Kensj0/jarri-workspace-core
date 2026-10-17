//! Zorin Connect integration over its session D-Bus service.
//!
//! Zorin Connect runs its own daemon (a GNOME Shell extension) that owns the
//! KDE Connect protocol, pairing, encryption and clipboard sync. Jarri does not
//! speak that protocol. It drives the service that is already running, so the
//! features Zorin provides stay available unchanged. Phone clipboard content
//! arrives in the desktop clipboard through Zorin itself.

use gio::glib::{Variant, VariantTy};
use gio::{prelude::*, BusType, Cancellable, DBusCallFlags};
use serde::{Deserialize, Serialize};

const SERVICE: &str = "org.gnome.Shell.Extensions.ZorinConnect";
const ROOT_PATH: &str = "/org/gnome/Shell/Extensions/ZorinConnect";
const DEVICE_IFACE: &str = "org.gnome.Shell.Extensions.ZorinConnect.Device";
const CALL_TIMEOUT_MS: i32 = 3000;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PhoneBattery {
    pub charging: bool,
    pub level: i32,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PhoneDevice {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub connected: bool,
    pub paired: bool,
    pub battery: Option<PhoneBattery>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PhoneStatus {
    pub available: bool,
    pub devices: Vec<PhoneDevice>,
}

/// The commands the UI may send. Each maps to one fixed Zorin action, so the
/// frontend cannot name arbitrary actions.
#[derive(Deserialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PhoneCommand {
    Ping { message: Option<String> },
    Ring,
    ClipboardPush,
    ClipboardPull,
    ShareText { text: String },
    ShareUri { uri: String },
    ShareFile,
    Sms,
}

/// Action name and GVariant `av` parameter text for a command.
fn action_for(command: &PhoneCommand) -> (&'static str, String) {
    match command {
        PhoneCommand::Ping { message } => match message.as_deref().map(str::trim) {
            Some(m) if !m.is_empty() => ("ping", format!("[<{}>]", gvariant_string(m))),
            // Zorin's ping action takes a string, so an empty message is sent as "".
            _ => ("ping", "[<''>]".to_string()),
        },
        PhoneCommand::Ring => ("ring", "[]".to_string()),
        PhoneCommand::ClipboardPush => ("clipboardPush", "[]".to_string()),
        PhoneCommand::ClipboardPull => ("clipboardPull", "[]".to_string()),
        PhoneCommand::ShareText { text } => ("shareText", format!("[<{}>]", gvariant_string(text))),
        PhoneCommand::ShareUri { uri } => ("shareUri", format!("[<{}>]", gvariant_string(uri))),
        PhoneCommand::ShareFile => ("share", "[]".to_string()),
        PhoneCommand::Sms => ("sms", "[]".to_string()),
    }
}

/// Quote text as a GVariant string literal.
fn gvariant_string(text: &str) -> String {
    let escaped = text.replace('\\', "\\\\").replace('\'', "\\'");
    format!("'{escaped}'")
}

fn session_call(
    path: &str,
    interface: &str,
    method: &str,
    params: Option<&Variant>,
    reply: &VariantTy,
) -> Result<Variant, String> {
    let conn = gio::bus_get_sync(BusType::Session, Cancellable::NONE).map_err(|e| e.to_string())?;
    conn.call_sync(
        Some(SERVICE),
        path,
        interface,
        method,
        params,
        Some(reply),
        DBusCallFlags::NONE,
        CALL_TIMEOUT_MS,
        Cancellable::NONE,
    )
    .map_err(|e| e.to_string())
}

/// Look up `key` in an `a{sv}` dictionary.
fn dict_lookup(dict: &Variant, key: &str) -> Option<Variant> {
    (0..dict.n_children()).find_map(|i| {
        let entry = dict.child_value(i);
        if entry.child_value(0).str()? == key {
            entry.child_value(1).as_variant()
        } else {
            None
        }
    })
}

fn battery_for(path: &str) -> Option<PhoneBattery> {
    // org.gtk.Actions.Describe("battery") -> (enabled, signature, [v]) where the
    // v holds (charging, icon, level, time).
    let reply = session_call(
        path,
        "org.gtk.Actions",
        "Describe",
        Some(&("battery",).to_variant()),
        VariantTy::new("((bgav))").ok()?,
    )
    .ok()?;
    let description = reply.child_value(0);
    let params = description.child_value(2);
    let first = params.child_value(0).as_variant()?;
    let (charging, _icon, level, _time) = first.get::<(bool, String, i32, i32)>()?;
    if level < 0 {
        return None;
    }
    Some(PhoneBattery { charging, level })
}

fn status_blocking() -> PhoneStatus {
    let managed = match session_call(
        ROOT_PATH,
        "org.freedesktop.DBus.ObjectManager",
        "GetManagedObjects",
        None,
        VariantTy::new("(a{oa{sa{sv}}})").expect("valid type"),
    ) {
        Ok(v) => v.child_value(0),
        Err(_) => return PhoneStatus { available: false, devices: Vec::new() },
    };

    let mut devices = Vec::new();
    for i in 0..managed.n_children() {
        let entry = managed.child_value(i);
        let Some(path) = entry.child_value(0).str().map(str::to_owned) else { continue };
        let interfaces = entry.child_value(1);
        for j in 0..interfaces.n_children() {
            let iface = interfaces.child_value(j);
            if iface.child_value(0).str() != Some(DEVICE_IFACE) {
                continue;
            }
            let props = iface.child_value(1);
            let read_str = |key: &str| {
                dict_lookup(&props, key).and_then(|v| v.str().map(str::to_owned)).unwrap_or_default()
            };
            let read_bool = |key: &str| dict_lookup(&props, key).and_then(|v| v.get::<bool>()).unwrap_or(false);
            let connected = read_bool("Connected");
            devices.push(PhoneDevice {
                id: path.rsplit('/').next().unwrap_or_default().to_string(),
                name: read_str("Name"),
                kind: read_str("Type"),
                connected,
                paired: read_bool("Paired"),
                battery: if connected { battery_for(&path) } else { None },
            });
        }
    }
    devices.sort_by(|a, b| a.name.cmp(&b.name));
    PhoneStatus { available: true, devices }
}

fn send_blocking(device_id: String, command: PhoneCommand) -> Result<(), String> {
    if device_id.is_empty() || !device_id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("invalid device id".into());
    }
    let (action, parameters) = action_for(&command);
    let path = format!("{ROOT_PATH}/Device/{device_id}");
    let params = Variant::parse(
        Some(VariantTy::new("(sava{sv})").map_err(|e| e.to_string())?),
        &format!("('{action}', {parameters}, {{}})"),
    )
    .map_err(|e| e.to_string())?;
    session_call(&path, "org.gtk.Actions", "Activate", Some(&params), VariantTy::new("()").expect("valid type"))
        .map(|_| ())
}

#[tauri::command]
pub async fn zorin_status() -> Result<PhoneStatus, String> {
    tauri::async_runtime::spawn_blocking(status_blocking)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn zorin_command(device_id: String, command: PhoneCommand) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || send_blocking(device_id, command))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_gvariant_strings() {
        assert_eq!(gvariant_string("it's \\ fine"), "'it\\'s \\\\ fine'");
    }

    #[test]
    fn maps_commands_to_fixed_actions() {
        assert_eq!(action_for(&PhoneCommand::Ring), ("ring", "[]".to_string()));
        assert_eq!(action_for(&PhoneCommand::ClipboardPush).0, "clipboardPush");
        assert_eq!(
            action_for(&PhoneCommand::ShareUri { uri: "https://a.b".into() }),
            ("shareUri", "[<'https://a.b'>]".to_string()),
        );
        assert_eq!(
            action_for(&PhoneCommand::Ping { message: Some("  ".into()) }),
            ("ping", "[<''>]".to_string()),
        );
    }

    #[test]
    fn activate_parameters_parse_as_gvariant() {
        let (action, params) = action_for(&PhoneCommand::ShareText { text: "it's ok".into() });
        let text = format!("('{action}', {params}, {{}})");
        assert!(Variant::parse(Some(VariantTy::new("(sava{sv})").unwrap()), &text).is_ok());
    }

    /// Needs a running Zorin Connect service on the session bus:
    /// cargo test zorin_status_live -- --ignored --nocapture
    #[test]
    #[ignore]
    fn zorin_status_live() {
        let status = status_blocking();
        println!("{status:?}");
        assert!(status.available);
    }
}
