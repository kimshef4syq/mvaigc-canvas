//! Data-only skill packages. Installing a skill never executes its scripts.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use tauri::Manager;

const MAX_PACKAGE: u64 = 32 * 1024 * 1024;
const MAX_FILE: u64 = 2 * 1024 * 1024;
const MAX_FILES: usize = 512;
static MUTATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkill {
    id: String,
    markdown: String,
    enabled: bool,
    revision: String,
    resources: Vec<String>,
    error: Option<String>,
}

fn valid_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 80
        || !id.as_bytes()[0].is_ascii_lowercase()
        || !id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err("技能 ID 只能使用小写字母、数字和连字符，并以字母开头".into());
    }
    Ok(())
}

fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("extensions/skills");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

fn relative(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        || path.to_string_lossy().contains('\\')
    {
        return Err("技能文件路径必须是包内相对路径".into());
    }
    Ok(())
}

fn collect(
    base: &Path,
    current: &Path,
    files: &mut Vec<PathBuf>,
    bytes: &mut u64,
) -> Result<(), String> {
    for item in fs::read_dir(current).map_err(|e| e.to_string())? {
        let path = item.map_err(|e| e.to_string())?.path();
        let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() {
            return Err("技能包不支持符号链接".into());
        }
        if meta.is_dir() {
            if path
                .strip_prefix(base)
                .map_err(|e| e.to_string())?
                .components()
                .count()
                > 12
            {
                return Err("技能目录层级过深".into());
            }
            collect(base, &path, files, bytes)?;
        } else if meta.is_file() {
            *bytes += meta.len();
            if meta.len() > MAX_FILE || *bytes > MAX_PACKAGE || files.len() >= MAX_FILES {
                return Err("技能包超过文件数量或大小限制".into());
            }
            files.push(
                path.strip_prefix(base)
                    .map_err(|e| e.to_string())?
                    .to_path_buf(),
            );
        } else {
            return Err("技能包包含不支持的文件类型".into());
        }
    }
    Ok(())
}

fn inspect(base: &Path, id: &str, enabled: bool) -> Result<InstalledSkill, String> {
    let mut files = Vec::new();
    collect(base, base, &mut files, &mut 0)?;
    files.sort();
    let markdown = fs::read_to_string(base.join("SKILL.md"))
        .map_err(|_| "技能根目录必须包含 UTF-8 SKILL.md")?;
    if markdown.len() > 128 * 1024 {
        return Err("SKILL.md 超过 128 KiB".into());
    }
    let mut hash = Sha256::new();
    for file in &files {
        let name = file.to_string_lossy();
        hash.update((name.len() as u64).to_le_bytes());
        hash.update(name.as_bytes());
        let data = fs::read(base.join(file)).map_err(|e| e.to_string())?;
        hash.update((data.len() as u64).to_le_bytes());
        hash.update(data);
    }
    Ok(InstalledSkill {
        id: id.into(),
        markdown,
        enabled,
        error: None,
        revision: format!("{:x}", hash.finalize()),
        resources: files
            .iter()
            .filter(|p| **p != Path::new("SKILL.md"))
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .collect(),
    })
}

fn unpack_zip(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
    if zip.len() > MAX_FILES {
        return Err("ZIP 文件数量超限".into());
    }
    let mut total = 0;
    for i in 0..zip.len() {
        let mut file = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = file.enclosed_name().ok_or("ZIP 路径越界")?.to_path_buf();
        relative(&name)?;
        if name.components().count() > 12 {
            return Err("ZIP 目录层级过深".into());
        }
        if file
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("ZIP 不允许符号链接".into());
        }
        total += file.size();
        if file.size() > MAX_FILE || total > MAX_PACKAGE {
            return Err("ZIP 解压大小超限".into());
        }
        let target = dest.join(&name);
        if file.is_dir() {
            fs::create_dir_all(target).map_err(|e| e.to_string())?;
            continue;
        }
        fs::create_dir_all(target.parent().ok_or("无效 ZIP 路径")?).map_err(|e| e.to_string())?;
        let mut data = Vec::new();
        (&mut file)
            .take(MAX_FILE + 1)
            .read_to_end(&mut data)
            .map_err(|e| e.to_string())?;
        if data.len() as u64 > MAX_FILE {
            return Err("ZIP 文件大小超限".into());
        }
        let mut out = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)
            .map_err(|e| e.to_string())?;
        out.write_all(&data).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn install(
    base: &Path,
    id: &str,
    source: Option<&Path>,
    zip: Option<&[u8]>,
) -> Result<InstalledSkill, String> {
    valid_id(id)?;
    let temp = tempfile::Builder::new()
        .prefix(".install-")
        .tempdir_in(base)
        .map_err(|e| e.to_string())?;
    let unpacked = temp.path().join("content");
    fs::create_dir(&unpacked).map_err(|e| e.to_string())?;
    if let Some(source) = source {
        if fs::symlink_metadata(source)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("不能从符号链接安装".into());
        }
        let mut files = Vec::new();
        collect(source, source, &mut files, &mut 0)?;
        for file in files {
            relative(&file)?;
            let dest = unpacked.join(&file);
            fs::create_dir_all(dest.parent().ok_or("无效文件路径")?).map_err(|e| e.to_string())?;
            fs::copy(source.join(file), dest).map_err(|e| e.to_string())?;
        }
    } else {
        unpack_zip(zip.ok_or("缺少安装内容")?, &unpacked)?;
    }
    let content = if unpacked.join("SKILL.md").is_file() {
        unpacked.clone()
    } else {
        let children: Vec<_> = fs::read_dir(&unpacked)
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        if children.len() != 1 || !children[0].path().join("SKILL.md").is_file() {
            return Err("ZIP 必须包含单个技能目录或根 SKILL.md".into());
        }
        children[0].path()
    };
    let enabled = !base.join(format!(".disabled-{id}")).exists();
    let result = inspect(&content, id, enabled)?;
    let target = base.join(id);
    let backup = base.join(format!(".previous-{id}"));
    if backup.exists() {
        fs::remove_dir_all(&backup).map_err(|e| e.to_string())?;
    }
    let replacing = target.exists();
    if replacing {
        fs::rename(&target, &backup).map_err(|e| e.to_string())?;
    }
    if let Err(error) = fs::rename(content, &target) {
        if replacing {
            let _ = fs::rename(backup, target);
        }
        return Err(error.to_string());
    }
    Ok(result)
}

#[tauri::command]
pub async fn list_installed_skills(app: tauri::AppHandle) -> Result<Vec<InstalledSkill>, String> {
    let _guard = MUTATION.lock().await;
    let base = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut result = Vec::new();
        for entry in fs::read_dir(&base).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let id = entry.file_name().to_string_lossy().to_string();
            if valid_id(&id).is_err() {
                continue;
            }
            if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
                continue;
            }
            result.push(
                inspect(
                    &entry.path(),
                    &id,
                    !base.join(format!(".disabled-{id}")).exists(),
                )
                .unwrap_or_else(|error| InstalledSkill {
                    id,
                    markdown: String::new(),
                    enabled: false,
                    revision: String::new(),
                    resources: Vec::new(),
                    error: Some(error),
                }),
            );
        }
        result.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn install_local_skill(
    app: tauri::AppHandle,
    id: String,
    source: String,
) -> Result<InstalledSkill, String> {
    let _guard = MUTATION.lock().await;
    let base = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&source);
        if path.is_dir() {
            install(&base, &id, Some(path), None)
        } else {
            let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
            if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > MAX_PACKAGE {
                return Err("无效或过大的 ZIP 文件".into());
            }
            install(
                &base,
                &id,
                None,
                Some(&fs::read(path).map_err(|e| e.to_string())?),
            )
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn install_skill_zip(
    app: tauri::AppHandle,
    id: String,
    url: String,
    expected_sha256: String,
) -> Result<InstalledSkill, String> {
    valid_id(&id)?;
    if expected_sha256.len() != 64 || !expected_sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("需要有效 SHA256".into());
    }
    let url = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err("下载地址必须是无凭据的 HTTPS URL".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err("下载地址必须直接返回 ZIP，不支持跳转".into());
    }
    let mut data = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if data.len() + chunk.len() > MAX_PACKAGE as usize {
            return Err("下载大小超限".into());
        }
        data.extend_from_slice(&chunk);
    }
    if format!("{:x}", Sha256::digest(&data)) != expected_sha256.to_lowercase() {
        return Err("SHA256 不匹配".into());
    }
    let _guard = MUTATION.lock().await;
    let base = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || install(&base, &id, None, Some(&data)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_skill_enabled(
    app: tauri::AppHandle,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let _guard = MUTATION.lock().await;
    valid_id(&id)?;
    let base = root(&app)?;
    if !base.join(&id).is_dir() {
        return Err("技能不存在".into());
    }
    let marker = base.join(format!(".disabled-{id}"));
    if enabled {
        if marker.exists() {
            fs::remove_file(marker).map_err(|e| e.to_string())?;
        }
    } else {
        fs::write(marker, []).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn remove_skill(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let _guard = MUTATION.lock().await;
    valid_id(&id)?;
    let base = root(&app)?;
    for path in [base.join(&id), base.join(format!(".previous-{id}"))] {
        if path.exists() {
            fs::remove_dir_all(path).map_err(|e| e.to_string())?;
        }
    }
    let _ = fs::remove_file(base.join(format!(".disabled-{id}")));
    Ok(())
}

#[tauri::command]
pub async fn rollback_skill(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let _guard = MUTATION.lock().await;
    valid_id(&id)?;
    let base = root(&app)?;
    let backup = base.join(format!(".previous-{id}"));
    inspect(&backup, &id, true).map_err(|_| "没有可恢复的上一版本".to_string())?;
    let target = base.join(&id);
    let temp = tempfile::Builder::new()
        .prefix(".rollback-")
        .tempdir_in(&base)
        .map_err(|e| e.to_string())?;
    let displaced = temp.path().join("current");
    fs::rename(&target, &displaced).map_err(|e| e.to_string())?;
    if let Err(error) = fs::rename(&backup, &target) {
        let _ = fs::rename(&displaced, &target);
        return Err(error.to_string());
    }
    fs::rename(displaced, backup).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn read_skill_resource(
    app: tauri::AppHandle,
    id: String,
    resource: String,
    revision: String,
) -> Result<String, String> {
    let _guard = MUTATION.lock().await;
    valid_id(&id)?;
    relative(Path::new(&resource))?;
    let base = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        if base.join(format!(".disabled-{id}")).exists() {
            return Err("技能已禁用".into());
        }
        let dir = base.join(&id);
        let info = inspect(&dir, &id, true)?;
        if info.revision != revision {
            return Err("技能版本已变更，请重新发起任务".into());
        }
        if resource != "SKILL.md" && !info.resources.contains(&resource) {
            return Err("技能资源不存在".into());
        }
        let path = dir.join(resource);
        if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 128 * 1024 {
            return Err("资源超过 128 KiB，请拆分后读取".into());
        }
        fs::read_to_string(path).map_err(|_| "只能读取 UTF-8 文本资源；脚本不会自动执行".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn zip_extraction_rejects_traversal_and_accepts_valid_resource_tree() {
        fn archive(name: &str) -> Vec<u8> {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"content").unwrap();
            zip.finish().unwrap().into_inner()
        }
        let dest = tempfile::tempdir().unwrap();
        assert!(unpack_zip(&archive("../escape.txt"), dest.path()).is_err());
        unpack_zip(&archive("references/shots.md"), dest.path()).unwrap();
        assert_eq!(
            fs::read_to_string(dest.path().join("references/shots.md")).unwrap(),
            "content"
        );
    }
    #[test]
    fn rejects_paths_and_symlinks_and_preserves_previous_install() {
        for id in ["../escape", "/tmp/x", "a/b", "a\\b", "", "a..b"] {
            assert!(valid_id(id).is_err());
        }
        for path in ["../escape", "/tmp/x", "a/../../x", "a\\x"] {
            assert!(relative(Path::new(path)).is_err());
        }
        let base = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        fs::write(
            source.path().join("SKILL.md"),
            "---\nname: test\n---\nOriginal",
        )
        .unwrap();
        let first = install(base.path(), "test", Some(source.path()), None).unwrap();
        fs::remove_file(source.path().join("SKILL.md")).unwrap();
        assert!(install(base.path(), "test", Some(source.path()), None).is_err());
        assert_eq!(
            inspect(&base.path().join("test"), "test", true)
                .unwrap()
                .revision,
            first.revision
        );
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc/passwd", source.path().join("secret")).unwrap();
            assert!(install(base.path(), "test", Some(source.path()), None).is_err());
        }
    }
}
