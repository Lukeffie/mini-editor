#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rfd::FileDialog;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(serde::Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[tauri::command]
fn pick_open() -> Option<String> {
    FileDialog::new()
        .add_filter("文本文件", &["txt", "md", "markdown", "html", "htm"])
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_save() -> Option<String> {
    FileDialog::new()
        .add_filter("文本文件", &["txt", "md", "markdown", "html", "htm"])
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

/// 抓取网页 HTML（file:// 走本地读取，http(s) 走 ureq）。用于元素提取。
#[tauri::command]
fn fetch_html(url: String) -> Result<String, String> {
    if let Some(p) = url.strip_prefix("file://") {
        return fs::read_to_string(p).map_err(|e| e.to_string());
    }
    ureq::get(&url)
        .set("User-Agent", "Mozilla/5.0")
        .call()
        .map_err(|e| e.to_string())?
        .into_string()
        .map_err(|e| e.to_string())
}

/// 下载一个 URL 到指定目录，自动去重文件名，返回最终保存路径
#[tauri::command]
fn download_url(url: String, dir: String) -> Result<String, String> {
    let (reader, name): (Box<dyn Read>, String) = if let Some(p) = url.strip_prefix("file://") {
        let f = fs::File::open(p).map_err(|e| e.to_string())?;
        (Box::new(f), filename_from_url(&url))
    } else {
        let resp = ureq::get(&url)
            .set("User-Agent", "Mozilla/5.0")
            .call()
            .map_err(|e| e.to_string())?;
        let name = filename_from_url(&url);
        (Box::new(resp.into_reader()), name)
    };

    let mut buf = Vec::new();
    let mut reader = reader;
    reader.read_to_end(&mut buf).map_err(|e| e.to_string())?;

    let dest = unique_path(&dir, &name);
    fs::write(&dest, &buf).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

fn filename_from_url(url: &str) -> String {
    let no_query = url.split(['?', '#']).next().unwrap_or(url);
    let seg = no_query.rsplit('/').next().unwrap_or("");
    let raw = if seg.is_empty() { "index" } else { seg };
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect();
    if cleaned.is_empty() {
        "download".to_string()
    } else {
        cleaned
    }
}

fn unique_path(dir: &str, name: &str) -> PathBuf {
    let cand = Path::new(dir).join(name);
    if !cand.exists() {
        return cand;
    }
    let stem = Path::new(name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let ext = Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_string());
    let mut i = 1;
    loop {
        let newname = match &ext {
            Some(e) => format!("{}-{}.{}", stem, i, e),
            None => format!("{}-{}", stem, i),
        };
        let next = Path::new(dir).join(newname);
        if !next.exists() {
            return next;
        }
        i += 1;
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            pick_open,
            pick_save,
            read_file,
            write_file,
            open_directory,
            list_directory,
            fetch_html,
            download_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
