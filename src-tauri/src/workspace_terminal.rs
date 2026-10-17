use portable_pty::{
    native_pty_system, CommandBuilder, MasterPty, PtySize,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Emitter, State};

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

const OUTPUT_EVENT: &str = "jarri://terminal-output";
const EXIT_EVENT: &str = "jarri://terminal-exit";

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

#[derive(Serialize, Clone)]
struct TerminalOutput {
    session_id: String,
    data: Vec<u8>,
}

#[derive(Serialize, Clone)]
struct TerminalExit {
    session_id: String,
}

#[tauri::command]
pub fn terminal_start(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    if !(2..=500).contains(&cols) || !(1..=250).contains(&rows) {
        return Err("Invalid terminal dimensions".into());
    }

    let pty = native_pty_system();

    let pair = pty
        .openpty(PtySize {
            cols,
            rows,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new("/bin/bash");
    cmd.arg("-i");
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;

    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| e.to_string())?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| e.to_string())?;

    let session_id = format!(
        "terminal-{}",
        NEXT_SESSION.fetch_add(1, Ordering::Relaxed)
    );

    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "Terminal registry poisoned")?;

        sessions.insert(
            session_id.clone(),
            TerminalSession {
                master: pair.master,
                writer,
                child,
            },
        );
    }

    let output_app = app.clone();
    let output_id = session_id.clone();

    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let result = output_app.emit(
                        OUTPUT_EVENT,
                        TerminalOutput {
                            session_id: output_id.clone(),
                            data: buffer[..count].to_vec(),
                        },
                    );

                    if result.is_err() {
                        break;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {
                    continue;
                }
                Err(_) => break,
            }
        }

        let _ = output_app.emit(
            EXIT_EVENT,
            TerminalExit {
                session_id: output_id,
            },
        );
    });

    Ok(session_id)
}

#[tauri::command]
pub fn terminal_write(
    state: State<'_, TerminalState>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    if data.len() > 65536 {
        return Err("Terminal input exceeds 64 KiB".into());
    }

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal registry poisoned")?;

    let session = sessions
        .get_mut(&session_id)
        .ok_or("Terminal session not found")?;

    session.writer.write_all(&data).map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, TerminalState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    if !(2..=500).contains(&cols) || !(1..=250).contains(&rows) {
        return Err("Invalid terminal dimensions".into());
    }

    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal registry poisoned")?;

    let session = sessions
        .get(&session_id)
        .ok_or("Terminal session not found")?;

    session
        .master
        .resize(PtySize {
            cols,
            rows,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_stop(
    state: State<'_, TerminalState>,
    session_id: String,
) -> Result<(), String> {
    let mut session = state
        .sessions
        .lock()
        .map_err(|_| "Terminal registry poisoned")?
        .remove(&session_id)
        .ok_or("Terminal session not found")?;

    let _ = session.child.kill();
    let _ = session.child.wait();

    Ok(())
}

impl Drop for TerminalState {
    fn drop(&mut self) {
        if let Ok(sessions) = self.sessions.get_mut() {
            for (_, session) in sessions.iter_mut() {
                let _ = session.child.kill();
                let _ = session.child.wait();
            }
            sessions.clear();
        }
    }
}
