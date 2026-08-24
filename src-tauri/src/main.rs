#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rfd::FileDialog;
use std::fs;
use std::sync::Mutex;
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
            get_launch_path
        ])
        .manage(Mutex::new(None::<String>))
        .setup(|app| {
            // 通过文件关联（右键"打开方式"）启动时，Windows 会把文件路径作为命令行参数传入。
            // 此时前端尚未加载、无法监听事件，因此先把路径存入状态，待前端就绪后再查询。
            let state = app.state::<Mutex<Option<String>>>();
            let mut pending = state.lock().unwrap();
            for arg in std::env::args().skip(1) {
                if arg.starts_with("--") {
                    continue;
                }
                if std::path::Path::new(&arg).is_file() {
                    *pending = Some(arg);
                    break;
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
