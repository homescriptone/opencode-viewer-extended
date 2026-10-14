use std::net::TcpListener;

use tauri::{Manager, Url};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|listener| listener.local_addr().ok())
        .map(|addr| addr.port())
        .unwrap_or(3456)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let port = free_port();
            let handle = app.handle().clone();

            let sidecar = app
                .shell()
                .sidecar("ocv-server")
                .expect("sidecar ocv-server not found")
                .env("OCV_PORT", port.to_string())
                .env("OCV_WRITE", "1");

            let (mut rx, _child) = sidecar.spawn().expect("failed to spawn server sidecar");

            tauri::async_runtime::spawn(async move {
                let target = format!("http://localhost:{port}");
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            let line = String::from_utf8_lossy(&bytes);
                            if line.contains("OpenCode Viewer running") {
                                if let Some(window) = handle.get_webview_window("main") {
                                    if let Ok(url) = Url::parse(&target) {
                                        let _ = window.navigate(url);
                                    }
                                }
                            }
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("server sidecar terminated: {:?}", payload);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
