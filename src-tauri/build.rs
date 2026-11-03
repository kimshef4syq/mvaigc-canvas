fn main() {
    let _ = std::fs::create_dir_all("../public/supersplat");
    let _ = std::fs::create_dir_all("../resources/hypit-provider-mvaigc/dist");
    tauri_build::build()
}
