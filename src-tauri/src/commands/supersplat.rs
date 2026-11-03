use axum::{body::Bytes, extract::{Path, State, DefaultBodyLimit}, http::{StatusCode, header}, response::{IntoResponse, Response}, routing::{get, post}, Router};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{json, Value};
use std::{sync::{Arc, Mutex}, collections::HashMap, path::PathBuf};
use tauri::Manager;
#[derive(Default)]
pub struct SplatSessions(pub Mutex<HashMap<String, Arc<Session>>>);
pub struct Session { token: String, root: PathBuf, file: Vec<u8>, name: String, folder: Option<PathBuf>, views: Value, results: Mutex<Vec<Value>> }
async fn serve(State(s): State<Arc<Session>>, Path((token, path)): Path<(String,String)>) -> Response {
 if token != s.token { return StatusCode::NOT_FOUND.into_response(); }
 if let Some(relative) = path.strip_prefix("asset/") {
  if let Some(folder) = &s.folder {
   let Ok(file) = folder.join(relative).canonicalize() else { return StatusCode::NOT_FOUND.into_response(); };
   if !file.starts_with(folder) || !file.is_file() { return StatusCode::FORBIDDEN.into_response(); }
   return match tokio::fs::read(file).await { Ok(bytes)=>([(header::CONTENT_TYPE,"application/octet-stream")],bytes).into_response(), Err(_)=>StatusCode::NOT_FOUND.into_response() };
  }
  return StatusCode::NOT_FOUND.into_response();
 }
 if path == "model" { return ([(header::CONTENT_TYPE,"application/octet-stream")],s.file.clone()).into_response(); }
 if path == "session.json" { return axum::Json(json!({"name":s.name,"views":s.views,"folder":s.folder.is_some()})).into_response(); }
 if path.is_empty() || path == "index.html" { return ([(header::CONTENT_TYPE,"text/html")],include_str!("supersplat-shell.html")).into_response(); }
 if path.split('/').any(|p|p==".." || p.contains('\\')) { return StatusCode::BAD_REQUEST.into_response(); }
 let relative = path.strip_prefix("editor/").unwrap_or(&path);
 let mime = match relative.rsplit('.').next().unwrap_or("") { "html"=>"text/html", "js"=>"text/javascript", "css"=>"text/css", "json"=>"application/json", "wasm"=>"application/wasm", "png"=>"image/png", "webp"=>"image/webp", "svg"=>"image/svg+xml", _=>"application/octet-stream" };
 match tokio::fs::read(s.root.join(relative)).await { Ok(bytes)=>([(header::CONTENT_TYPE,mime)],bytes).into_response(),Err(_)=>StatusCode::NOT_FOUND.into_response() }
}
async fn result(State(s): State<Arc<Session>>, Path(token): Path<String>, bytes: Bytes) -> StatusCode {
 if token != s.token { return StatusCode::NOT_FOUND; }
 match serde_json::from_slice::<Value>(&bytes) { Ok(value)=>{s.results.lock().unwrap().push(value);StatusCode::OK},Err(_)=>StatusCode::BAD_REQUEST }
}
#[tauri::command]
pub async fn supersplat_open(app: tauri::AppHandle, state: tauri::State<'_,SplatSessions>, name: String, contents: String, views: Value, folder_path: Option<String>) -> Result<String,String> {
 let root = if cfg!(debug_assertions) { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../public/supersplat") } else { app.path().resource_dir().map_err(|e|e.to_string())?.join("supersplat") };
 if !root.join("index.html").exists() { return Err("MVAIGC build is missing".into()); }
 let folder = match folder_path {
  Some(path) => {
   let folder = PathBuf::from(path).canonicalize().map_err(|e|e.to_string())?;
   let library = app.path().app_data_dir().map_err(|e|e.to_string())?.join("gaussian-assets").canonicalize().map_err(|e|e.to_string())?;
   if !folder.starts_with(library) || !folder.is_dir() { return Err("Invalid asset folder".into()); }
   Some(folder)
  }, None => None
 };
 let token=uuid::Uuid::new_v4().to_string();
 let session=Arc::new(Session{token:token.clone(),root,file:STANDARD.decode(contents).map_err(|e|e.to_string())?,name,folder,views,results:Mutex::new(Vec::new())});
 let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e|e.to_string())?;
 let port=listener.local_addr().map_err(|e|e.to_string())?.port();
 let router=Router::new().route("/{token}/result",post(result)).route("/{token}/{*path}",get(serve)).layer(DefaultBodyLimit::max(1024*1024*1024)).with_state(session.clone());
 state.0.lock().unwrap().insert(token.clone(),session);
 tauri::async_runtime::spawn(async move { let _=axum::serve(listener,router).with_graceful_shutdown(async { tokio::time::sleep(std::time::Duration::from_secs(14400)).await; }).await; });
 let url=format!("http://127.0.0.1:{port}/{token}/index.html");
 #[cfg(target_os="macos")]
 let status=std::process::Command::new("open").args(["-n", "-a", "Google Chrome", "--args", "--new-window", "--start-fullscreen", &url]).status().map_err(|e|e.to_string())?;
 #[cfg(target_os="windows")]
 let status=std::process::Command::new("cmd").args(["/C", "start", "", "chrome", "--new-window", "--start-fullscreen", &url]).status().map_err(|e|e.to_string())?;
 #[cfg(target_os="linux")]
 let status=std::process::Command::new("google-chrome").args(["--new-window", "--start-fullscreen", &url]).spawn().map(|_|()).map_err(|e|e.to_string());
 #[cfg(not(target_os="linux"))]
 if !status.success(){return Err("无法启动 Google Chrome，请先安装 Chrome".into());}
 #[cfg(target_os="linux")]
 status?;
 Ok(token)
}
#[tauri::command]
pub fn supersplat_results(state: tauri::State<'_,SplatSessions>, token: String)->Result<Vec<Value>,String>{let map=state.0.lock().unwrap();let s=map.get(&token).ok_or("Session missing")?;let items=std::mem::take(&mut *s.results.lock().unwrap());Ok(items)}

#[tauri::command]
pub async fn supersplat_import_folder(app: tauri::AppHandle, path: String) -> Result<Value,String> {
 let source=PathBuf::from(path).canonicalize().map_err(|e|e.to_string())?;
 let mut mains=Vec::new();
 for entry in std::fs::read_dir(&source).map_err(|e|e.to_string())? {
  let entry=entry.map_err(|e|e.to_string())?;
  if entry.path().extension().is_some_and(|ext|ext.to_string_lossy().eq_ignore_ascii_case("lcc2")) { mains.push(entry.file_name().to_string_lossy().to_string()); }
 }
 if mains.len()!=1 { return Err("请选择包含一个 LCC2 主文件的完整文件夹".into()); }
 let destination=app.path().app_data_dir().map_err(|e|e.to_string())?.join("gaussian-assets").join(uuid::Uuid::new_v4().to_string());
 fn copy_tree(source:&std::path::Path,target:&std::path::Path)->std::io::Result<()> {
  std::fs::create_dir_all(target)?;
  for entry in std::fs::read_dir(source)? { let entry=entry?;let kind=entry.file_type()?;
   if kind.is_symlink() { return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput,"Symbolic links are not supported")); }
   if kind.is_dir(){copy_tree(&entry.path(),&target.join(entry.file_name()))?;}else if kind.is_file(){std::fs::copy(entry.path(),target.join(entry.file_name()))?;}
  } Ok(())
 }
 if let Err(error)=copy_tree(&source,&destination) { let _=std::fs::remove_dir_all(&destination);return Err(error.to_string()); }
 Ok(json!({"folderPath":destination.to_string_lossy(),"sourceName":mains[0],"name":source.file_name().unwrap_or_default().to_string_lossy()}))
}

#[cfg(test)]
mod folder_tests {
 use super::*;
 #[tokio::test]
 async fn serves_nested_asset_files_and_rejects_escape() {
  let temp=tempfile::tempdir().unwrap();
  let folder=temp.path().join("asset");
  std::fs::create_dir_all(folder.join("data/3dgs")).unwrap();
  std::fs::write(folder.join("data/3dgs/0.spz"),b"chunk").unwrap();
  std::fs::write(temp.path().join("outside.spz"),b"private").unwrap();
  let s=Arc::new(Session{token:"secret".into(),root:folder.clone(),folder:Some(folder.canonicalize().unwrap()),file:vec![],name:"scene.lcc2".into(),views:json!([]),results:Mutex::new(vec![])});
  let response=serve(State(s.clone()),Path(("secret".into(),"asset/data/3dgs/0.spz".into()))).await;
  assert_eq!(response.status(),StatusCode::OK);
  let bytes=axum::body::to_bytes(response.into_body(),100).await.unwrap();
  assert_eq!(&bytes[..],b"chunk");
  let response=serve(State(s.clone()),Path(("secret".into(),"asset/../outside.spz".into()))).await;
  assert_eq!(response.status(),StatusCode::FORBIDDEN);
  let response=serve(State(s),Path(("wrong".into(),"asset/data/3dgs/0.spz".into()))).await;
  assert_eq!(response.status(),StatusCode::NOT_FOUND);
 }
}

/// Fetch the generated PLY through the desktop transport (no WebView CORS dependency).
#[tauri::command]
pub async fn supersplat_download_ply(url: String, headers: std::collections::HashMap<String, String>) -> Result<String, String> {
 let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
 if !matches!(parsed.scheme(), "http" | "https") { return Err("Invalid model URL".into()); }
 let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(180)).build().map_err(|e|e.to_string())?;
 let mut request = client.get(parsed);
 for (key, value) in headers { request = request.header(key, value); }
 let mut response = request.send().await.map_err(|e|e.to_string())?.error_for_status().map_err(|e|e.to_string())?;
 let limit = 128 * 1024 * 1024;
 if response.content_length().is_some_and(|size| size > limit as u64) { return Err("PLY exceeds 128 MiB".into()); }
 let mut bytes = Vec::new();
 while let Some(chunk) = response.chunk().await.map_err(|e|e.to_string())? {
  if bytes.len() + chunk.len() > limit { return Err("PLY exceeds 128 MiB".into()); }
  bytes.extend_from_slice(&chunk);
 }
 let header = String::from_utf8_lossy(&bytes[..bytes.len().min(8192)]);
 if !header.starts_with("ply\n") && !header.starts_with("ply\r\n") { return Err("Downloaded file is not PLY".into()); }
 if !header.contains("end_header") || !header.contains("property float opacity") || !header.contains("property float scale_0") || !header.contains("property float rot_0") { return Err("PLY is missing Gaussian properties".into()); }
 Ok(STANDARD.encode(bytes))
}
