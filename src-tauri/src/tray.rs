use crate::{add_log, start_proxies_for_all, stop_all_proxies, AppState};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

/// Generate a 32x32 tray icon: simplified hexagon + center dot,
/// echoing the main app icon (hexagonal core motif) but stripped down
/// for clarity at small sizes.
fn generate_icon_bytes() -> Vec<u8> {
    use image::{Rgba, RgbaImage};
    use std::f64::consts::{FRAC_PI_2, PI};

    const SIZE: u32 = 32;
    const CX: f64 = 16.0;
    const CY: f64 = 16.0;
    const HEX_R: f64 = 12.0;   // hexagon circumscribed radius
    const DOT_R: f64 = 3.0;    // center dot radius
    const STROKE: f64 = 1.4;   // hexagon edge half-width

    let mut img = RgbaImage::new(SIZE, SIZE);

    // Hexagon vertices (point-up).
    let mut pts = [(0.0_f64, 0.0_f64); 6];
    for i in 0..6 {
        let a = -FRAC_PI_2 + (i as f64) * PI / 3.0;
        pts[i] = (CX + HEX_R * a.cos(), CY + HEX_R * a.sin());
    }

    // Distance from point P to segment AB.
    fn dist_to_segment(px: f64, py: f64, ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
        let dx = bx - ax;
        let dy = by - ay;
        let len2 = dx * dx + dy * dy;
        if len2 < 1e-9 {
            return ((px - ax).powi(2) + (py - ay).powi(2)).sqrt();
        }
        let t = (((px - ax) * dx + (py - ay) * dy) / len2).clamp(0.0, 1.0);
        let qx = ax + t * dx;
        let qy = ay + t * dy;
        ((px - qx).powi(2) + (py - qy).powi(2)).sqrt()
    }

    for y in 0..SIZE {
        for x in 0..SIZE {
            let px = x as f64 + 0.5;
            let py = y as f64 + 0.5;
            let dist = ((px - CX).powi(2) + (py - CY).powi(2)).sqrt();

            // Center filled dot (with 1px AA).
            let dot_alpha = if dist <= DOT_R - 0.5 {
                255.0
            } else if dist <= DOT_R + 0.5 {
                ((DOT_R + 0.5 - dist) * 255.0).clamp(0.0, 255.0)
            } else {
                0.0
            };

            // Closest distance to any hexagon edge.
            let mut min_edge = f64::INFINITY;
            for i in 0..6 {
                let (ax, ay) = pts[i];
                let (bx, by) = pts[(i + 1) % 6];
                let d = dist_to_segment(px, py, ax, ay, bx, by);
                if d < min_edge {
                    min_edge = d;
                }
            }
            let edge_alpha = if min_edge <= STROKE - 0.5 {
                255.0
            } else if min_edge <= STROKE + 0.5 {
                ((STROKE + 0.5 - min_edge) * 255.0).clamp(0.0, 255.0)
            } else {
                0.0
            };

            let alpha = dot_alpha.max(edge_alpha) as u8;
            if alpha > 0 {
                img.put_pixel(x, y, Rgba([0x21, 0x96, 0xF3, alpha]));
            }
        }
    }

    let mut buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png)
        .expect("Failed to encode icon");
    buf.into_inner()
}

pub fn setup_tray<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    let icon_bytes = generate_icon_bytes();
    let icon = tauri::image::Image::from_bytes(&icon_bytes)?;

    let toggle_item = MenuItemBuilder::with_id("toggle", "启动代理").build(app)?;
    let show_item = MenuItemBuilder::with_id("show", "显示窗口").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&toggle_item)
        .item(&show_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Claude Gateway Proxy")
        .menu(&menu)
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                "toggle" => {
                    let state = app.state::<AppState>();
                    let any_running = state.proxies.lock().values().any(|s| s.is_running());

                    if any_running {
                        stop_all_proxies(&state.proxies);
                        add_log(&state.logs, "⏹️ 所有代理服务已停止");
                    } else {
                        let cfg = state.config.get();
                        start_proxies_for_all(&state.proxies, &cfg, &state.logs, &state.log_level);
                        add_log(&state.logs, "🚀 所有分组代理已启动");
                    }
                }
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    } else {
                        // Window was closed — recreate it
                        if let Ok(window) = tauri::WebviewWindowBuilder::new(
                            app,
                            "main",
                            tauri::WebviewUrl::App("index.html".into()),
                        )
                        .title("Claude Gateway Proxy")
                        .inner_size(960.0, 720.0)
                        .min_inner_size(800.0, 600.0)
                        .center()
                        .build()
                        {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
                "quit" => {
                    stop_all_proxies(&app.state::<AppState>().proxies);
                    std::process::exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
