#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod models;

use db::{clock_context, DbHandle};
use models::{
    ApiError, ClockContext, DailyWeekDto, DbOp, DbResponse, ProjectDetailDto, ProjectDto,
    ReminderDto, ThemeSettings, TrashEntryDto,
};
use serde::Serialize;
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

fn unexpected_response() -> ApiError {
    ApiError::internal("数据库返回了未预期的结果")
}

async fn request(state: &tauri::State<'_, AppState>, op: DbOp) -> Result<DbResponse, ApiError> {
    let db = state.db.as_ref().map_err(Clone::clone)?;
    db.request(op).await
}

#[tauri::command]
fn get_clock_context() -> ClockContext {
    clock_context()
}

#[tauri::command]
async fn get_project_tree(state: tauri::State<'_, AppState>) -> Result<Vec<ProjectDto>, ApiError> {
    match request(&state, DbOp::GetProjectTree).await? {
        DbResponse::Projects(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn get_project_detail(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<ProjectDetailDto, ApiError> {
    match request(&state, DbOp::GetProjectDetail { project_id }).await? {
        DbResponse::ProjectDetail(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn get_project_progress_month(
    state: tauri::State<'_, AppState>,
    project_id: String,
    month: String,
) -> Result<Vec<String>, ApiError> {
    match request(&state, DbOp::GetProjectProgressMonth { project_id, month }).await? {
        DbResponse::Dates(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn create_project(
    state: tauri::State<'_, AppState>,
    title: String,
    parent_id: Option<String>,
) -> Result<ProjectDto, ApiError> {
    match request(&state, DbOp::CreateProject { title, parent_id }).await? {
        DbResponse::Project(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn rename_project(
    state: tauri::State<'_, AppState>,
    project_id: String,
    title: String,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    match request(
        &state,
        DbOp::RenameProject {
            project_id,
            title,
            expected_version,
        },
    )
    .await?
    {
        DbResponse::Project(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn set_project_expanded(
    state: tauri::State<'_, AppState>,
    project_id: String,
    is_expanded: bool,
) -> Result<ProjectDto, ApiError> {
    match request(
        &state,
        DbOp::SetProjectExpanded {
            project_id,
            is_expanded,
        },
    )
    .await?
    {
        DbResponse::Project(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn set_all_projects_expanded(
    state: tauri::State<'_, AppState>,
    is_expanded: bool,
) -> Result<Vec<ProjectDto>, ApiError> {
    match request(&state, DbOp::SetAllProjectsExpanded { is_expanded }).await? {
        DbResponse::Projects(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn reorder_project_siblings(
    state: tauri::State<'_, AppState>,
    parent_id: Option<String>,
    ordered_ids: Vec<String>,
) -> Result<Vec<ProjectDto>, ApiError> {
    match request(
        &state,
        DbOp::ReorderProjectSiblings {
            parent_id,
            ordered_ids,
        },
    )
    .await?
    {
        DbResponse::Projects(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn move_project(
    state: tauri::State<'_, AppState>,
    project_id: String,
    target_parent_id: Option<String>,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    match request(
        &state,
        DbOp::MoveProject {
            project_id,
            target_parent_id,
            expected_version,
        },
    )
    .await?
    {
        DbResponse::Project(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn set_project_progress(
    state: tauri::State<'_, AppState>,
    project_id: String,
    date: Option<String>,
    present: bool,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    match request(
        &state,
        DbOp::SetProjectProgress {
            project_id,
            date,
            present,
            expected_version,
        },
    )
    .await?
    {
        DbResponse::Project(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn complete_project(
    state: tauri::State<'_, AppState>,
    project_id: String,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    match request(
        &state,
        DbOp::CompleteProject {
            project_id,
            expected_version,
        },
    )
    .await?
    {
        DbResponse::Project(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn cancel_project(
    state: tauri::State<'_, AppState>,
    project_id: String,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    match request(
        &state,
        DbOp::CancelProject {
            project_id,
            expected_version,
        },
    )
    .await?
    {
        DbResponse::Project(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn restore_project(
    state: tauri::State<'_, AppState>,
    project_id: String,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    match request(
        &state,
        DbOp::RestoreProject {
            project_id,
            expected_version,
        },
    )
    .await?
    {
        DbResponse::Project(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn update_project_terminal_date(
    state: tauri::State<'_, AppState>,
    project_id: String,
    date: String,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    match request(
        &state,
        DbOp::UpdateProjectTerminalDate {
            project_id,
            date,
            expected_version,
        },
    )
    .await?
    {
        DbResponse::Project(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn get_reminder(
    state: tauri::State<'_, AppState>,
    reminder_id: String,
) -> Result<ReminderDto, ApiError> {
    match request(&state, DbOp::GetReminder { reminder_id }).await? {
        DbResponse::Reminder(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn create_reminder(
    state: tauri::State<'_, AppState>,
    title: String,
    scheduled_date: String,
) -> Result<ReminderDto, ApiError> {
    match request(
        &state,
        DbOp::CreateReminder {
            title,
            scheduled_date,
        },
    )
    .await?
    {
        DbResponse::Reminder(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn rename_reminder(
    state: tauri::State<'_, AppState>,
    reminder_id: String,
    title: String,
    expected_version: i64,
) -> Result<ReminderDto, ApiError> {
    match request(
        &state,
        DbOp::RenameReminder {
            reminder_id,
            title,
            expected_version,
        },
    )
    .await?
    {
        DbResponse::Reminder(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn update_reminder_schedule(
    state: tauri::State<'_, AppState>,
    reminder_id: String,
    scheduled_date: String,
    expected_version: i64,
) -> Result<ReminderDto, ApiError> {
    match request(
        &state,
        DbOp::UpdateReminderSchedule {
            reminder_id,
            scheduled_date,
            expected_version,
        },
    )
    .await?
    {
        DbResponse::Reminder(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn complete_reminder(
    state: tauri::State<'_, AppState>,
    reminder_id: String,
    expected_version: i64,
) -> Result<ReminderDto, ApiError> {
    match request(
        &state,
        DbOp::CompleteReminder {
            reminder_id,
            expected_version,
        },
    )
    .await?
    {
        DbResponse::Reminder(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn cancel_reminder(
    state: tauri::State<'_, AppState>,
    reminder_id: String,
    expected_version: i64,
) -> Result<ReminderDto, ApiError> {
    match request(
        &state,
        DbOp::CancelReminder {
            reminder_id,
            expected_version,
        },
    )
    .await?
    {
        DbResponse::Reminder(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn restore_reminder(
    state: tauri::State<'_, AppState>,
    reminder_id: String,
    expected_version: i64,
) -> Result<ReminderDto, ApiError> {
    match request(
        &state,
        DbOp::RestoreReminder {
            reminder_id,
            expected_version,
        },
    )
    .await?
    {
        DbResponse::Reminder(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn update_reminder_completed_date(
    state: tauri::State<'_, AppState>,
    reminder_id: String,
    date: String,
    expected_version: i64,
) -> Result<ReminderDto, ApiError> {
    match request(
        &state,
        DbOp::UpdateReminderCompletedDate {
            reminder_id,
            date,
            expected_version,
        },
    )
    .await?
    {
        DbResponse::Reminder(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn reorder_reminders(
    state: tauri::State<'_, AppState>,
    scheduled_date: String,
    ordered_ids: Vec<String>,
) -> Result<Vec<ReminderDto>, ApiError> {
    match request(
        &state,
        DbOp::ReorderReminders {
            scheduled_date,
            ordered_ids,
        },
    )
    .await?
    {
        DbResponse::Reminders(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn get_daily_week(
    state: tauri::State<'_, AppState>,
    week_start: String,
) -> Result<DailyWeekDto, ApiError> {
    match request(&state, DbOp::GetDailyWeek { week_start }).await? {
        DbResponse::Daily(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewResult {
    active_node_count: i64,
}

#[tauri::command]
async fn preview_project_trash(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<PreviewResult, ApiError> {
    match request(&state, DbOp::PreviewProjectTrash { project_id }).await? {
        DbResponse::Preview { active_node_count } => Ok(PreviewResult { active_node_count }),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn trash_project(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<TrashEntryDto, ApiError> {
    match request(&state, DbOp::TrashProject { project_id }).await? {
        DbResponse::TrashEntry(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn trash_reminder(
    state: tauri::State<'_, AppState>,
    reminder_id: String,
) -> Result<TrashEntryDto, ApiError> {
    match request(&state, DbOp::TrashReminder { reminder_id }).await? {
        DbResponse::TrashEntry(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn list_trash(
    state: tauri::State<'_, AppState>,
    kind: String,
) -> Result<Vec<TrashEntryDto>, ApiError> {
    match request(&state, DbOp::ListTrash { kind }).await? {
        DbResponse::TrashEntries(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreResult {
    kind: String,
    restored_count: i64,
}

#[tauri::command]
async fn restore_trash_entry(
    state: tauri::State<'_, AppState>,
    entry_id: String,
) -> Result<RestoreResult, ApiError> {
    match request(&state, DbOp::RestoreTrashEntry { entry_id }).await? {
        DbResponse::RestoreTrash {
            kind,
            restored_count,
        } => Ok(RestoreResult {
            kind,
            restored_count,
        }),
        _ => Err(unexpected_response()),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteResult {
    deleted_project_count: i64,
    deleted_reminder_count: i64,
}

#[tauri::command]
async fn permanently_delete_trash_entry(
    state: tauri::State<'_, AppState>,
    entry_id: String,
) -> Result<DeleteResult, ApiError> {
    match request(&state, DbOp::PermanentlyDeleteTrashEntry { entry_id }).await? {
        DbResponse::DeleteTrash {
            deleted_project_count,
            deleted_reminder_count,
        } => Ok(DeleteResult {
            deleted_project_count,
            deleted_reminder_count,
        }),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn empty_trash(
    state: tauri::State<'_, AppState>,
    kind: String,
) -> Result<DeleteResult, ApiError> {
    match request(&state, DbOp::EmptyTrash { kind }).await? {
        DbResponse::DeleteTrash {
            deleted_project_count,
            deleted_reminder_count,
        } => Ok(DeleteResult {
            deleted_project_count,
            deleted_reminder_count,
        }),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn get_app_settings(state: tauri::State<'_, AppState>) -> Result<ThemeSettings, ApiError> {
    match request(&state, DbOp::GetAppSettings).await? {
        DbResponse::Theme(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
}

#[tauri::command]
async fn set_theme_mode(
    state: tauri::State<'_, AppState>,
    mode: String,
) -> Result<ThemeSettings, ApiError> {
    match request(&state, DbOp::SetThemeMode { mode }).await? {
        DbResponse::Theme(value) => Ok(value),
        _ => Err(unexpected_response()),
    }
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

fn initialize_db(app: &tauri::App) -> Result<DbHandle, ApiError> {
    let data_dir: PathBuf = app.path().app_data_dir().map_err(|error| {
        startup_error(
            ApiError::new("MIGRATION_ERROR", format!("无法取得应用数据目录: {error}")),
            None,
        )
    })?;
    let db_path = data_dir.join("branchtrace.sqlite3");
    if let Err(error) = std::fs::create_dir_all(&data_dir) {
        return Err(startup_error(
            ApiError::new("MIGRATION_ERROR", format!("无法创建应用数据目录: {error}")),
            Some(&db_path),
        ));
    }
    DbHandle::start(db_path.clone()).map_err(|error| startup_error(error, Some(&db_path)))
}

pub fn run() {
    let app = tauri::Builder::default()
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
            preview_project_trash,
            trash_project,
            trash_reminder,
            list_trash,
            restore_trash_entry,
            permanently_delete_trash_entry,
            empty_trash,
            get_app_settings,
            set_theme_mode
        ])
        .build(tauri::generate_context!())
        .expect("枝迹启动失败");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<AppState>() {
                state.shutdown();
            }
        }
    });
}
