#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rfd::FileDialog;
use std::fs;
use std::sync::Mutex;
use tauri::Emitter;
use tauri::Manager;
use base64::Engine;

#[derive(serde::Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[tauri::command]
fn pick_open() -> Option<String> {
    FileDialog::new()
        .add_filter(
            "支持的文件",
            &["txt", "md", "markdown", "html", "htm", "json", "xml", "yaml", "yml"],
        )
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_save() -> Option<String> {
    FileDialog::new()
        .add_filter(
            "支持的文件",
            &["txt", "md", "markdown", "html", "htm", "json", "xml", "yaml", "yml"],
        )
        .save_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// 读取文件并以 base64 data URI 形式返回，便于前端把图片内联到预览中，
/// 避免依赖 asset 协议（dev 模式下 asset 服务器可能未监听导致加载失败）。
#[tauri::command]
fn read_file_base64(path: String) -> Option<String> {
    let bytes = fs::read(&path).ok()?;
    let lower = path.to_lowercase();
    let mime = if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".bmp") {
        "image/bmp"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".ico") {
        "image/x-icon"
    } else {
        "application/octet-stream"
    };
    Some(format!(
        "data:{};base64,{}",
        mime,
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_file(dir: String, name: String) -> Result<String, String> {
    let full = std::path::Path::new(&dir).join(name);
    if full.exists() {
        return Err(format!("已存在：{}", full.display()));
    }
    if let Some(parent) = full.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::write(&full, b"").map_err(|e| e.to_string())?;
    Ok(full.to_string_lossy().to_string())
}

#[tauri::command]
fn create_dir(dir: String, name: String) -> Result<(), String> {
    let full = std::path::Path::new(&dir).join(name);
    if full.exists() {
        return Err(format!("已存在：{}", full.display()));
    }
    fs::create_dir_all(&full).map_err(|e| e.to_string())
}

/// 取回文件关联启动时传入的待打开路径，并清空（只取一次）
#[tauri::command]
fn get_launch_path(state: tauri::State<Mutex<Option<String>>>) -> Option<String> {
    state.lock().unwrap().take()
}

/// 用操作系统默认程序打开文件（不支持的文本格式如 xlsx、docx 等直接交给系统处理）
#[tauri::command]
fn open_in_system(path: String) -> Result<(), String> {
    use std::process::Command;
    let status = if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/c", "start", "", &path]).status()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(&path).status()
    } else {
        Command::new("xdg-open").arg(&path).status()
    };
    status.map(|s| s.success())
        .map_err(|e| e.to_string())
        .and_then(|ok| if ok { Ok(()) } else { Err("打开文件失败".to_string()) })
}

/// 选择目录，返回目录路径（取消则返回 None）
#[tauri::command]
fn open_directory() -> Option<String> {
    FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

/// 列出目录内容：目录在前、文件在后，均按名称排序
#[tauri::command]
fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let mut entries: Vec<FileEntry> = Vec::new();
    for e in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        let is_dir = p.is_dir();
        entries.push(FileEntry {
            name,
            path: p.to_string_lossy().to_string(),
            is_dir,
        });
    }
    entries.sort_by(|a, b| {
        (a.is_dir, a.name.to_lowercase()).cmp(&(b.is_dir, b.name.to_lowercase()))
    });
    Ok(entries)
}

/// 在新窗口中打开文件：复用应用自身的命令行参数处理逻辑（setup 中已支持文件路径参数），
/// 直接以当前可执行文件 + 文件路径作为参数再启动一个实例。
#[tauri::command]
fn open_in_new_window(path: String) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    std::process::Command::new(exe)
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            pick_open,
            pick_save,
            read_file,
            read_file_base64,
            write_file,
            open_in_system,
            open_directory,
            list_directory,
            get_launch_path,
            open_in_new_window,
            create_file,
            create_dir
        ])
        .manage(Mutex::new(None::<String>))
        .setup(|app| {
            // 通过文件关联（双击/右键"打开方式"）启动时，Windows 会把文件路径作为命令行参数传入
            // （可能是普通路径，也可能是 file:// 形式）。此时前端尚未加载、无法监听事件，
            // 因此先把路径存入状态，待前端就绪后再查询；若窗口已存在（已运行时再次双击）则直接 emit。
            let state = app.state::<Mutex<Option<String>>>();
            let mut pending = state.lock().unwrap();
            for arg in std::env::args().skip(1) {
                if let Some(p) = arg_to_path(&arg) {
                    *pending = Some(p.clone());
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.emit("open-path", p);
                    }
                    break;
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// 将命令行参数 / 字符串转换为本地文件路径（兼容 file:// 形式与可能的 URL 编码），
// 仅当该路径确实为已存在的文件时才返回 Some。
fn arg_to_path(arg: &str) -> Option<String> {
    if arg.starts_with("--") {
        return None;
    }
    let decoded = if arg.starts_with("file://") {
        match url::Url::parse(arg) {
            Ok(u) => u.to_file_path().ok()?.to_string_lossy().to_string(),
            Err(_) => return None,
        }
    } else {
        arg.to_string()
    };
    if std::path::Path::new(&decoded).is_file() {
        Some(decoded)
    } else {
        None
    }
}
