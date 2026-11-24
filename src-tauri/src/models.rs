use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::Serialize;
use serde_json::Value;
use std::fmt;

#[derive(Debug)]
struct InvalidEnumValue(String);

impl fmt::Display for InvalidEnumValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for InvalidEnumValue {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    NotFound,
    InvalidTitle,
    InvalidDate,
    InvalidInput,
    FutureDateForbidden,
    ScheduleInPast,
    TerminalDateBeforeProgress,
    InvalidStatusTransition,
    VersionConflict,
    InvalidParent,
    ReorderMembershipMismatch,
    ParentInTrash,
    DbBusy,
    DbError,
    MigrationError,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl ApiError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemStatus {
    Active,
    Completed,
    Canceled,
}

impl ItemStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Completed => "completed",
            Self::Canceled => "canceled",
        }
    }
}

impl ToSql for ItemStatus {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for ItemStatus {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "active" => Ok(Self::Active),
            "completed" => Ok(Self::Completed),
            "canceled" => Ok(Self::Canceled),
            other => Err(FromSqlError::Other(Box::new(InvalidEnumValue(format!(
                "Invalid status value in database: {other}"
            ))))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalStatus {
    Completed,
    Canceled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReminderDisplayType {
    Planned,
    Completed,
    Overdue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TrashKind {
    Project,
    Reminder,
}

impl TrashKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Project => "project",
            Self::Reminder => "reminder",
        }
    }

    pub fn parse(value: &str) -> Result<Self, ApiError> {
        match value {
            "project" => Ok(Self::Project),
            "reminder" => Ok(Self::Reminder),
            _ => Err(ApiError::new(
                ErrorCode::InvalidInput,
                "Invalid trash category",
            )),
        }
    }
}

impl ToSql for TrashKind {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for TrashKind {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "project" => Ok(Self::Project),
            "reminder" => Ok(Self::Reminder),
            other => Err(FromSqlError::Other(Box::new(InvalidEnumValue(format!(
                "Invalid trash kind in database: {other}"
            ))))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Light,
    Dark,
    System,
}

impl ThemeMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Dark => "dark",
            Self::System => "system",
        }
    }

    pub fn parse(value: &str) -> Result<Self, ApiError> {
        match value {
            "light" => Ok(Self::Light),
            "dark" => Ok(Self::Dark),
            "system" => Ok(Self::System),
            _ => Err(ApiError::new(ErrorCode::InvalidInput, "Invalid theme mode")),
        }
    }
}

impl ToSql for ThemeMode {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for ThemeMode {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "light" => Ok(Self::Light),
            "dark" => Ok(Self::Dark),
            "system" => Ok(Self::System),
            other => Err(FromSqlError::Other(Box::new(InvalidEnumValue(format!(
                "Invalid theme mode in database: {other}"
            ))))),
        }
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
    pub status: ItemStatus,
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
    pub status: ItemStatus,
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
    pub status: ItemStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progressed_same_day: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderDailyItem {
    pub reminder: ReminderDto,
    pub display_type: ReminderDisplayType,
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
pub struct MonthDayDto {
    pub date: String,
    pub in_current_month: bool,
    pub completed_project_count: i64,
    pub progressed_project_count: i64,
    pub planned_reminders: Vec<ReminderDailyItem>,
    pub cross_day_completed_reminders: Vec<ReminderDailyItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthCalendarDto {
    pub month: String,
    pub grid_start: String,
    pub grid_end: String,
    pub today: String,
    pub overdue_reminders: Vec<ReminderDailyItem>,
    pub days: Vec<MonthDayDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntryDto {
    pub id: String,
    pub kind: TrashKind,
    pub root_entity_id: String,
    pub title_snapshot: String,
    pub deleted_at: String,
    pub affected_count_at_delete: i64,
    pub current_descendant_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    pub active_node_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub kind: TrashKind,
    pub restored_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    pub deleted_project_count: i64,
    pub deleted_reminder_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSettings {
    pub theme_mode: ThemeMode,
}

#[derive(Debug, Clone)]
pub struct ProjectRecord {
    pub id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub status: ItemStatus,
    pub completed_date: Option<String>,
    pub canceled_date: Option<String>,
    pub sort_order: i64,
    pub version: i64,
    pub is_expanded: bool,
}

#[derive(Debug, Clone)]
pub struct ReminderRecord {
    pub id: String,
    pub title: String,
    pub scheduled_date: String,
    pub status: ItemStatus,
    pub completed_date: Option<String>,
    pub completed_action_at: Option<String>,
    pub canceled_date: Option<String>,
    pub sort_order: i64,
    pub version: i64,
}
