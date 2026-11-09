use crate::models::*;
use chrono::{Datelike, Duration, Local, NaiveDate, Utc};
use rusqlite::{params, Connection, ErrorCode, OptionalExtension, Row, Transaction};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::mpsc as std_mpsc;
use std::thread;
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

#[derive(Clone)]
pub struct DbHandle {
    sender: mpsc::UnboundedSender<DbRequest>,
}

impl DbHandle {
    pub fn start(path: PathBuf) -> Result<Self, ApiError> {
        let (sender, mut receiver) = mpsc::unbounded_channel::<DbRequest>();
        let (ready_sender, ready_receiver) = std_mpsc::sync_channel::<Result<(), String>>(1);
        thread::Builder::new()
            .name("branchtrace-db".to_string())
            .spawn(move || match initialize_connection(&path) {
                Ok(mut connection) => {
                    let _ = ready_sender.send(Ok(()));
                    while let Some(request) = receiver.blocking_recv() {
                        let result = execute(&mut connection, request.op);
                        let _ = request.reply.send(result);
                    }
                }
                Err(error) => {
                    let _ = ready_sender.send(Err(error.message));
                }
            })
            .map_err(|error| ApiError::new("DB_ERROR", format!("无法启动数据库线程: {error}")))?;

        match ready_receiver.recv() {
            Ok(Ok(())) => Ok(Self { sender }),
            Ok(Err(message)) => Err(ApiError::new("MIGRATION_ERROR", message)),
            Err(error) => Err(ApiError::new(
                "DB_ERROR",
                format!("数据库线程启动失败: {error}"),
            )),
        }
    }

    pub async fn request(&self, op: DbOp) -> Result<DbResponse, ApiError> {
        let (reply, receiver) = oneshot::channel();
        self.sender
            .send(DbRequest { op, reply })
            .map_err(|_| ApiError::new("DB_ERROR", "数据库线程已经停止"))?;
        receiver
            .await
            .map_err(|_| ApiError::new("DB_ERROR", "数据库操作没有返回结果"))?
    }
}

fn initialize_connection(path: &PathBuf) -> Result<Connection, ApiError> {
    let connection = Connection::open(path).map_err(db_error)?;
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;\n         PRAGMA journal_mode = WAL;\n         PRAGMA synchronous = FULL;\n         PRAGMA busy_timeout = 5000;",
    ).map_err(db_error)?;

    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(db_error)?;
    match version {
        0 => connection
            .execute_batch(include_str!("../migrations/001_initial.sql"))
            .map_err(db_error)?,
        1 => {}
        other => {
            return Err(ApiError::new(
                "MIGRATION_ERROR",
                format!("不支持的数据库版本: {other}"),
            ))
        }
    }

    {
        let mut statement = connection
            .prepare("PRAGMA foreign_key_check")
            .map_err(db_error)?;
        let mut rows = statement.query([]).map_err(db_error)?;
        if rows.next().map_err(db_error)?.is_some() {
            return Err(ApiError::new("MIGRATION_ERROR", "数据库外键完整性检查失败"));
        }
    }
    Ok(connection)
}

fn execute(connection: &mut Connection, op: DbOp) -> Result<DbResponse, ApiError> {
    match op {
        DbOp::GetProjectTree => get_project_tree(connection),
        DbOp::GetProjectDetail { project_id } => get_project_detail(connection, &project_id),
        DbOp::GetProjectProgressMonth { project_id, month } => {
            get_project_progress_month(connection, &project_id, &month)
        }
        DbOp::CreateProject { title, parent_id } => create_project(connection, &title, parent_id),
        DbOp::RenameProject {
            project_id,
            title,
            expected_version,
        } => rename_project(connection, &project_id, &title, expected_version),
        DbOp::SetProjectExpanded {
            project_id,
            is_expanded,
        } => set_project_expanded(connection, &project_id, is_expanded),
        DbOp::ReorderProjectSiblings {
            parent_id,
            ordered_ids,
        } => reorder_project_siblings(connection, parent_id, ordered_ids),
        DbOp::MoveProject {
            project_id,
            target_parent_id,
            expected_version,
        } => move_project(connection, &project_id, target_parent_id, expected_version),
        DbOp::SetProjectProgress {
            project_id,
            date,
            present,
            expected_version,
        } => set_project_progress(connection, &project_id, date, present, expected_version),
        DbOp::CompleteProject {
            project_id,
            expected_version,
        } => set_project_terminal(connection, &project_id, expected_version, "completed"),
        DbOp::CancelProject {
            project_id,
            expected_version,
        } => set_project_terminal(connection, &project_id, expected_version, "canceled"),
        DbOp::RestoreProject {
            project_id,
            expected_version,
        } => restore_project(connection, &project_id, expected_version),
        DbOp::UpdateProjectTerminalDate {
            project_id,
            date,
            expected_version,
        } => update_project_terminal_date(connection, &project_id, &date, expected_version),
        DbOp::GetReminder { reminder_id } => get_reminder(connection, &reminder_id),
        DbOp::CreateReminder {
            title,
            scheduled_date,
        } => create_reminder(connection, &title, &scheduled_date),
        DbOp::RenameReminder {
            reminder_id,
            title,
            expected_version,
        } => rename_reminder(connection, &reminder_id, &title, expected_version),
        DbOp::UpdateReminderSchedule {
            reminder_id,
            scheduled_date,
            expected_version,
        } => update_reminder_schedule(connection, &reminder_id, &scheduled_date, expected_version),
        DbOp::CompleteReminder {
            reminder_id,
            expected_version,
        } => complete_reminder(connection, &reminder_id, expected_version),
        DbOp::CancelReminder {
            reminder_id,
            expected_version,
        } => cancel_reminder(connection, &reminder_id, expected_version),
        DbOp::RestoreReminder {
            reminder_id,
            expected_version,
        } => restore_reminder(connection, &reminder_id, expected_version),
        DbOp::UpdateReminderCompletedDate {
            reminder_id,
            date,
            expected_version,
        } => update_reminder_completed_date(connection, &reminder_id, &date, expected_version),
        DbOp::ReorderReminders {
            scheduled_date,
            ordered_ids,
        } => reorder_reminders(connection, &scheduled_date, ordered_ids),
        DbOp::GetDailyWeek { week_start } => get_daily_week(connection, &week_start),
        DbOp::PreviewProjectTrash { project_id } => preview_project_trash(connection, &project_id),
        DbOp::TrashProject { project_id } => trash_project(connection, &project_id),
        DbOp::TrashReminder { reminder_id } => trash_reminder(connection, &reminder_id),
        DbOp::ListTrash { kind } => list_trash(connection, &kind),
        DbOp::RestoreTrashEntry { entry_id } => restore_trash_entry(connection, &entry_id),
        DbOp::PermanentlyDeleteTrashEntry { entry_id } => {
            permanently_delete_trash_entry(connection, &entry_id)
        }
        DbOp::EmptyTrash { kind } => empty_trash(connection, &kind),
        DbOp::GetAppSettings => get_app_settings(connection),
        DbOp::SetThemeMode { mode } => set_theme_mode(connection, &mode),
    }
}

fn db_error(error: rusqlite::Error) -> ApiError {
    match &error {
        rusqlite::Error::SqliteFailure(code, _)
            if code.code == ErrorCode::DatabaseBusy || code.code == ErrorCode::DatabaseLocked =>
        {
            ApiError::new("DB_BUSY", "数据库当前繁忙，请稍后重试")
        }
        _ => ApiError::new("DB_ERROR", format!("数据库操作失败: {error}")),
    }
}

fn now_utc() -> String {
    Utc::now().to_rfc3339()
}

pub fn local_today() -> NaiveDate {
    Local::now().date_naive()
}

pub fn clock_context() -> ClockContext {
    let today = local_today();
    let week_start = today - Duration::days(today.weekday().num_days_from_monday() as i64);
    ClockContext {
        today: today.format("%Y-%m-%d").to_string(),
        week_start: week_start.format("%Y-%m-%d").to_string(),
        time_zone_label: Local::now().format("%Z").to_string(),
    }
}

fn parse_date(value: &str) -> Result<NaiveDate, ApiError> {
    let bytes = value.as_bytes();
    let valid_shape = bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit());
    if !valid_shape {
        return Err(ApiError::new("INVALID_DATE", format!("无效日期: {value}")));
    }
    let parsed = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| ApiError::new("INVALID_DATE", format!("无效日期: {value}")))?;
    if parsed.format("%Y-%m-%d").to_string() != value {
        return Err(ApiError::new("INVALID_DATE", format!("无效日期: {value}")));
    }
    Ok(parsed)
}

fn parse_month(value: &str) -> Result<NaiveDate, ApiError> {
    if value.len() != 7 {
        return Err(ApiError::new("INVALID_DATE", "月份必须使用 YYYY-MM 格式"));
    }
    parse_date(&format!("{value}-01"))
}

fn date_string(value: NaiveDate) -> String {
    value.format("%Y-%m-%d").to_string()
}

fn validate_title(title: &str) -> Result<String, ApiError> {
    let trimmed = title.trim();
    let length = trimmed.chars().count();
    if length == 0 || length > 500 {
        return Err(ApiError::new(
            "INVALID_TITLE",
            "名称不能为空，且长度不能超过 500 个字符",
        ));
    }
    Ok(trimmed.to_string())
}

fn version_error(expected: i64, actual: i64) -> ApiError {
    ApiError::new("VERSION_CONFLICT", "数据已经被其他操作修改，请刷新后重试")
        .with_details(serde_json::json!({ "expectedVersion": expected, "actualVersion": actual }))
}

fn check_version(expected: i64, actual: i64) -> Result<(), ApiError> {
    if expected == actual {
        Ok(())
    } else {
        Err(version_error(expected, actual))
    }
}

fn project_from_row(row: &Row<'_>) -> rusqlite::Result<ProjectRecord> {
    let expanded: i64 = row.get(8)?;
    Ok(ProjectRecord {
        id: row.get(0)?,
        parent_id: row.get(1)?,
        title: row.get(2)?,
        status: row.get(3)?,
        completed_date: row.get(4)?,
        canceled_date: row.get(5)?,
        sort_order: row.get(6)?,
        version: row.get(7)?,
        is_expanded: expanded != 0,
        deleted_at: row.get(9)?,
        trash_entry_id: row.get(10)?,
    })
}

fn reminder_from_row(row: &Row<'_>) -> rusqlite::Result<ReminderRecord> {
    Ok(ReminderRecord {
        id: row.get(0)?,
        title: row.get(1)?,
        scheduled_date: row.get(2)?,
        status: row.get(3)?,
        completed_date: row.get(4)?,
        completed_action_at: row.get(5)?,
        canceled_date: row.get(6)?,
        sort_order: row.get(7)?,
        version: row.get(8)?,
        deleted_at: row.get(9)?,
        trash_entry_id: row.get(10)?,
    })
}

fn load_project_records(
    connection: &Connection,
    include_deleted: bool,
) -> Result<Vec<ProjectRecord>, ApiError> {
    let sql = if include_deleted {
        "SELECT p.id,p.parent_id,p.title,p.status,p.completed_date,p.canceled_date,p.sort_order,p.version,COALESCE(u.is_expanded,1),p.deleted_at,p.trash_entry_id FROM projects p LEFT JOIN project_ui_states u ON u.project_id=p.id ORDER BY p.sort_order,p.id"
    } else {
        "SELECT p.id,p.parent_id,p.title,p.status,p.completed_date,p.canceled_date,p.sort_order,p.version,COALESCE(u.is_expanded,1),p.deleted_at,p.trash_entry_id FROM projects p LEFT JOIN project_ui_states u ON u.project_id=p.id WHERE p.deleted_at IS NULL ORDER BY p.sort_order,p.id"
    };
    let mut statement = connection.prepare(sql).map_err(db_error)?;
    let rows = statement
        .query_map([], project_from_row)
        .map_err(db_error)?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(db_error)?);
    }
    Ok(result)
}

fn project_record_by_id(
    connection: &Connection,
    id: &str,
    include_deleted: bool,
) -> Result<Option<ProjectRecord>, ApiError> {
    let sql = if include_deleted {
        "SELECT p.id,p.parent_id,p.title,p.status,p.completed_date,p.canceled_date,p.sort_order,p.version,COALESCE(u.is_expanded,1),p.deleted_at,p.trash_entry_id FROM projects p LEFT JOIN project_ui_states u ON u.project_id=p.id WHERE p.id=?1"
    } else {
        "SELECT p.id,p.parent_id,p.title,p.status,p.completed_date,p.canceled_date,p.sort_order,p.version,COALESCE(u.is_expanded,1),p.deleted_at,p.trash_entry_id FROM projects p LEFT JOIN project_ui_states u ON u.project_id=p.id WHERE p.id=?1 AND p.deleted_at IS NULL"
    };
    connection
        .query_row(sql, params![id], project_from_row)
        .optional()
        .map_err(db_error)
}

fn load_progress_map(connection: &Connection) -> Result<ProgressMap, ApiError> {
    let mut statement = connection
        .prepare("SELECT project_id,progress_date FROM progress_records ORDER BY progress_date,project_id")
        .map_err(db_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(db_error)?;
    let mut result: ProgressMap = HashMap::new();
    for row in rows {
        let (project_id, date) = row.map_err(db_error)?;
        result.entry(project_id).or_default().push(date);
    }
    Ok(result)
}

fn tree_order(records: &[ProjectRecord]) -> Vec<ProjectRecord> {
    let mut groups: HashMap<Option<String>, Vec<ProjectRecord>> = HashMap::new();
    for record in records {
        groups
            .entry(record.parent_id.clone())
            .or_default()
            .push(record.clone());
    }
    for children in groups.values_mut() {
        children.sort_by(|a, b| a.sort_order.cmp(&b.sort_order).then(a.id.cmp(&b.id)));
    }
    fn visit(
        parent: Option<String>,
        groups: &HashMap<Option<String>, Vec<ProjectRecord>>,
        out: &mut Vec<ProjectRecord>,
    ) {
        let children = groups.get(&parent).cloned().unwrap_or_default();
        for child in children {
            let id = child.id.clone();
            out.push(child);
            visit(Some(id), groups, out);
        }
    }
    let mut result = Vec::new();
    visit(None, &groups, &mut result);
    if result.len() != records.len() {
        let known: HashSet<String> = result.iter().map(|record| record.id.clone()).collect();
        for record in records {
            if !known.contains(&record.id) {
                result.push(record.clone());
            }
        }
    }
    result
}

fn project_dto(record: &ProjectRecord, progress: &ProgressMap) -> ProjectDto {
    let dates = progress.get(&record.id).cloned().unwrap_or_default();
    let mut recent = dates.iter().rev().take(3).cloned().collect::<Vec<_>>();
    recent.reverse();
    let today = date_string(local_today());
    ProjectDto {
        id: record.id.clone(),
        parent_id: record.parent_id.clone(),
        title: record.title.clone(),
        status: record.status.clone(),
        completed_date: record.completed_date.clone(),
        canceled_date: record.canceled_date.clone(),
        sort_order: record.sort_order,
        version: record.version,
        is_expanded: record.is_expanded,
        recent_progress_dates: recent,
        progress_count: dates.len() as i64,
        progressed_today: dates.iter().any(|date| date == &today),
    }
}

fn project_dto_by_id(connection: &Connection, id: &str) -> Result<ProjectDto, ApiError> {
    let record = project_record_by_id(connection, id, false)?
        .ok_or_else(|| ApiError::new("NOT_FOUND", "项目不存在"))?;
    let progress = load_progress_map(connection)?;
    Ok(project_dto(&record, &progress))
}

fn reminder_dto(record: &ReminderRecord) -> ReminderDto {
    ReminderDto {
        id: record.id.clone(),
        title: record.title.clone(),
        scheduled_date: record.scheduled_date.clone(),
        status: record.status.clone(),
        completed_date: record.completed_date.clone(),
        completed_action_at: record.completed_action_at.clone(),
        canceled_date: record.canceled_date.clone(),
        sort_order: record.sort_order,
        version: record.version,
    }
}

fn reminder_record_by_id(
    connection: &Connection,
    id: &str,
    include_deleted: bool,
) -> Result<Option<ReminderRecord>, ApiError> {
    let sql = if include_deleted {
        "SELECT id,title,scheduled_date,status,completed_date,completed_action_at,canceled_date,sort_order,version,deleted_at,trash_entry_id FROM reminders WHERE id=?1"
    } else {
        "SELECT id,title,scheduled_date,status,completed_date,completed_action_at,canceled_date,sort_order,version,deleted_at,trash_entry_id FROM reminders WHERE id=?1 AND deleted_at IS NULL"
    };
    connection
        .query_row(sql, params![id], reminder_from_row)
        .optional()
        .map_err(db_error)
}

fn next_project_sort(connection: &Connection, parent_id: Option<&str>) -> Result<i64, ApiError> {
    connection
        .query_row(
            "SELECT COALESCE(MAX(sort_order),0)+1024 FROM projects WHERE parent_id IS ?1 AND deleted_at IS NULL",
            params![parent_id],
            |row| row.get(0),
        )
        .map_err(db_error)
}

fn next_reminder_sort(connection: &Connection, date: &str) -> Result<i64, ApiError> {
    connection
        .query_row(
            "SELECT COALESCE(MAX(sort_order),0)+1024 FROM reminders WHERE scheduled_date=?1 AND deleted_at IS NULL",
            params![date],
            |row| row.get(0),
        )
        .map_err(db_error)
}

fn get_project_tree(connection: &Connection) -> Result<DbResponse, ApiError> {
    let records = load_project_records(connection, false)?;
    let progress = load_progress_map(connection)?;
    let ordered = tree_order(&records);
    Ok(DbResponse::Projects(
        ordered
            .iter()
            .map(|record| project_dto(record, &progress))
            .collect(),
    ))
}

fn get_project_detail(connection: &Connection, project_id: &str) -> Result<DbResponse, ApiError> {
    let records = load_project_records(connection, false)?;
    let record = records
        .iter()
        .find(|record| record.id == project_id)
        .ok_or_else(|| ApiError::new("NOT_FOUND", "项目不存在"))?;
    let progress = load_progress_map(connection)?;
    let by_id: HashMap<String, ProjectRecord> = records
        .iter()
        .cloned()
        .map(|record| (record.id.clone(), record))
        .collect();
    let mut path = Vec::new();
    let mut parent = record.parent_id.clone();
    let mut guard = 0;
    while let Some(parent_id) = parent {
        guard += 1;
        if guard > records.len() + 1 {
            return Err(ApiError::new("DB_ERROR", "项目树关系存在循环"));
        }
        if let Some(parent_record) = by_id.get(&parent_id) {
            path.push(parent_record.title.clone());
            parent = parent_record.parent_id.clone();
        } else {
            break;
        }
    }
    path.reverse();
    let dates = progress.get(project_id).cloned().unwrap_or_default();
    Ok(DbResponse::ProjectDetail(ProjectDetailDto {
        project: project_dto(record, &progress),
        parent_path: path,
        progress_dates: dates,
    }))
}

fn get_project_progress_month(
    connection: &Connection,
    project_id: &str,
    month: &str,
) -> Result<DbResponse, ApiError> {
    parse_month(month)?;
    if project_record_by_id(connection, project_id, false)?.is_none() {
        return Err(ApiError::new("NOT_FOUND", "项目不存在"));
    }
    let progress = load_progress_map(connection)?;
    Ok(DbResponse::Dates(
        progress
            .get(project_id)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|date| date.starts_with(month))
            .collect(),
    ))
}

fn create_project(
    connection: &mut Connection,
    title: &str,
    parent_id: Option<String>,
) -> Result<DbResponse, ApiError> {
    let title = validate_title(title)?;
    if let Some(parent) = parent_id.as_deref() {
        if project_record_by_id(connection, parent, false)?.is_none() {
            return Err(ApiError::new("INVALID_PARENT", "父项目不存在或已在回收站"));
        }
    }
    let sort_order = next_project_sort(connection, parent_id.as_deref())?;
    let id = Uuid::new_v4().to_string();
    let now = now_utc();
    let tx = connection.transaction().map_err(db_error)?;
    tx.execute(
        "INSERT INTO projects(id,parent_id,title,status,sort_order,version,created_at,updated_at) VALUES(?1,?2,?3,'active',?4,0,?5,?5)",
        params![id, parent_id, title, sort_order, now],
    ).map_err(db_error)?;
    tx.execute(
        "INSERT INTO project_ui_states(project_id,is_expanded) VALUES(?1,1)",
        params![id],
    )
    .map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    Ok(DbResponse::Project(project_dto_by_id(connection, &id)?))
}

fn rename_project(
    connection: &mut Connection,
    project_id: &str,
    title: &str,
    expected_version: i64,
) -> Result<DbResponse, ApiError> {
    let title = validate_title(title)?;
    let record = project_record_by_id(connection, project_id, false)?
        .ok_or_else(|| ApiError::new("NOT_FOUND", "项目不存在"))?;
    check_version(expected_version, record.version)?;
    let now = now_utc();
    let tx = connection.transaction().map_err(db_error)?;
    tx.execute("UPDATE projects SET title=?1,version=version+1,updated_at=?2 WHERE id=?3 AND deleted_at IS NULL", params![title, now, project_id]).map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    Ok(DbResponse::Project(project_dto_by_id(
        connection, project_id,
    )?))
}

fn set_project_expanded(
    connection: &mut Connection,
    project_id: &str,
    is_expanded: bool,
) -> Result<DbResponse, ApiError> {
    if project_record_by_id(connection, project_id, false)?.is_none() {
        return Err(ApiError::new("NOT_FOUND", "项目不存在"));
    }
    connection.execute(
        "INSERT INTO project_ui_states(project_id,is_expanded) VALUES(?1,?2) ON CONFLICT(project_id) DO UPDATE SET is_expanded=excluded.is_expanded",
        params![project_id, if is_expanded { 1 } else { 0 }],
    ).map_err(db_error)?;
    Ok(DbResponse::Project(project_dto_by_id(
        connection, project_id,
    )?))
}

fn reorder_project_siblings(
    connection: &mut Connection,
    parent_id: Option<String>,
    ordered_ids: Vec<String>,
) -> Result<DbResponse, ApiError> {
    let records = load_project_records(connection, false)?;
    let mut current: Vec<String> = records
        .iter()
        .filter(|record| record.parent_id == parent_id)
        .map(|record| record.id.clone())
        .collect();
    current.sort();
    let mut supplied = ordered_ids.clone();
    supplied.sort();
    if current != supplied || ordered_ids.len() != current.len() {
        return Err(ApiError::new(
            "REORDER_MEMBERSHIP_MISMATCH",
            "排序列表必须包含同一层级的全部项目",
        ));
    }
    let tx = connection.transaction().map_err(db_error)?;
    for (index, id) in ordered_ids.iter().enumerate() {
        tx.execute("UPDATE projects SET sort_order=?1,version=version+1,updated_at=?2 WHERE id=?3 AND deleted_at IS NULL", params![(index as i64 + 1) * 1024, now_utc(), id]).map_err(db_error)?;
    }
    tx.commit().map_err(db_error)?;
    let progress = load_progress_map(connection)?;
    let mut result = Vec::new();
    for id in ordered_ids {
        if let Some(record) = project_record_by_id(connection, &id, false)? {
            result.push(project_dto(&record, &progress));
        }
    }
    Ok(DbResponse::Projects(result))
}

fn move_project(
    connection: &mut Connection,
    project_id: &str,
    target_parent_id: Option<String>,
    expected_version: i64,
) -> Result<DbResponse, ApiError> {
    let records = load_project_records(connection, false)?;
    let source = records
        .iter()
        .find(|record| record.id == project_id)
        .ok_or_else(|| ApiError::new("NOT_FOUND", "项目不存在"))?;
    check_version(expected_version, source.version)?;
    if let Some(target) = target_parent_id.as_deref() {
        if records.iter().all(|record| record.id != target) {
            return Err(ApiError::new(
                "INVALID_PARENT",
                "目标项目不存在或已在回收站",
            ));
        }
        let mut current = Some(target.to_string());
        while let Some(id) = current {
            if id == project_id {
                return Err(ApiError::new("INVALID_PARENT", "不能移动到自身或后代项目"));
            }
            current = records
                .iter()
                .find(|record| record.id == id)
                .and_then(|record| record.parent_id.clone());
        }
    }
    let sort_order = next_project_sort(connection, target_parent_id.as_deref())?;
    let tx = connection.transaction().map_err(db_error)?;
    tx.execute("UPDATE projects SET parent_id=?1,sort_order=?2,version=version+1,updated_at=?3 WHERE id=?4 AND deleted_at IS NULL", params![target_parent_id, sort_order, now_utc(), project_id]).map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    Ok(DbResponse::Project(project_dto_by_id(
        connection, project_id,
    )?))
}

fn set_project_progress(
    connection: &mut Connection,
    project_id: &str,
    requested_date: Option<String>,
    present: bool,
    expected_version: i64,
) -> Result<DbResponse, ApiError> {
    let record = project_record_by_id(connection, project_id, false)?
        .ok_or_else(|| ApiError::new("NOT_FOUND", "项目不存在"))?;
    check_version(expected_version, record.version)?;
    let today = local_today();
    let date = match requested_date {
        Some(value) => {
            parse_date(&value)?;
            value
        }
        None => date_string(today),
    };
    let parsed = parse_date(&date)?;
    let tx = connection.transaction().map_err(db_error)?;
    let changed = if present {
        if record.status != "active" {
            return Err(ApiError::new(
                "INVALID_STATUS_TRANSITION",
                "终止状态的项目不能新增推进",
            ));
        }
        if parsed > today {
            return Err(ApiError::new(
                "FUTURE_DATE_FORBIDDEN",
                "不能新增未来日期的推进",
            ));
        }
        tx.execute("INSERT OR IGNORE INTO progress_records(project_id,progress_date,created_at) VALUES(?1,?2,?3)", params![project_id, date, now_utc()]).map_err(db_error)? > 0
    } else {
        tx.execute(
            "DELETE FROM progress_records WHERE project_id=?1 AND progress_date=?2",
            params![project_id, date],
        )
        .map_err(db_error)?
            > 0
    };
    if changed {
        tx.execute(
            "UPDATE projects SET version=version+1,updated_at=?1 WHERE id=?2",
            params![now_utc(), project_id],
        )
        .map_err(db_error)?;
    }
    tx.commit().map_err(db_error)?;
    Ok(DbResponse::Project(project_dto_by_id(
        connection, project_id,
    )?))
}

fn set_project_terminal(
    connection: &mut Connection,
    project_id: &str,
    expected_version: i64,
    status: &str,
) -> Result<DbResponse, ApiError> {
    let record = project_record_by_id(connection, project_id, false)?
        .ok_or_else(|| ApiError::new("NOT_FOUND", "项目不存在"))?;
    check_version(expected_version, record.version)?;
    if record.status != "active" {
        return Err(ApiError::new(
            "INVALID_STATUS_TRANSITION",
            "只有 active 项目可以完成或取消",
        ));
    }
    let today = date_string(local_today());
    let latest: Option<String> = connection
        .query_row(
            "SELECT MAX(progress_date) FROM progress_records WHERE project_id=?1",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if latest.as_deref().is_some_and(|date| date > today.as_str()) {
        return Err(ApiError::new(
            "TERMINAL_DATE_BEFORE_PROGRESS",
            "终止日期不能早于最后推进日期",
        ));
    }
    let tx = connection.transaction().map_err(db_error)?;
    if status == "completed" {
        tx.execute("UPDATE projects SET status='completed',completed_date=?1,canceled_date=NULL,version=version+1,updated_at=?2 WHERE id=?3", params![today, now_utc(), project_id]).map_err(db_error)?;
    } else {
        tx.execute("UPDATE projects SET status='canceled',completed_date=NULL,canceled_date=?1,version=version+1,updated_at=?2 WHERE id=?3", params![today, now_utc(), project_id]).map_err(db_error)?;
    }
    tx.commit().map_err(db_error)?;
    Ok(DbResponse::Project(project_dto_by_id(
        connection, project_id,
    )?))
}

fn restore_project(
    connection: &mut Connection,
    project_id: &str,
    expected_version: i64,
) -> Result<DbResponse, ApiError> {
    let record = project_record_by_id(connection, project_id, false)?
        .ok_or_else(|| ApiError::new("NOT_FOUND", "项目不存在"))?;
    check_version(expected_version, record.version)?;
    if record.status == "active" {
        return Err(ApiError::new(
            "INVALID_STATUS_TRANSITION",
            "项目已经是 active 状态",
        ));
    }
    let tx = connection.transaction().map_err(db_error)?;
    tx.execute("UPDATE projects SET status='active',completed_date=NULL,canceled_date=NULL,version=version+1,updated_at=?1 WHERE id=?2", params![now_utc(), project_id]).map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    Ok(DbResponse::Project(project_dto_by_id(
        connection, project_id,
    )?))
}

fn update_project_terminal_date(
    connection: &mut Connection,
    project_id: &str,
    date: &str,
    expected_version: i64,
) -> Result<DbResponse, ApiError> {
    let record = project_record_by_id(connection, project_id, false)?
        .ok_or_else(|| ApiError::new("NOT_FOUND", "项目不存在"))?;
    check_version(expected_version, record.version)?;
    if record.status == "active" {
        return Err(ApiError::new(
            "INVALID_STATUS_TRANSITION",
            "active 项目没有终止日期",
        ));
    }
    let requested = parse_date(date)?;
    if requested > local_today() {
        return Err(ApiError::new(
            "FUTURE_DATE_FORBIDDEN",
            "终止日期不能是未来日期",
        ));
    }
    let latest: Option<String> = connection
        .query_row(
            "SELECT MAX(progress_date) FROM progress_records WHERE project_id=?1",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if latest.as_deref().is_some_and(|last| last > date) {
        return Err(ApiError::new(
            "TERMINAL_DATE_BEFORE_PROGRESS",
            "终止日期不能早于最后推进日期",
        ));
    }
    let tx = connection.transaction().map_err(db_error)?;
    if record.status == "completed" {
        tx.execute(
            "UPDATE projects SET completed_date=?1,version=version+1,updated_at=?2 WHERE id=?3",
            params![date, now_utc(), project_id],
        )
        .map_err(db_error)?;
    } else {
        tx.execute(
            "UPDATE projects SET canceled_date=?1,version=version+1,updated_at=?2 WHERE id=?3",
            params![date, now_utc(), project_id],
        )
        .map_err(db_error)?;
    }
    tx.commit().map_err(db_error)?;
    let _ = requested;
    Ok(DbResponse::Project(project_dto_by_id(
        connection, project_id,
    )?))
}

fn get_reminder(connection: &Connection, reminder_id: &str) -> Result<DbResponse, ApiError> {
    let record = reminder_record_by_id(connection, reminder_id, false)?
        .ok_or_else(|| ApiError::new("NOT_FOUND", "提醒不存在"))?;
    Ok(DbResponse::Reminder(reminder_dto(&record)))
}

fn create_reminder(
    connection: &mut Connection,
    title: &str,
    scheduled_date: &str,
) -> Result<DbResponse, ApiError> {
    let title = validate_title(title)?;
    let date = parse_date(scheduled_date)?;
    if date < local_today() {
        return Err(ApiError::new(
            "SCHEDULE_IN_PAST",
            "计划日期必须是今天或未来",
        ));
    }
    let sort_order = next_reminder_sort(connection, scheduled_date)?;
    let id = Uuid::new_v4().to_string();
    let now = now_utc();
    let tx = connection.transaction().map_err(db_error)?;
    tx.execute("INSERT INTO reminders(id,title,scheduled_date,status,sort_order,version,created_at,updated_at) VALUES(?1,?2,?3,'active',?4,0,?5,?5)", params![id, title, scheduled_date, sort_order, now]).map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    Ok(DbResponse::Reminder(reminder_dto(
        &reminder_record_by_id(connection, &id, false)?
            .ok_or_else(|| ApiError::new("DB_ERROR", "创建提醒后无法读取"))?,
    )))
}

fn rename_reminder(
    connection: &mut Connection,
    reminder_id: &str,
    title: &str,
    expected_version: i64,
) -> Result<DbResponse, ApiError> {
    let title = validate_title(title)?;
    let record = reminder_record_by_id(connection, reminder_id, false)?
        .ok_or_else(|| ApiError::new("NOT_FOUND", "提醒不存在"))?;
    check_version(expected_version, record.version)?;
    let tx = connection.transaction().map_err(db_error)?;
    tx.execute("UPDATE reminders SET title=?1,version=version+1,updated_at=?2 WHERE id=?3 AND deleted_at IS NULL", params![title, now_utc(), reminder_id]).map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    get_reminder(connection, reminder_id)
}

fn update_reminder_schedule(
    connection: &mut Connection,
    reminder_id: &str,
    scheduled_date: &str,
    expected_version: i64,
) -> Result<DbResponse, ApiError> {
    let record = reminder_record_by_id(connection, reminder_id, false)?
        .ok_or_else(|| ApiError::new("NOT_FOUND", "提醒不存在"))?;
    check_version(expected_version, record.version)?;
    let date = parse_date(scheduled_date)?;
    if date < local_today() {
        return Err(ApiError::new(
            "SCHEDULE_IN_PAST",
            "计划日期必须是今天或未来",
        ));
    }
    let sort_order = next_reminder_sort(connection, scheduled_date)?;
    let tx = connection.transaction().map_err(db_error)?;
    tx.execute("UPDATE reminders SET scheduled_date=?1,sort_order=?2,version=version+1,updated_at=?3 WHERE id=?4 AND deleted_at IS NULL", params![scheduled_date, sort_order, now_utc(), reminder_id]).map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    get_reminder(connection, reminder_id)
}

fn complete_reminder(
    connection: &mut Connection,
    reminder_id: &str,
    expected_version: i64,
) -> Result<DbResponse, ApiError> {
    let record = reminder_record_by_id(connection, reminder_id, false)?
        .ok_or_else(|| ApiError::new("NOT_FOUND", "提醒不存在"))?;
    check_version(expected_version, record.version)?;
    if record.status != "active" {
        return Err(ApiError::new(
            "INVALID_STATUS_TRANSITION",
            "只有 active 提醒可以完成",
        ));
    }
    let today = date_string(local_today());
    let tx = connection.transaction().map_err(db_error)?;
    tx.execute("UPDATE reminders SET status='completed',completed_date=?1,completed_action_at=?2,canceled_date=NULL,version=version+1,updated_at=?2 WHERE id=?3", params![today, now_utc(), reminder_id]).map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    get_reminder(connection, reminder_id)
}

fn cancel_reminder(
    connection: &mut Connection,
    reminder_id: &str,
    expected_version: i64,
) -> Result<DbResponse, ApiError> {
    let record = reminder_record_by_id(connection, reminder_id, false)?
        .ok_or_else(|| ApiError::new("NOT_FOUND", "提醒不存在"))?;
    check_version(expected_version, record.version)?;
    if record.status != "active" {
        return Err(ApiError::new(
            "INVALID_STATUS_TRANSITION",
            "只有 active 提醒可以取消",
        ));
    }
    let tx = connection.transaction().map_err(db_error)?;
    tx.execute("UPDATE reminders SET status='canceled',completed_date=NULL,completed_action_at=NULL,canceled_date=?1,version=version+1,updated_at=?2 WHERE id=?3", params![date_string(local_today()), now_utc(), reminder_id]).map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    get_reminder(connection, reminder_id)
}

fn restore_reminder(
    connection: &mut Connection,
    reminder_id: &str,
    expected_version: i64,
) -> Result<DbResponse, ApiError> {
    let record = reminder_record_by_id(connection, reminder_id, false)?
        .ok_or_else(|| ApiError::new("NOT_FOUND", "提醒不存在"))?;
    check_version(expected_version, record.version)?;
    if record.status == "active" {
        return Err(ApiError::new(
            "INVALID_STATUS_TRANSITION",
            "提醒已经是 active 状态",
        ));
    }
    let tx = connection.transaction().map_err(db_error)?;
    tx.execute("UPDATE reminders SET status='active',completed_date=NULL,completed_action_at=NULL,canceled_date=NULL,version=version+1,updated_at=?1 WHERE id=?2", params![now_utc(), reminder_id]).map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    get_reminder(connection, reminder_id)
}

fn update_reminder_completed_date(
    connection: &mut Connection,
    reminder_id: &str,
    date: &str,
    expected_version: i64,
) -> Result<DbResponse, ApiError> {
    let record = reminder_record_by_id(connection, reminder_id, false)?
        .ok_or_else(|| ApiError::new("NOT_FOUND", "提醒不存在"))?;
    check_version(expected_version, record.version)?;
    if record.status != "completed" {
        return Err(ApiError::new(
            "INVALID_STATUS_TRANSITION",
            "只有已完成提醒可以修改完成日期",
        ));
    }
    let requested = parse_date(date)?;
    if requested > local_today() {
        return Err(ApiError::new(
            "FUTURE_DATE_FORBIDDEN",
            "完成日期不能是未来日期",
        ));
    }
    let tx = connection.transaction().map_err(db_error)?;
    tx.execute(
        "UPDATE reminders SET completed_date=?1,version=version+1,updated_at=?2 WHERE id=?3",
        params![date, now_utc(), reminder_id],
    )
    .map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    let _ = requested;
    get_reminder(connection, reminder_id)
}

fn reorder_reminders(
    connection: &mut Connection,
    scheduled_date: &str,
    ordered_ids: Vec<String>,
) -> Result<DbResponse, ApiError> {
    parse_date(scheduled_date)?;
    let current: Vec<String> = {
        let mut statement = connection.prepare("SELECT id FROM reminders WHERE scheduled_date=?1 AND deleted_at IS NULL ORDER BY sort_order,id").map_err(db_error)?;
        let rows = statement
            .query_map(params![scheduled_date], |row| row.get::<_, String>(0))
            .map_err(db_error)?;
        let mut values = Vec::new();
        for row in rows {
            values.push(row.map_err(db_error)?);
        }
        values
    };
    let mut expected = current.clone();
    let mut supplied = ordered_ids.clone();
    expected.sort();
    supplied.sort();
    if expected != supplied || current.len() != ordered_ids.len() {
        return Err(ApiError::new(
            "REORDER_MEMBERSHIP_MISMATCH",
            "排序列表必须包含该计划日的全部提醒",
        ));
    }
    let tx = connection.transaction().map_err(db_error)?;
    for (index, id) in ordered_ids.iter().enumerate() {
        tx.execute("UPDATE reminders SET sort_order=?1,version=version+1,updated_at=?2 WHERE id=?3 AND scheduled_date=?4 AND deleted_at IS NULL", params![(index as i64 + 1) * 1024, now_utc(), id, scheduled_date]).map_err(db_error)?;
    }
    tx.commit().map_err(db_error)?;
    let mut result = Vec::new();
    for id in ordered_ids {
        if let Some(record) = reminder_record_by_id(connection, &id, false)? {
            result.push(reminder_dto(&record));
        }
    }
    Ok(DbResponse::Reminders(result))
}

fn project_parent_paths(records: &[ProjectRecord]) -> HashMap<String, Vec<String>> {
    let by_id: HashMap<String, ProjectRecord> = records
        .iter()
        .cloned()
        .map(|record| (record.id.clone(), record))
        .collect();
    let mut paths = HashMap::new();
    for record in records {
        let mut path = Vec::new();
        let mut parent = record.parent_id.clone();
        let mut guard = 0;
        while let Some(id) = parent {
            guard += 1;
            if guard > records.len() + 1 {
                break;
            }
            if let Some(parent_record) = by_id.get(&id) {
                path.push(parent_record.title.clone());
                parent = parent_record.parent_id.clone();
            } else {
                break;
            }
        }
        path.reverse();
        paths.insert(record.id.clone(), path);
    }
    paths
}

fn get_daily_week(connection: &Connection, week_start: &str) -> Result<DbResponse, ApiError> {
    let start = parse_date(week_start)?;
    if start.weekday().number_from_monday() != 1 {
        return Err(ApiError::new("INVALID_DATE", "Daily 周起始日必须是周一"));
    }
    let today = local_today();
    let mut dates = Vec::with_capacity(7);
    for offset in 0..7 {
        let day = start
            .checked_add_signed(Duration::days(offset))
            .ok_or_else(|| ApiError::new("INVALID_DATE", "Daily 周范围超出可支持的日期范围"))?;
        dates.push(date_string(day));
    }
    let records = load_project_records(connection, false)?;
    let ordered_records = tree_order(&records);
    let progress = load_progress_map(connection)?;
    let paths = project_parent_paths(&records);
    let mut days: Vec<DailyDayDto> = dates
        .iter()
        .map(|date| DailyDayDto {
            date: date.clone(),
            completed_projects: Vec::new(),
            progressed_projects: Vec::new(),
            planned_reminders: Vec::new(),
            overdue_reminders: Vec::new(),
            cross_day_completed_reminders: Vec::new(),
        })
        .collect();
    let day_indexes: HashMap<String, usize> = dates
        .iter()
        .cloned()
        .enumerate()
        .map(|(index, date)| (date, index))
        .collect();
    let mut completed_positions: HashMap<(usize, String), usize> = HashMap::new();

    for record in &ordered_records {
        if let Some(completed_date) = &record.completed_date {
            if let Some(&index) = day_indexes.get(completed_date) {
                let item = ProjectDailyItem {
                    project_id: record.id.clone(),
                    title: record.title.clone(),
                    parent_path: paths.get(&record.id).cloned().unwrap_or_default(),
                    short_id: None,
                    status: record.status.clone(),
                    progressed_same_day: Some(false),
                };
                completed_positions.insert(
                    (index, record.id.clone()),
                    days[index].completed_projects.len(),
                );
                days[index].completed_projects.push(item);
            }
        }
        if let Some(project_dates) = progress.get(&record.id) {
            for progress_date in project_dates {
                if let Some(&index) = day_indexes.get(progress_date) {
                    if let Some(&position) = completed_positions.get(&(index, record.id.clone())) {
                        days[index].completed_projects[position].progressed_same_day = Some(true);
                    } else {
                        days[index].progressed_projects.push(ProjectDailyItem {
                            project_id: record.id.clone(),
                            title: record.title.clone(),
                            parent_path: paths.get(&record.id).cloned().unwrap_or_default(),
                            short_id: None,
                            status: record.status.clone(),
                            progressed_same_day: None,
                        });
                    }
                }
            }
        }
    }

    let reminders = load_reminder_records(connection)?;
    for record in reminders {
        let reminder = reminder_dto(&record);
        if let Some(&index) = day_indexes.get(&record.scheduled_date) {
            days[index].planned_reminders.push(ReminderDailyItem {
                reminder: reminder.clone(),
                display_type: "planned".to_string(),
                is_planned_and_completed_same_day: record.status == "completed"
                    && record.completed_date.as_deref() == Some(record.scheduled_date.as_str()),
            });
        }
        if record.status == "completed" {
            if let Some(completed_date) = &record.completed_date {
                if completed_date != &record.scheduled_date {
                    if let Some(&index) = day_indexes.get(completed_date) {
                        days[index]
                            .cross_day_completed_reminders
                            .push(ReminderDailyItem {
                                reminder: reminder.clone(),
                                display_type: "completed".to_string(),
                                is_planned_and_completed_same_day: false,
                            });
                    }
                }
            }
        }
        if record.status == "active"
            && record.scheduled_date < date_string(today)
            && dates.iter().any(|date| date == &date_string(today))
        {
            let today_index = dates
                .iter()
                .position(|date| date == &date_string(today))
                .unwrap();
            days[today_index].overdue_reminders.push(ReminderDailyItem {
                reminder,
                display_type: "overdue".to_string(),
                is_planned_and_completed_same_day: false,
            });
        }
    }

    for day in &mut days {
        day.completed_projects
            .sort_by(|a, b| a.title.cmp(&b.title).then(a.project_id.cmp(&b.project_id)));
        day.progressed_projects
            .sort_by(|a, b| a.title.cmp(&b.title).then(a.project_id.cmp(&b.project_id)));
        day.planned_reminders.sort_by(|a, b| {
            a.reminder
                .sort_order
                .cmp(&b.reminder.sort_order)
                .then(a.reminder.id.cmp(&b.reminder.id))
        });
        day.overdue_reminders.sort_by(|a, b| {
            a.reminder
                .scheduled_date
                .cmp(&b.reminder.scheduled_date)
                .then(a.reminder.sort_order.cmp(&b.reminder.sort_order))
                .then(a.reminder.id.cmp(&b.reminder.id))
        });
        day.cross_day_completed_reminders.sort_by(|a, b| {
            a.reminder
                .completed_action_at
                .cmp(&b.reminder.completed_action_at)
                .then(a.reminder.id.cmp(&b.reminder.id))
        });
        apply_short_ids(&mut day.completed_projects, &mut day.progressed_projects);
    }
    Ok(DbResponse::Daily(DailyWeekDto {
        week_start: week_start.to_string(),
        today: date_string(today),
        days,
    }))
}

fn apply_short_ids(completed: &mut [ProjectDailyItem], progressed: &mut [ProjectDailyItem]) {
    let mut groups: HashMap<(Vec<String>, String), Vec<String>> = HashMap::new();
    for item in completed.iter().chain(progressed.iter()) {
        groups
            .entry((item.parent_path.clone(), item.title.clone()))
            .or_default()
            .push(item.project_id.clone());
    }
    for item in completed.iter_mut().chain(progressed.iter_mut()) {
        let key = (item.parent_path.clone(), item.title.clone());
        let Some(ids) = groups.get(&key) else {
            continue;
        };
        if ids.len() <= 1 {
            continue;
        }
        let id_chars: Vec<char> = item.project_id.chars().collect();
        let mut chosen = item.project_id.clone();
        for length in 1..=id_chars.len() {
            let prefix: String = id_chars.iter().take(length).collect();
            let matches = ids
                .iter()
                .filter(|other| other.chars().take(length).collect::<String>() == prefix)
                .count();
            if matches == 1 {
                chosen = prefix;
                break;
            }
        }
        item.short_id = Some(chosen);
    }
}

fn load_reminder_records(connection: &Connection) -> Result<Vec<ReminderRecord>, ApiError> {
    let mut statement = connection.prepare("SELECT id,title,scheduled_date,status,completed_date,completed_action_at,canceled_date,sort_order,version,deleted_at,trash_entry_id FROM reminders WHERE deleted_at IS NULL ORDER BY scheduled_date,sort_order,id").map_err(db_error)?;
    let rows = statement
        .query_map([], reminder_from_row)
        .map_err(db_error)?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(db_error)?);
    }
    Ok(result)
}

fn descendant_ids(connection: &Connection, root_id: &str) -> Result<Vec<String>, ApiError> {
    let mut statement = connection.prepare("WITH RECURSIVE descendants(id) AS (SELECT id FROM projects WHERE id=?1 UNION ALL SELECT p.id FROM projects p JOIN descendants d ON p.parent_id=d.id) SELECT id FROM descendants").map_err(db_error)?;
    let rows = statement
        .query_map(params![root_id], |row| row.get::<_, String>(0))
        .map_err(db_error)?;
    let mut ids = Vec::new();
    for row in rows {
        ids.push(row.map_err(db_error)?);
    }
    Ok(ids)
}

fn trash_entry_from_row(row: &Row<'_>) -> rusqlite::Result<TrashEntryDto> {
    Ok(TrashEntryDto {
        id: row.get(0)?,
        kind: row.get(1)?,
        root_entity_id: row.get(2)?,
        title_snapshot: row.get(3)?,
        deleted_at: row.get(4)?,
        affected_count_at_delete: row.get(5)?,
        current_descendant_count: row.get(6)?,
    })
}

fn trash_entry_by_id(
    connection: &Connection,
    entry_id: &str,
) -> Result<Option<TrashEntryDto>, ApiError> {
    connection.query_row("SELECT id,kind,root_entity_id,title_snapshot,deleted_at,affected_count,NULL FROM trash_entries WHERE id=?1", params![entry_id], trash_entry_from_row).optional().map_err(db_error)
}

fn preview_project_trash(
    connection: &Connection,
    project_id: &str,
) -> Result<DbResponse, ApiError> {
    if project_record_by_id(connection, project_id, false)?.is_none() {
        return Err(ApiError::new("NOT_FOUND", "项目不存在"));
    }
    let ids = descendant_ids(connection, project_id)?;
    let records = load_project_records(connection, true)?;
    let active = ids
        .iter()
        .filter(|id| {
            records
                .iter()
                .any(|record| &record.id == *id && record.deleted_at.is_none())
        })
        .count() as i64;
    Ok(DbResponse::Preview {
        active_node_count: active,
    })
}

fn trash_project(connection: &mut Connection, project_id: &str) -> Result<DbResponse, ApiError> {
    let root = project_record_by_id(connection, project_id, false)?
        .ok_or_else(|| ApiError::new("NOT_FOUND", "项目不存在"))?;
    let ids = descendant_ids(connection, project_id)?;
    let records = load_project_records(connection, true)?;
    let active_count = ids
        .iter()
        .filter(|id| {
            records
                .iter()
                .any(|record| &record.id == *id && record.deleted_at.is_none())
        })
        .count() as i64;
    let entry_id = Uuid::new_v4().to_string();
    let deleted_at = now_utc();
    let tx = connection.transaction().map_err(db_error)?;
    tx.execute("INSERT INTO trash_entries(id,kind,root_entity_id,title_snapshot,affected_count,deleted_at) VALUES(?1,'project',?2,?3,?4,?5)", params![entry_id, project_id, root.title, active_count, deleted_at]).map_err(db_error)?;
    tx.execute("WITH RECURSIVE descendants(id) AS (SELECT id FROM projects WHERE id=?1 UNION ALL SELECT p.id FROM projects p JOIN descendants d ON p.parent_id=d.id) UPDATE projects SET deleted_at=?2,trash_entry_id=?3,version=version+1,updated_at=?2 WHERE id IN (SELECT id FROM descendants) AND deleted_at IS NULL", params![project_id, deleted_at, entry_id]).map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    Ok(DbResponse::TrashEntry(TrashEntryDto {
        id: entry_id,
        kind: "project".to_string(),
        root_entity_id: project_id.to_string(),
        title_snapshot: root.title,
        deleted_at,
        affected_count_at_delete: active_count,
        current_descendant_count: Some(ids.len() as i64),
    }))
}

fn trash_reminder(connection: &mut Connection, reminder_id: &str) -> Result<DbResponse, ApiError> {
    let reminder = reminder_record_by_id(connection, reminder_id, false)?
        .ok_or_else(|| ApiError::new("NOT_FOUND", "提醒不存在"))?;
    let entry_id = Uuid::new_v4().to_string();
    let deleted_at = now_utc();
    let tx = connection.transaction().map_err(db_error)?;
    tx.execute("INSERT INTO trash_entries(id,kind,root_entity_id,title_snapshot,affected_count,deleted_at) VALUES(?1,'reminder',?2,?3,1,?4)", params![entry_id, reminder_id, reminder.title, deleted_at]).map_err(db_error)?;
    tx.execute("UPDATE reminders SET deleted_at=?1,trash_entry_id=?2,version=version+1,updated_at=?1 WHERE id=?3 AND deleted_at IS NULL", params![deleted_at, entry_id, reminder_id]).map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    Ok(DbResponse::TrashEntry(TrashEntryDto {
        id: entry_id,
        kind: "reminder".to_string(),
        root_entity_id: reminder_id.to_string(),
        title_snapshot: reminder.title,
        deleted_at,
        affected_count_at_delete: 1,
        current_descendant_count: None,
    }))
}

fn list_trash(connection: &Connection, kind: &str) -> Result<DbResponse, ApiError> {
    if kind != "project" && kind != "reminder" {
        return Err(ApiError::new("INVALID_STATUS_TRANSITION", "回收站分类无效"));
    }
    let mut statement = connection.prepare("SELECT id,kind,root_entity_id,title_snapshot,deleted_at,affected_count,NULL FROM trash_entries WHERE kind=?1 ORDER BY deleted_at DESC,id DESC").map_err(db_error)?;
    let rows = statement
        .query_map(params![kind], trash_entry_from_row)
        .map_err(db_error)?;
    let mut result = Vec::new();
    for row in rows {
        let mut entry = row.map_err(db_error)?;
        if kind == "project" {
            entry.current_descendant_count =
                Some(descendant_ids(connection, &entry.root_entity_id)?.len() as i64);
        }
        result.push(entry);
    }
    Ok(DbResponse::TrashEntries(result))
}

fn restore_trash_entry(
    connection: &mut Connection,
    entry_id: &str,
) -> Result<DbResponse, ApiError> {
    let entry = trash_entry_by_id(connection, entry_id)?
        .ok_or_else(|| ApiError::new("NOT_FOUND", "回收站条目不存在"))?;
    let tx = connection.transaction().map_err(db_error)?;
    let restored_count = if entry.kind == "project" {
        let parent: Option<Option<String>> = tx
            .query_row(
                "SELECT parent_id FROM projects WHERE id=?1",
                params![entry.root_entity_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?;
        if let Some(Some(parent_id)) = parent {
            let parent_deleted: Option<String> = tx
                .query_row(
                    "SELECT deleted_at FROM projects WHERE id=?1",
                    params![parent_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(db_error)?
                .flatten();
            if parent_deleted.is_some() {
                return Err(ApiError::new("PARENT_IN_TRASH", "请先恢复父项目"));
            }
        }
        tx.execute("UPDATE projects SET deleted_at=NULL,trash_entry_id=NULL,version=version+1,updated_at=?2 WHERE trash_entry_id=?1", params![entry_id, now_utc()]).map_err(db_error)? as i64
    } else {
        tx.execute("UPDATE reminders SET deleted_at=NULL,trash_entry_id=NULL,version=version+1,updated_at=?2 WHERE trash_entry_id=?1", params![entry_id, now_utc()]).map_err(db_error)? as i64
    };
    tx.execute("DELETE FROM trash_entries WHERE id=?1", params![entry_id])
        .map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    Ok(DbResponse::RestoreTrash {
        kind: entry.kind,
        restored_count,
    })
}

fn hard_delete_project_tx(tx: &Transaction<'_>, root_id: &str) -> Result<i64, ApiError> {
    let ids_with_depth: Vec<(String, i64)> = {
        let mut statement = tx.prepare("WITH RECURSIVE descendants(id,depth) AS (SELECT id,0 FROM projects WHERE id=?1 UNION ALL SELECT p.id,d.depth+1 FROM projects p JOIN descendants d ON p.parent_id=d.id) SELECT id,depth FROM descendants ORDER BY depth DESC,id DESC").map_err(db_error)?;
        let rows = statement
            .query_map(params![root_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(db_error)?;
        let mut values = Vec::new();
        for row in rows {
            values.push(row.map_err(db_error)?);
        }
        values
    };
    if ids_with_depth.is_empty() {
        return Ok(0);
    }

    let mut trash_ids = HashSet::new();
    for (id, _) in &ids_with_depth {
        let trash_id: Option<String> = tx
            .query_row(
                "SELECT trash_entry_id FROM projects WHERE id=?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?
            .flatten();
        if let Some(trash_id) = trash_id {
            trash_ids.insert(trash_id);
        }
        tx.execute(
            "UPDATE projects SET deleted_at=NULL,trash_entry_id=NULL WHERE id=?1",
            params![id],
        )
        .map_err(db_error)?;
    }
    for trash_id in trash_ids {
        tx.execute("DELETE FROM trash_entries WHERE id=?1", params![trash_id])
            .map_err(db_error)?;
    }
    for (id, _) in &ids_with_depth {
        tx.execute("DELETE FROM projects WHERE id=?1", params![id])
            .map_err(db_error)?;
    }
    Ok(ids_with_depth.len() as i64)
}

fn hard_delete_reminder_tx(tx: &Transaction<'_>, reminder_id: &str) -> Result<i64, ApiError> {
    let trash_id: Option<String> = tx
        .query_row(
            "SELECT trash_entry_id FROM reminders WHERE id=?1",
            params![reminder_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?
        .flatten();
    tx.execute(
        "UPDATE reminders SET deleted_at=NULL,trash_entry_id=NULL WHERE id=?1",
        params![reminder_id],
    )
    .map_err(db_error)?;
    if let Some(id) = trash_id {
        tx.execute("DELETE FROM trash_entries WHERE id=?1", params![id])
            .map_err(db_error)?;
    }
    let count = tx
        .execute("DELETE FROM reminders WHERE id=?1", params![reminder_id])
        .map_err(db_error)?;
    Ok(count as i64)
}

fn permanently_delete_trash_entry(
    connection: &mut Connection,
    entry_id: &str,
) -> Result<DbResponse, ApiError> {
    let entry = trash_entry_by_id(connection, entry_id)?
        .ok_or_else(|| ApiError::new("NOT_FOUND", "回收站条目不存在"))?;
    let tx = connection.transaction().map_err(db_error)?;
    let mut projects = 0;
    let mut reminders = 0;
    if entry.kind == "project" {
        projects = hard_delete_project_tx(&tx, &entry.root_entity_id)?;
    } else {
        reminders = hard_delete_reminder_tx(&tx, &entry.root_entity_id)?;
    }
    tx.commit().map_err(db_error)?;
    Ok(DbResponse::DeleteTrash {
        deleted_project_count: projects,
        deleted_reminder_count: reminders,
    })
}

fn empty_trash(connection: &mut Connection, kind: &str) -> Result<DbResponse, ApiError> {
    if kind != "project" && kind != "reminder" {
        return Err(ApiError::new("INVALID_STATUS_TRANSITION", "回收站分类无效"));
    }
    let entries: Vec<(String, String)> = {
        let mut statement = connection.prepare("SELECT kind,root_entity_id FROM trash_entries WHERE kind=?1 ORDER BY deleted_at,id").map_err(db_error)?;
        let rows = statement
            .query_map(params![kind], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(db_error)?;
        let mut values = Vec::new();
        for row in rows {
            values.push(row.map_err(db_error)?);
        }
        values
    };
    let tx = connection.transaction().map_err(db_error)?;
    let mut projects = 0;
    let mut reminders = 0;
    for (entry_kind, root_id) in entries {
        if entry_kind == "project" {
            projects += hard_delete_project_tx(&tx, &root_id)?;
        } else {
            reminders += hard_delete_reminder_tx(&tx, &root_id)?;
        }
    }
    tx.commit().map_err(db_error)?;
    Ok(DbResponse::DeleteTrash {
        deleted_project_count: projects,
        deleted_reminder_count: reminders,
    })
}

fn get_app_settings(connection: &Connection) -> Result<DbResponse, ApiError> {
    let mode: String = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key='theme_mode'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?
        .unwrap_or_else(|| "system".to_string());
    Ok(DbResponse::Theme(ThemeSettings { theme_mode: mode }))
}

fn set_theme_mode(connection: &mut Connection, mode: &str) -> Result<DbResponse, ApiError> {
    if !["light", "dark", "system"].contains(&mode) {
        return Err(ApiError::new("INVALID_STATUS_TRANSITION", "主题模式无效"));
    }
    connection.execute("INSERT INTO app_settings(key,value) VALUES('theme_mode',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![mode]).map_err(db_error)?;
    Ok(DbResponse::Theme(ThemeSettings {
        theme_mode: mode.to_string(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_date_requires_real_iso_calendar_date() {
        assert!(parse_date("2026-02-28").is_ok());
        assert!(parse_date("2026-02-30").is_err());
        assert!(parse_date("+262142-12-31").is_err());
        assert!(parse_date("2026-2-3").is_err());
    }

    #[test]
    fn project_tree_is_depth_first_and_sort_stable() {
        let root = ProjectRecord {
            id: "root".into(),
            parent_id: None,
            title: "Root".into(),
            status: "active".into(),
            completed_date: None,
            canceled_date: None,
            sort_order: 1024,
            version: 0,
            is_expanded: true,
            deleted_at: None,
            trash_entry_id: None,
        };
        let child = ProjectRecord {
            id: "child".into(),
            parent_id: Some("root".into()),
            title: "Child".into(),
            status: "active".into(),
            completed_date: None,
            canceled_date: None,
            sort_order: 1024,
            version: 0,
            is_expanded: true,
            deleted_at: None,
            trash_entry_id: None,
        };
        let sibling = ProjectRecord {
            id: "sibling".into(),
            parent_id: None,
            title: "Sibling".into(),
            status: "active".into(),
            completed_date: None,
            canceled_date: None,
            sort_order: 2048,
            version: 0,
            is_expanded: true,
            deleted_at: None,
            trash_entry_id: None,
        };
        let ordered = tree_order(&[sibling, child, root]);
        assert_eq!(
            ordered
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["root", "child", "sibling"]
        );
    }

    #[test]
    fn duplicate_daily_items_receive_unique_prefixes() {
        let make = |id: &str| ProjectDailyItem {
            project_id: id.into(),
            title: "同名".into(),
            parent_path: vec!["父".into()],
            short_id: None,
            status: "active".into(),
            progressed_same_day: None,
        };
        let mut completed = vec![make("abcdef01-0000")];
        let mut progressed = vec![make("abcdef02-0000")];
        apply_short_ids(&mut completed, &mut progressed);
        assert_ne!(completed[0].short_id, progressed[0].short_id);
        assert_eq!(completed[0].short_id.as_deref(), Some("abcdef01"));
        assert_eq!(progressed[0].short_id.as_deref(), Some("abcdef02"));
    }

    #[test]
    fn project_and_daily_operations_round_trip() {
        let mut connection = test_connection();
        let root_id = match create_project(&mut connection, "目标", None).unwrap() {
            DbResponse::Project(project) => project.id,
            _ => panic!("unexpected create response"),
        };
        let today = date_string(local_today());
        let progressed =
            set_project_progress(&mut connection, &root_id, Some(today.clone()), true, 0).unwrap();
        let version = match progressed {
            DbResponse::Project(project) => project.version,
            _ => panic!("unexpected progress response"),
        };
        let completed =
            set_project_terminal(&mut connection, &root_id, version, "completed").unwrap();
        let version = match completed {
            DbResponse::Project(project) => {
                assert_eq!(project.status, "completed");
                project.version
            }
            _ => panic!("unexpected complete response"),
        };
        let restored = restore_project(&mut connection, &root_id, version).unwrap();
        match restored {
            DbResponse::Project(project) => assert_eq!(project.status, "active"),
            _ => panic!("unexpected restore response"),
        }

        let reminder_id = match create_reminder(&mut connection, "回顾", &today).unwrap() {
            DbResponse::Reminder(reminder) => reminder.id,
            _ => panic!("unexpected reminder response"),
        };
        let week = clock_context();
        let daily = get_daily_week(&connection, &week.week_start).unwrap();
        match daily {
            DbResponse::Daily(value) => assert_eq!(value.days.len(), 7),
            _ => panic!("unexpected daily response"),
        }
        match complete_reminder(&mut connection, &reminder_id, 0).unwrap() {
            DbResponse::Reminder(reminder) => assert_eq!(reminder.status, "completed"),
            _ => panic!("unexpected reminder complete response"),
        }
    }

    #[test]
    fn trash_restore_and_permanent_delete_round_trip() {
        let mut connection = test_connection();
        let root_id = match create_project(&mut connection, "父", None).unwrap() {
            DbResponse::Project(project) => project.id,
            _ => panic!("unexpected create response"),
        };
        let child_id = match create_project(&mut connection, "子", Some(root_id.clone())).unwrap()
        {
            DbResponse::Project(project) => project.id,
            _ => panic!("unexpected create response"),
        };
        assert!(!child_id.is_empty());
        let entry_id = match trash_project(&mut connection, &root_id).unwrap() {
            DbResponse::TrashEntry(entry) => entry.id,
            _ => panic!("unexpected trash response"),
        };
        match get_project_tree(&connection).unwrap() {
            DbResponse::Projects(projects) => assert!(projects.is_empty()),
            _ => panic!("unexpected tree response"),
        }
        match restore_trash_entry(&mut connection, &entry_id).unwrap() {
            DbResponse::RestoreTrash { restored_count, .. } => assert_eq!(restored_count, 2),
            _ => panic!("unexpected restore response"),
        }
        let entry_id = match trash_project(&mut connection, &root_id).unwrap() {
            DbResponse::TrashEntry(entry) => entry.id,
            _ => panic!("unexpected trash response"),
        };
        match permanently_delete_trash_entry(&mut connection, &entry_id).unwrap() {
            DbResponse::DeleteTrash {
                deleted_project_count,
                ..
            } => assert_eq!(deleted_project_count, 2),
            _ => panic!("unexpected delete response"),
        }
        match get_project_tree(&connection).unwrap() {
            DbResponse::Projects(projects) => assert!(projects.is_empty()),
            _ => panic!("unexpected tree response"),
        }
    }

    #[test]
    fn deep_project_tree_can_be_deleted_leaf_first() {
        let mut connection = test_connection();
        let depth = 1100;
        let mut parent: Option<String> = None;
        for index in 0..depth {
            let id = format!("deep-{index}");
            connection.execute("INSERT INTO projects(id,parent_id,title,status,sort_order,version,created_at,updated_at) VALUES(?1,?2,?3,'active',?4,0,?5,?5)", params![id, parent, id, index as i64, "2026-01-01T00:00:00Z"]).unwrap();
            parent = Some(id);
        }
        let tx = connection.transaction().unwrap();
        let count = hard_delete_project_tx(&tx, "deep-0").unwrap();
        tx.commit().unwrap();
        assert_eq!(count, depth as i64);
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM projects", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    fn test_connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(include_str!("../migrations/001_initial.sql"))
            .unwrap();
        connection
    }
}
