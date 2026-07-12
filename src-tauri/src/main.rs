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

/// Read lines from a stream and hand each to `sink` — WITH its newline restored, because
/// `next_line` strips it and the frontend splitter (device.ts, `lines`) needs one to know a
/// sentence is complete. Miss this and sentences concatenate forever in the frontend's
/// buffer: the link is live, the Rust is reading, and every box on the screen stays blank.
///
/// Returns `Some(error)` on a broken link, `None` on a clean end of stream — the instrument
/// was unplugged, or Condor was closed. That is not an error, but it must be SAID; do not
/// pretend the last position is still current.
async fn pump_lines<R>(reader: R, mut sink: impl FnMut(String)) -> Option<String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut lines = BufReader::new(reader).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => sink(format!("{line}\n")),
            Ok(None) => return None,
            Err(e) => return Some(e.to_string()),
        }
    }
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
        let detail = pump_lines(stream, |line| emit(&app, &line)).await;
        emit_state(&app, "closed", detail);
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

#[cfg(test)]
mod tests {
    use super::pump_lines;
    use tokio::io::AsyncWriteExt;

    /// The regression that blanked the whole screen. `next_line` strips the newline; the
    /// frontend splitter requires one to know a sentence is complete. If a payload ever goes
    /// out bare again, sentences concatenate forever in the frontend buffer and nothing on
    /// the screen updates — with the link showing `live` the whole time.
    #[tokio::test]
    async fn every_line_goes_out_newline_terminated() {
        let input: &[u8] = b"$GPGGA,120001.00,4700.0000,N*7A\r\n$LXWP0,Y,110.0,1.5*32\n";
        let mut out = Vec::new();
        let end = pump_lines(input, |s| out.push(s)).await;
        assert_eq!(out, vec!["$GPGGA,120001.00,4700.0000,N*7A\n", "$LXWP0,Y,110.0,1.5*32\n"]);
        assert_eq!(end, None); // a clean end of stream is not an error
    }

    /// TCP does not respect sentence boundaries: one packet may hold half a sentence. The
    /// pump must reassemble it — one sentence out, not two fragments.
    #[tokio::test]
    async fn a_sentence_split_across_packets_is_one_line() {
        let (mut tx, rx) = tokio::io::duplex(64);
        tokio::spawn(async move {
            tx.write_all(b"$GPRMC,120001.00,A,47").await.unwrap();
            tx.write_all(b"00.0000,N*55\r\n").await.unwrap();
        });
        let mut out = Vec::new();
        let end = pump_lines(rx, |s| out.push(s)).await;
        assert_eq!(out, vec!["$GPRMC,120001.00,A,4700.0000,N*55\n"]);
        assert_eq!(end, None);
    }
}
