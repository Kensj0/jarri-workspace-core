#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    std::env::set_var("GTK_IM_MODULE", "gtk-im-context-simple");
    app_lib::run();
}
