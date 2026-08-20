#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rfd::FileDialog;
use std::fs;

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
            &["txt", "md", "markdown", "html", "htm", "json", "xml"],
        )
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_save() -> Option<String> {
    FileDialog::new()
        .add_filter(
            "支持的文件",
            &["txt", "md", "markdown", "html", "htm", "json", "xml"],
        )
        .save_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
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
            write_file,
            open_directory,
            list_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
