use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use tokio::sync::oneshot;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl ApiError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("DB_ERROR", message)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockContext {
    pub today: String,
    pub week_start: String,
    pub time_zone_label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub status: String,
    pub completed_date: Option<String>,
    pub canceled_date: Option<String>,
    pub sort_order: i64,
    pub version: i64,
    pub is_expanded: bool,
    pub recent_progress_dates: Vec<String>,
    pub progress_count: i64,
    pub progressed_today: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetailDto {
    #[serde(flatten)]
    pub project: ProjectDto,
    pub parent_path: Vec<String>,
    pub progress_dates: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderDto {
    pub id: String,
    pub title: String,
    pub scheduled_date: String,
    pub status: String,
    pub completed_date: Option<String>,
    pub completed_action_at: Option<String>,
    pub canceled_date: Option<String>,
    pub sort_order: i64,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDailyItem {
    pub project_id: String,
    pub title: String,
    pub parent_path: Vec<String>,
    pub short_id: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progressed_same_day: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderDailyItem {
    pub reminder: ReminderDto,
    pub display_type: String,
    pub is_planned_and_completed_same_day: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyDayDto {
    pub date: String,
    pub completed_projects: Vec<ProjectDailyItem>,
    pub progressed_projects: Vec<ProjectDailyItem>,
    pub planned_reminders: Vec<ReminderDailyItem>,
    pub overdue_reminders: Vec<ReminderDailyItem>,
    pub cross_day_completed_reminders: Vec<ReminderDailyItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyWeekDto {
    pub week_start: String,
    pub today: String,
    pub days: Vec<DailyDayDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntryDto {
    pub id: String,
    pub kind: String,
    pub root_entity_id: String,
    pub title_snapshot: String,
    pub deleted_at: String,
    pub affected_count_at_delete: i64,
    pub current_descendant_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSettings {
    pub theme_mode: String,
}

#[derive(Debug, Clone)]
pub struct ProjectRecord {
    pub id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub status: String,
    pub completed_date: Option<String>,
    pub canceled_date: Option<String>,
    pub sort_order: i64,
    pub version: i64,
    pub is_expanded: bool,
    pub deleted_at: Option<String>,
    pub trash_entry_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ReminderRecord {
    pub id: String,
    pub title: String,
    pub scheduled_date: String,
    pub status: String,
    pub completed_date: Option<String>,
    pub completed_action_at: Option<String>,
    pub canceled_date: Option<String>,
    pub sort_order: i64,
    pub version: i64,
    pub deleted_at: Option<String>,
    pub trash_entry_id: Option<String>,
}

#[derive(Debug)]
pub struct DbRequest {
    pub op: DbOp,
    pub reply: oneshot::Sender<Result<DbResponse, ApiError>>,
}

#[derive(Debug)]
pub enum DbResponse {
    Unit,
    Project(ProjectDto),
    Projects(Vec<ProjectDto>),
    ProjectDetail(ProjectDetailDto),
    Dates(Vec<String>),
    Reminder(ReminderDto),
    Reminders(Vec<ReminderDto>),
    Daily(DailyWeekDto),
    Preview {
        active_node_count: i64,
    },
    TrashEntry(TrashEntryDto),
    TrashEntries(Vec<TrashEntryDto>),
    RestoreTrash {
        kind: String,
        restored_count: i64,
    },
    DeleteTrash {
        deleted_project_count: i64,
        deleted_reminder_count: i64,
    },
    Theme(ThemeSettings),
}

#[derive(Debug)]
pub enum DbOp {
    GetProjectTree,
    GetProjectDetail {
        project_id: String,
    },
    GetProjectProgressMonth {
        project_id: String,
        month: String,
    },
    CreateProject {
        title: String,
        parent_id: Option<String>,
    },
    RenameProject {
        project_id: String,
        title: String,
        expected_version: i64,
    },
    SetProjectExpanded {
        project_id: String,
        is_expanded: bool,
    },
    ReorderProjectSiblings {
        parent_id: Option<String>,
        ordered_ids: Vec<String>,
    },
    MoveProject {
        project_id: String,
        target_parent_id: Option<String>,
        expected_version: i64,
    },
    SetProjectProgress {
        project_id: String,
        date: Option<String>,
        present: bool,
        expected_version: i64,
    },
    CompleteProject {
        project_id: String,
        expected_version: i64,
    },
    CancelProject {
        project_id: String,
        expected_version: i64,
    },
    RestoreProject {
        project_id: String,
        expected_version: i64,
    },
    UpdateProjectTerminalDate {
        project_id: String,
        date: String,
        expected_version: i64,
    },
    GetReminder {
        reminder_id: String,
    },
    CreateReminder {
        title: String,
        scheduled_date: String,
    },
    RenameReminder {
        reminder_id: String,
        title: String,
        expected_version: i64,
    },
    UpdateReminderSchedule {
        reminder_id: String,
        scheduled_date: String,
        expected_version: i64,
    },
    CompleteReminder {
        reminder_id: String,
        expected_version: i64,
    },
    CancelReminder {
        reminder_id: String,
        expected_version: i64,
    },
    RestoreReminder {
        reminder_id: String,
        expected_version: i64,
    },
    UpdateReminderCompletedDate {
        reminder_id: String,
        date: String,
        expected_version: i64,
    },
    ReorderReminders {
        scheduled_date: String,
        ordered_ids: Vec<String>,
    },
    GetDailyWeek {
        week_start: String,
    },
    PreviewProjectTrash {
        project_id: String,
    },
    TrashProject {
        project_id: String,
    },
    TrashReminder {
        reminder_id: String,
    },
    ListTrash {
        kind: String,
    },
    RestoreTrashEntry {
        entry_id: String,
    },
    PermanentlyDeleteTrashEntry {
        entry_id: String,
    },
    EmptyTrash {
        kind: String,
    },
    GetAppSettings,
    SetThemeMode {
        mode: String,
    },
}

pub type ProgressMap = HashMap<String, Vec<String>>;
