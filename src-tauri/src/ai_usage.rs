//! Claude-förbrukning för AI-förbrukningspanelen.
//!
//! Tokenmängderna summeras av skriptet `ai-usage-tokens` ur Claude Codes
//! transkript. Kvotläget (procent använt och återställningstid) finns bara i en
//! Claude Code-session, så det läses ur filen som ai-usage-modulen skriver.
//! Saknas den filen visar panelen tokens och säger det.

use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const HOUR_MS: i64 = 3_600_000;
const FIVE_HOURS_MS: i64 = 5 * HOUR_MS;
const SEVEN_DAYS_MS: i64 = 7 * 24 * HOUR_MS;

#[tauri::command]
pub async fn ai_usage_snapshot() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(snapshot_blocking)
        .await
        .map_err(|error| error.to_string())?
}

fn snapshot_blocking() -> Result<Value, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME är inte satt".to_string())?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as i64;
    let five_hour_start = now - FIVE_HOURS_MS;
    let seven_day_start = now - SEVEN_DAYS_MS;

    let output = Command::new(home.join(".local/bin/ai-usage-tokens"))
        .args([five_hour_start.to_string(), seven_day_start.to_string()])
        .output()
        .map_err(|error| format!("ai-usage-tokens kunde inte startas: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let tokens: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("ai-usage-tokens gav ogiltig JSON: {error}"))?;

    // Kvotfilen skrivs av ai-usage-modulen i Claude Code. Den är valfri.
    let limits = fs::read(home.join(".local/state/ai-usage/latest.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());

    Ok(json!({
        "now": now,
        "fiveHourStart": five_hour_start,
        "sevenDayStart": seven_day_start,
        "tokens": tokens,
        "limits": limits,
    }))
}
