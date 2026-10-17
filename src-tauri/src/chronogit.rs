//! Startar ChronoGit som egen process.
//!
//! ChronoGit är en separat Tauri-app med sin egen Git-backend, så Jarri visar
//! den inte i en panel. Panelen startar den i dev-läge från dess källkatalog.
//! Sökvägen kan ändras med miljövariabeln `CHRONOGIT_APP_DIR`.

use std::path::PathBuf;
use std::process::{Command, Stdio};

#[tauri::command]
pub fn chronogit_launch() -> Result<String, String> {
    let app_dir = match std::env::var_os("CHRONOGIT_APP_DIR") {
        Some(dir) => PathBuf::from(dir),
        None => std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "HOME är inte satt".to_string())?
            .join("projects/ChronoGit/chronogit-app"),
    };
    if !app_dir.join("package.json").is_file() {
        return Err(format!("ChronoGit hittades inte i {}", app_dir.display()));
    }

    Command::new("npm")
        .args(["run", "tauri", "dev"])
        .current_dir(&app_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("npm kunde inte startas: {error}"))?;

    Ok(app_dir.display().to_string())
}
