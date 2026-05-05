use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LibraryEntry {
    pub job_id: String,
    pub created_at: String,
    pub speaker: String,
    pub language: String,
    pub style: Option<String>,
    pub model_size: String,
    pub text_preview: String,
    pub duration_s: f64,
    pub sample_rate: u32,
    pub wav_path: String,
}

fn library_dir(app: &AppHandle) -> PathBuf {
    let mut path = app
        .path()
        .app_data_dir()
        .expect("app_data_dir unavailable");
    path.push("library");
    path
}

#[tauri::command]
pub async fn list_library(app: AppHandle) -> Result<Vec<LibraryEntry>, String> {
    let lib_dir = library_dir(&app);
    if !lib_dir.exists() {
        return Ok(vec![]);
    }

    let mut entries: Vec<(std::time::SystemTime, LibraryEntry)> = vec![];

    let read = std::fs::read_dir(&lib_dir).map_err(|e| e.to_string())?;
    for entry in read.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let json_str = std::fs::read_to_string(&path).unwrap_or_default();
        let Ok(meta) = serde_json::from_str::<serde_json::Value>(&json_str) else {
            continue;
        };

        // Derive wav_path from the json path (strip .json suffix)
        let wav_path = path
            .with_extension("")
            .to_str()
            .unwrap_or("")
            .to_string();

        // Only include if WAV exists
        if !std::path::Path::new(&wav_path).exists() {
            continue;
        }

        let mtime = entry.metadata().ok().and_then(|m| m.modified().ok())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

        let lib_entry = LibraryEntry {
            job_id: meta["job_id"].as_str().unwrap_or("").to_string(),
            created_at: meta["created_at"].as_str().unwrap_or("").to_string(),
            speaker: meta["speaker"].as_str().unwrap_or("").to_string(),
            language: meta["language"].as_str().unwrap_or("").to_string(),
            style: meta["style"].as_str().map(|s| s.to_string()),
            model_size: meta["model_size"].as_str().unwrap_or("1.7B").to_string(),
            text_preview: meta["text_preview"].as_str().unwrap_or("").to_string(),
            duration_s: meta["duration_s"].as_f64().unwrap_or(0.0),
            sample_rate: meta["sample_rate"].as_u64().unwrap_or(24000) as u32,
            wav_path,
        };
        entries.push((mtime, lib_entry));
    }

    // Sort newest first, keep 50
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    let result: Vec<LibraryEntry> = entries.into_iter().take(50).map(|(_, e)| e).collect();
    Ok(result)
}

#[tauri::command]
pub async fn delete_library_entry(_app: AppHandle, wav_path: String) -> Result<(), String> {
    let path = std::path::Path::new(&wav_path);
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    let json_path = format!("{wav_path}.json");
    if std::path::Path::new(&json_path).exists() {
        std::fs::remove_file(&json_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
