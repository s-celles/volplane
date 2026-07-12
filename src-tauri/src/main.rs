// ============ the shell: everything the web cannot do ============
// This is the ONLY place that knows about sockets, serial ports and Bluetooth. The flight
// computer upstairs consumes a stream of sentences and has no idea any of this exists — that
// is C5, and it is what keeps the shell replaceable.
//
// Today: TCP and UDP. That is not a small start — it is how CONDOR connects (TCP 4353), which
// makes it the whole test bench, and it is one of only two roads to an instrument on iOS.
// Serial and Bluetooth Classic come later, and only Bluetooth Classic on Android will need
// native code (Kotlin); everything here is Rust, on every platform.

use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::{TcpStream, UdpSocket};
use tokio::sync::Mutex;

/// One open link. Dropping the task closes it — a flight computer must be able to let go of a
/// dead instrument without restarting.
#[derive(Default)]
struct Links(Arc<Mutex<Vec<tokio::task::JoinHandle<()>>>>);

/// Every sentence is emitted as an event. The frontend turns the event stream into a
/// DeviceSource; nothing above this line knows it was a socket.
fn emit(app: &AppHandle, line: &str) {
    let _ = app.emit("nmea", line);
}

fn emit_state(app: &AppHandle, state: &str, detail: Option<String>) {
    let _ = app.emit("link", serde_json::json!({ "state": state, "detail": detail }));
}

/// Connect to Condor, or to any instrument speaking NMEA over TCP.
/// Condor's default is 127.0.0.1:4353 on the same PC, or the PC's LAN address from a tablet.
#[tauri::command]
async fn open_tcp(app: AppHandle, links: State<'_, Links>, host: String, port: u16) -> Result<(), String> {
    let stream = TcpStream::connect((host.as_str(), port))
        .await
        .map_err(|e| format!("{host}:{port}: {e}"))?;
    emit_state(&app, "live", None);

    let handle = tokio::spawn(async move {
        let mut lines = BufReader::new(stream).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => emit(&app, &line),
                // A clean end of stream is not an error. The instrument was unplugged, or
                // Condor was closed. Say so; do not pretend the last position is still current.
                Ok(None) => { emit_state(&app, "closed", None); break }
                Err(e) => { emit_state(&app, "closed", Some(e.to_string())); break }
            }
        }
    });
    links.0.lock().await.push(handle);
    Ok(())
}

/// Listen for NMEA broadcast over UDP. Several instruments do this over WiFi, and it is the
/// only link — with BLE — that iOS permits (spec §3bis).
#[tauri::command]
async fn open_udp(app: AppHandle, links: State<'_, Links>, port: u16) -> Result<(), String> {
    let sock = UdpSocket::bind(("0.0.0.0", port)).await.map_err(|e| format!(":{port}: {e}"))?;
    emit_state(&app, "live", None);

    let handle = tokio::spawn(async move {
        let mut buf = vec![0u8; 2048];
        loop {
            match sock.recv(&mut buf).await {
                Ok(n) => {
                    // A datagram is NOT a sentence: it may hold several, or a partial one. The
                    // frontend re-splits on newlines (device.ts, `lines`) — one splitter, not two.
                    if let Ok(s) = std::str::from_utf8(&buf[..n]) { emit(&app, s) }
                }
                Err(e) => { emit_state(&app, "closed", Some(e.to_string())); break }
            }
        }
    });
    links.0.lock().await.push(handle);
    Ok(())
}

#[tauri::command]
async fn close_all(links: State<'_, Links>) -> Result<(), String> {
    for h in links.0.lock().await.drain(..) { h.abort() }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .manage(Links::default())
        .invoke_handler(tauri::generate_handler![open_tcp, open_udp, close_all])
        .run(tauri::generate_context!())
        .expect("volplane failed to start");
}
