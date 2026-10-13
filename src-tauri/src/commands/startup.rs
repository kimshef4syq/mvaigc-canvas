use std::io::Write;
use std::process::{Child, Command};
use std::sync::Mutex;
use tempfile::NamedTempFile;

struct StartupPlayback {
    child: Child,
    _audio_file: NamedTempFile,
}

impl Drop for StartupPlayback {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
pub struct StartupSoundState(Mutex<Option<StartupPlayback>>);

#[tauri::command]
pub fn play_startup_sound(state: tauri::State<'_, StartupSoundState>) -> Result<(), String> {
    let mut playback = state.0.lock().map_err(|error| error.to_string())?;
    // Drop the previous player before starting another (including dev StrictMode remounts).
    *playback = None;
    let mut audio_file = NamedTempFile::new().map_err(|error| error.to_string())?;
    audio_file
        .write_all(include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../public/startup/intro.wav"
        )))
        .map_err(|error| error.to_string())?;
    audio_file.flush().map_err(|error| error.to_string())?;

    #[cfg(target_os = "macos")]
    let child = Command::new("/usr/bin/afplay")
        .arg(audio_file.path())
        .spawn()
        .map_err(|error| error.to_string())?;

    #[cfg(target_os = "windows")]
    let child = {
        use std::os::windows::process::CommandExt;
        Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "$player = New-Object System.Media.SoundPlayer $env:MVAIGC_STARTUP_SOUND; $player.PlaySync()",
            ])
            .env("MVAIGC_STARTUP_SOUND", audio_file.path())
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|error| error.to_string())?
    };

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let child = Command::new("paplay")
        .arg(audio_file.path())
        .spawn()
        .or_else(|_| Command::new("aplay").arg(audio_file.path()).spawn())
        .map_err(|error| error.to_string())?;

    *playback = Some(StartupPlayback {
        child,
        _audio_file: audio_file,
    });
    Ok(())
}

#[tauri::command]
pub fn stop_startup_sound(state: tauri::State<'_, StartupSoundState>) -> Result<(), String> {
    *state.0.lock().map_err(|error| error.to_string())? = None;
    Ok(())
}
