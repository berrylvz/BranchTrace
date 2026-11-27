#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod models;

use db::{clock_context, DbHandle};
pub use db::{create_demo_database_file, DemoSeedSummary};
pub use models::{ApiError, ErrorCode};
use models::{
    ClockContext, DailyRangeDto, DailyWeekDto, DeleteResult, MonthCalendarDto, PreviewResult,
    ProjectDetailDto, ProjectDto, ReminderDto, RestoreResult, TerminalStatus, ThemeSettings,
    TrashEntryDto,
};
use rusqlite::Connection;
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, RunEvent, WindowEvent};

pub struct AppState {
    pub db: Result<DbHandle, ApiError>,
    closing: AtomicBool,
}

impl AppState {
    pub fn shutdown(&self) {
        if let Ok(db) = &self.db {
            db.shutdown();
        }
    }
}

async fn call_db<T, F>(state: &tauri::State<'_, AppState>, operation: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce(&mut Connection) -> Result<T, ApiError> + Send + 'static,
{
    let db = state.db.as_ref().map_err(Clone::clone)?;
    db.call(operation).await
}

#[tauri::command]
fn get_clock_context() -> ClockContext {
    clock_context()
}

#[tauri::command]
async fn get_project_tree(state: tauri::State<'_, AppState>) -> Result<Vec<ProjectDto>, ApiError> {
    call_db(&state, |conn| db::projects::get_project_tree(conn)).await
}

#[tauri::command]
async fn get_project_detail(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<ProjectDetailDto, ApiError> {
    call_db(&state, move |conn| {
        db::projects::get_project_detail(conn, &project_id)
    })
    .await
}

#[tauri::command]
async fn get_project_progress_month(
    state: tauri::State<'_, AppState>,
    project_id: String,
    month: String,
) -> Result<Vec<String>, ApiError> {
    call_db(&state, move |conn| {
        db::projects::get_project_progress_month(conn, &project_id, &month)
    })
    .await
}

#[tauri::command]
async fn create_project(
    state: tauri::State<'_, AppState>,
    title: String,
    parent_id: Option<String>,
) -> Result<ProjectDto, ApiError> {
    call_db(&state, move |conn| {
        db::projects::create_project(conn, &title, parent_id)
    })
    .await
}

#[tauri::command]
async fn rename_project(
    state: tauri::State<'_, AppState>,
    project_id: String,
    title: String,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    call_db(&state, move |conn| {
        db::projects::rename_project(conn, &project_id, &title, expected_version)
    })
    .await
}

#[tauri::command]
async fn set_project_expanded(
    state: tauri::State<'_, AppState>,
    project_id: String,
    is_expanded: bool,
) -> Result<ProjectDto, ApiError> {
    call_db(&state, move |conn| {
        db::projects::set_project_expanded(conn, &project_id, is_expanded)
    })
    .await
}

#[tauri::command]
async fn set_all_projects_expanded(
    state: tauri::State<'_, AppState>,
    is_expanded: bool,
) -> Result<Vec<ProjectDto>, ApiError> {
    call_db(&state, move |conn| {
        db::projects::set_all_projects_expanded(conn, is_expanded)
    })
    .await
}

#[tauri::command]
async fn reorder_project_siblings(
    state: tauri::State<'_, AppState>,
    parent_id: Option<String>,
    ordered_ids: Vec<String>,
) -> Result<Vec<ProjectDto>, ApiError> {
    call_db(&state, move |conn| {
        db::projects::reorder_project_siblings(conn, parent_id, ordered_ids)
    })
    .await
}

#[tauri::command]
async fn move_project(
    state: tauri::State<'_, AppState>,
    project_id: String,
    target_parent_id: Option<String>,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    call_db(&state, move |conn| {
        db::projects::move_project(conn, &project_id, target_parent_id, expected_version)
    })
    .await
}

#[tauri::command]
async fn set_project_progress(
    state: tauri::State<'_, AppState>,
    project_id: String,
    date: Option<String>,
    present: bool,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    call_db(&state, move |conn| {
        db::projects::set_project_progress(conn, &project_id, date, present, expected_version)
    })
    .await
}

#[tauri::command]
async fn complete_project(
    state: tauri::State<'_, AppState>,
    project_id: String,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    call_db(&state, move |conn| {
        db::projects::set_project_terminal(
            conn,
            &project_id,
            expected_version,
            TerminalStatus::Completed,
        )
    })
    .await
}

#[tauri::command]
async fn cancel_project(
    state: tauri::State<'_, AppState>,
    project_id: String,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    call_db(&state, move |conn| {
        db::projects::set_project_terminal(
            conn,
            &project_id,
            expected_version,
            TerminalStatus::Canceled,
        )
    })
    .await
}

#[tauri::command]
async fn restore_project(
    state: tauri::State<'_, AppState>,
    project_id: String,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    call_db(&state, move |conn| {
        db::projects::restore_project(conn, &project_id, expected_version)
    })
    .await
}

#[tauri::command]
async fn update_project_terminal_date(
    state: tauri::State<'_, AppState>,
    project_id: String,
    date: String,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    call_db(&state, move |conn| {
        db::projects::update_project_terminal_date(conn, &project_id, &date, expected_version)
    })
    .await
}

#[tauri::command]
async fn get_reminder(
    state: tauri::State<'_, AppState>,
    reminder_id: String,
) -> Result<ReminderDto, ApiError> {
    call_db(&state, move |conn| {
        db::reminders::get_reminder(conn, &reminder_id)
    })
    .await
}

#[tauri::command]
async fn create_reminder(
    state: tauri::State<'_, AppState>,
    title: String,
    scheduled_date: String,
) -> Result<ReminderDto, ApiError> {
    call_db(&state, move |conn| {
        db::reminders::create_reminder(conn, &title, &scheduled_date)
    })
    .await
}

#[tauri::command]
async fn rename_reminder(
    state: tauri::State<'_, AppState>,
    reminder_id: String,
    title: String,
    expected_version: i64,
) -> Result<ReminderDto, ApiError> {
    call_db(&state, move |conn| {
        db::reminders::rename_reminder(conn, &reminder_id, &title, expected_version)
    })
    .await
}

#[tauri::command]
async fn update_reminder_schedule(
    state: tauri::State<'_, AppState>,
    reminder_id: String,
    scheduled_date: String,
    expected_version: i64,
) -> Result<ReminderDto, ApiError> {
    call_db(&state, move |conn| {
        db::reminders::update_reminder_schedule(
            conn,
            &reminder_id,
            &scheduled_date,
            expected_version,
        )
    })
    .await
}

#[tauri::command]
async fn complete_reminder(
    state: tauri::State<'_, AppState>,
    reminder_id: String,
    expected_version: i64,
) -> Result<ReminderDto, ApiError> {
    call_db(&state, move |conn| {
        db::reminders::complete_reminder(conn, &reminder_id, expected_version)
    })
    .await
}

#[tauri::command]
async fn cancel_reminder(
    state: tauri::State<'_, AppState>,
    reminder_id: String,
    expected_version: i64,
) -> Result<ReminderDto, ApiError> {
    call_db(&state, move |conn| {
        db::reminders::cancel_reminder(conn, &reminder_id, expected_version)
    })
    .await
}

#[tauri::command]
async fn restore_reminder(
    state: tauri::State<'_, AppState>,
    reminder_id: String,
    expected_version: i64,
) -> Result<ReminderDto, ApiError> {
    call_db(&state, move |conn| {
        db::reminders::restore_reminder(conn, &reminder_id, expected_version)
    })
    .await
}

#[tauri::command]
async fn update_reminder_completed_date(
    state: tauri::State<'_, AppState>,
    reminder_id: String,
    date: String,
    expected_version: i64,
) -> Result<ReminderDto, ApiError> {
    call_db(&state, move |conn| {
        db::reminders::update_reminder_completed_date(conn, &reminder_id, &date, expected_version)
    })
    .await
}

#[tauri::command]
async fn reorder_reminders(
    state: tauri::State<'_, AppState>,
    scheduled_date: String,
    ordered_ids: Vec<String>,
) -> Result<Vec<ReminderDto>, ApiError> {
    call_db(&state, move |conn| {
        db::reminders::reorder_reminders(conn, &scheduled_date, ordered_ids)
    })
    .await
}

#[tauri::command]
async fn get_daily_week(
    state: tauri::State<'_, AppState>,
    week_start: String,
) -> Result<DailyWeekDto, ApiError> {
    call_db(&state, move |conn| {
        db::views::get_daily_week(conn, &week_start)
    })
    .await
}

#[tauri::command]
async fn get_daily_range(
    state: tauri::State<'_, AppState>,
    start_date: String,
    end_date: String,
) -> Result<DailyRangeDto, ApiError> {
    call_db(&state, move |conn| {
        db::views::get_daily_range(conn, &start_date, &end_date)
    })
    .await
}

#[tauri::command]
async fn get_month_calendar(
    state: tauri::State<'_, AppState>,
    month: String,
) -> Result<MonthCalendarDto, ApiError> {
    call_db(&state, move |conn| {
        db::views::get_month_calendar(conn, &month)
    })
    .await
}

#[tauri::command]
async fn preview_project_trash(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<PreviewResult, ApiError> {
    call_db(&state, move |conn| {
        db::trash::preview_project_trash(conn, &project_id)
    })
    .await
}

#[tauri::command]
async fn trash_project(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<TrashEntryDto, ApiError> {
    call_db(&state, move |conn| {
        db::trash::trash_project(conn, &project_id)
    })
    .await
}

#[tauri::command]
async fn trash_reminder(
    state: tauri::State<'_, AppState>,
    reminder_id: String,
) -> Result<TrashEntryDto, ApiError> {
    call_db(&state, move |conn| {
        db::trash::trash_reminder(conn, &reminder_id)
    })
    .await
}

#[tauri::command]
async fn list_trash(
    state: tauri::State<'_, AppState>,
    kind: String,
) -> Result<Vec<TrashEntryDto>, ApiError> {
    call_db(&state, move |conn| db::trash::list_trash(conn, &kind)).await
}

#[tauri::command]
async fn restore_trash_entry(
    state: tauri::State<'_, AppState>,
    entry_id: String,
) -> Result<RestoreResult, ApiError> {
    call_db(&state, move |conn| {
        db::trash::restore_trash_entry(conn, &entry_id)
    })
    .await
}

#[tauri::command]
async fn permanently_delete_trash_entry(
    state: tauri::State<'_, AppState>,
    entry_id: String,
) -> Result<DeleteResult, ApiError> {
    call_db(&state, move |conn| {
        db::trash::permanently_delete_trash_entry(conn, &entry_id)
    })
    .await
}

#[tauri::command]
async fn empty_trash(
    state: tauri::State<'_, AppState>,
    kind: String,
) -> Result<DeleteResult, ApiError> {
    call_db(&state, move |conn| db::trash::empty_trash(conn, &kind)).await
}

#[tauri::command]
async fn get_app_settings(state: tauri::State<'_, AppState>) -> Result<ThemeSettings, ApiError> {
    call_db(&state, |conn| db::settings::get_app_settings(conn)).await
}

#[tauri::command]
async fn set_theme_mode(
    state: tauri::State<'_, AppState>,
    mode: String,
) -> Result<ThemeSettings, ApiError> {
    call_db(&state, move |conn| {
        db::settings::set_theme_mode(conn, &mode)
    })
    .await
}

#[tauri::command]
fn relaunch_app(app: tauri::AppHandle, state: tauri::State<'_, AppState>) {
    if state.closing.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    std::thread::spawn(move || {
        if let Some(app_state) = app.try_state::<AppState>() {
            app_state.shutdown();
        }
        app.restart();
    });
}

fn startup_error(mut error: ApiError, db_path: Option<&PathBuf>) -> ApiError {
    let mut details = serde_json::Map::new();
    details.insert("startupError".to_string(), serde_json::Value::Bool(true));
    if let Some(path) = db_path {
        details.insert(
            "dbPath".to_string(),
            serde_json::Value::String(path.display().to_string()),
        );
    }
    error.details = Some(serde_json::Value::Object(details));
    error
}

const DB_PATH_ENV: &str = "BRANCHTRACE_DB_PATH";

fn resolve_db_path_from(
    override_path: Option<OsString>,
    default_dir: impl FnOnce() -> Result<PathBuf, ApiError>,
) -> Result<PathBuf, ApiError> {
    if let Some(raw) = override_path {
        if !raw.to_string_lossy().trim().is_empty() {
            return Ok(PathBuf::from(raw));
        }
    }
    Ok(default_dir()?.join("branchtrace.sqlite3"))
}

fn initialize_db(app: &tauri::App) -> Result<DbHandle, ApiError> {
    let db_path = resolve_db_path_from(std::env::var_os(DB_PATH_ENV), || {
        app.path().app_data_dir().map_err(|error| {
            startup_error(
                ApiError::new(
                    ErrorCode::DbError,
                    format!("Unable to resolve application data directory: {error}"),
                ),
                None,
            )
        })
    })?;
    if let Some(parent) = db_path.parent().filter(|dir| !dir.as_os_str().is_empty()) {
        if let Err(error) = std::fs::create_dir_all(parent) {
            return Err(startup_error(
                ApiError::new(
                    ErrorCode::DbError,
                    format!("Unable to create database directory: {error}"),
                ),
                Some(&db_path),
            ));
        }
    }
    DbHandle::start(db_path.clone()).map_err(|error| startup_error(error, Some(&db_path)))
}

#[cfg(test)]
mod lib_tests {
    use super::resolve_db_path_from;
    use std::ffi::OsString;
    use std::path::PathBuf;

    #[test]
    fn resolve_db_path_prefers_non_empty_override() {
        let custom = resolve_db_path_from(Some(OsString::from("/tmp/custom-demo.sqlite3")), || {
            Ok(PathBuf::from("/default/app-data"))
        })
        .unwrap();
        assert_eq!(custom, PathBuf::from("/tmp/custom-demo.sqlite3"));

        let fallback_none =
            resolve_db_path_from(None, || Ok(PathBuf::from("/default/app-data"))).unwrap();
        assert_eq!(
            fallback_none,
            PathBuf::from("/default/app-data/branchtrace.sqlite3")
        );

        let fallback_blank = resolve_db_path_from(Some(OsString::from("   ")), || {
            Ok(PathBuf::from("/default/app-data"))
        })
        .unwrap();
        assert_eq!(
            fallback_blank,
            PathBuf::from("/default/app-data/branchtrace.sqlite3")
        );
    }
}

pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    let app = builder
        .setup(|app| {
            let db = initialize_db(app);
            app.manage(AppState {
                db,
                closing: AtomicBool::new(false),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app_handle = window.app_handle().clone();
                let should_shutdown = app_handle
                    .try_state::<AppState>()
                    .map(|state| !state.closing.swap(true, Ordering::SeqCst))
                    .unwrap_or(true);
                if !should_shutdown {
                    return;
                }
                let _ = window.hide();
                std::thread::spawn(move || {
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        state.shutdown();
                    }
                    app_handle.exit(0);
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_clock_context,
            get_project_tree,
            get_project_detail,
            get_project_progress_month,
            create_project,
            rename_project,
            set_project_expanded,
            set_all_projects_expanded,
            reorder_project_siblings,
            move_project,
            set_project_progress,
            complete_project,
            cancel_project,
            restore_project,
            update_project_terminal_date,
            get_reminder,
            create_reminder,
            rename_reminder,
            update_reminder_schedule,
            complete_reminder,
            cancel_reminder,
            restore_reminder,
            update_reminder_completed_date,
            reorder_reminders,
            get_daily_week,
            get_daily_range,
            get_month_calendar,
            preview_project_trash,
            trash_project,
            trash_reminder,
            list_trash,
            restore_trash_entry,
            permanently_delete_trash_entry,
            empty_trash,
            get_app_settings,
            set_theme_mode,
            relaunch_app
        ])
        .build(tauri::generate_context!())
        .expect("Failed to start BranchTrace");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<AppState>() {
                state.shutdown();
            }
        }
    });
}
