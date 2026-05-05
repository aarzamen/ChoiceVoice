use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GenerateSpeechRequest {
    pub text: String,
    pub speaker: String,
    pub language: String,
    pub style: Option<String>,
    pub model_size: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GenerateSpeechResponse {
    pub job_id: String,
    pub wav_path: String,
    pub duration_s: f64,
    pub sample_rate: u32,
    pub chunks_processed: u64,
}

fn library_dir(app: &AppHandle) -> PathBuf {
    let mut path = app
        .path()
        .app_data_dir()
        .expect("app_data_dir unavailable");
    path.push("library");
    path
}

fn wav_filename(job_id: &str, speaker: &str) -> String {
    let ts = chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S").to_string();
    let sp = speaker.to_lowercase().replace('_', "-");
    let short = &job_id[..8.min(job_id.len())];
    format!("{ts}_{sp}_{short}.wav")
}

#[tauri::command]
pub async fn generate_speech(
    app: AppHandle,
    request: GenerateSpeechRequest,
) -> Result<GenerateSpeechResponse, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    // Prepare output path
    let lib_dir = library_dir(&app);
    std::fs::create_dir_all(&lib_dir).map_err(|e| e.to_string())?;
    let wav_name = wav_filename(&job_id, &request.speaker);
    let wav_path = lib_dir.join(&wav_name);

    // Build sidecar args
    let args = vec![
        "--job-id".to_string(),
        job_id.clone(),
        "--speaker".to_string(),
        request.speaker.clone(),
        "--language".to_string(),
        request.language.clone(),
        "--model-size".to_string(),
        request.model_size.clone(),
        "--output".to_string(),
        wav_path.to_str().unwrap().to_string(),
    ];

    // Build stdin payload
    let style_val = request.style.as_deref().unwrap_or("").trim().to_string();
    let stdin_payload = serde_json::json!({
        "text": request.text,
        "style": if style_val.is_empty() { serde_json::Value::Null } else { style_val.into() }
    })
    .to_string();

    // Spawn sidecar
    let shell = app.shell();
    let (mut rx, mut child) = shell
        .sidecar("choicevoice-tts")
        .map_err(|e| format!("sidecar not found: {e}"))?
        .args(&args)
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;

    // Write one JSON line to stdin, then Rust lets the child read it via readline()
    child.write(stdin_payload.as_bytes()).map_err(|e| e.to_string())?;
    child.write(b"\n").map_err(|e| e.to_string())?;

    // Read events
    let app2 = app.clone();
    let mut complete_event: Option<serde_json::Value> = None;

    use tauri_plugin_shell::process::CommandEvent;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                let line_str = String::from_utf8_lossy(&line).to_string();
                for raw in line_str.lines() {
                    if raw.trim().is_empty() {
                        continue;
                    }
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(raw) {
                        let ev_name = val.get("event").and_then(|v| v.as_str()).unwrap_or("");
                        if ev_name == "complete" {
                            complete_event = Some(val.clone());
                        }
                        // Forward all events to the frontend
                        let _ = app2.emit("tts://progress", val);
                    }
                }
            }
            CommandEvent::Stderr(line) => {
                let _ = log::warn!(
                    "sidecar stderr: {}",
                    String::from_utf8_lossy(&line)
                );
            }
            CommandEvent::Error(e) => {
                return Err(format!("sidecar error: {e}"));
            }
            CommandEvent::Terminated(status) => {
                if status.code != Some(0) {
                    return Err(format!(
                        "sidecar exited with code {:?}",
                        status.code
                    ));
                }
                break;
            }
            _ => {}
        }
    }

    let complete = complete_event
        .ok_or_else(|| "sidecar finished without a complete event".to_string())?;

    Ok(GenerateSpeechResponse {
        job_id,
        wav_path: complete["wav_path"]
            .as_str()
            .unwrap_or(wav_path.to_str().unwrap())
            .to_string(),
        duration_s: complete["duration_s"].as_f64().unwrap_or(0.0),
        sample_rate: complete["sample_rate"].as_u64().unwrap_or(24000) as u32,
        chunks_processed: complete["chunks_processed"].as_u64().unwrap_or(0),
    })
}
