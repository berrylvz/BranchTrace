use super::support::{check_version, db_error, query_all};
use crate::models::{ApiError, ErrorCode, ProjectDto, ProjectRecord, ReminderDto, ReminderRecord};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::{HashMap, HashSet};

pub(super) type ProgressMap = HashMap<String, Vec<String>>;

macro_rules! project_select {
    ($suffix:expr) => {
        concat!(
            "SELECT p.id,p.parent_id,p.title,p.status,p.completed_date,p.canceled_date,p.sort_order,p.version,COALESCE(u.is_expanded,1) FROM projects p LEFT JOIN project_ui_states u ON u.project_id=p.id ",
            $suffix
        )
    };
}

macro_rules! reminder_select {
    ($suffix:expr) => {
        concat!(
            "SELECT id,title,scheduled_date,status,completed_date,completed_action_at,canceled_date,sort_order,version FROM reminders ",
            $suffix
        )
    };
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
    })
}

pub(super) fn load_project_records(
    connection: &Connection,
    include_deleted: bool,
) -> Result<Vec<ProjectRecord>, ApiError> {
    let sql = if include_deleted {
        project_select!("ORDER BY p.sort_order,p.id")
    } else {
        project_select!("WHERE p.deleted_at IS NULL ORDER BY p.sort_order,p.id")
    };
    query_all(connection, sql, [], project_from_row)
}

pub(super) fn project_record_by_id(
    connection: &Connection,
    id: &str,
    include_deleted: bool,
) -> Result<Option<ProjectRecord>, ApiError> {
    let sql = if include_deleted {
        project_select!("WHERE p.id=?1")
    } else {
        project_select!("WHERE p.id=?1 AND p.deleted_at IS NULL")
    };
    connection
        .query_row(sql, params![id], project_from_row)
        .optional()
        .map_err(db_error)
}

pub(super) fn require_project(
    connection: &Connection,
    id: &str,
) -> Result<ProjectRecord, ApiError> {
    project_record_by_id(connection, id, false)?
        .ok_or_else(|| ApiError::new(ErrorCode::NotFound, "Project not found"))
}

pub(super) fn require_project_version(
    connection: &Connection,
    id: &str,
    expected_version: i64,
) -> Result<ProjectRecord, ApiError> {
    let record = require_project(connection, id)?;
    check_version(expected_version, record.version)?;
    Ok(record)
}

pub(super) fn load_progress_map(connection: &Connection) -> Result<ProgressMap, ApiError> {
    let entries = query_all(
        connection,
        "SELECT project_id,progress_date FROM progress_records ORDER BY progress_date,project_id",
        [],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )?;
    let mut result: ProgressMap = HashMap::new();
    for (project_id, date) in entries {
        result.entry(project_id).or_default().push(date);
    }
    Ok(result)
}

pub(super) fn load_project_progress_dates(
    connection: &Connection,
    project_id: &str,
) -> Result<Vec<String>, ApiError> {
    query_all(
        connection,
        "SELECT progress_date FROM progress_records WHERE project_id=?1 ORDER BY progress_date",
        params![project_id],
        |row| row.get(0),
    )
}

pub(super) fn load_project_progress_month(
    connection: &Connection,
    project_id: &str,
    month: &str,
) -> Result<Vec<String>, ApiError> {
    let start = format!("{month}-01");
    let end = format!("{month}-31");
    query_all(
        connection,
        "SELECT progress_date FROM progress_records WHERE project_id=?1 AND progress_date>=?2 AND progress_date<=?3 ORDER BY progress_date",
        params![project_id, start, end],
        |row| row.get(0),
    )
}

pub(super) fn project_parent_path(
    record: &ProjectRecord,
    by_id: &HashMap<&str, &ProjectRecord>,
) -> Result<Vec<String>, ApiError> {
    let mut path = Vec::new();
    let mut visited = HashSet::new();
    visited.insert(record.id.as_str());
    let mut parent = record.parent_id.as_deref();
    while let Some(parent_id) = parent {
        if !visited.insert(parent_id) {
            return Err(ApiError::new(
                ErrorCode::DbError,
                "Project tree contains a cycle",
            ));
        }
        if let Some(parent_record) = by_id.get(parent_id) {
            path.push(parent_record.title.clone());
            parent = parent_record.parent_id.as_deref();
        } else {
            break;
        }
    }
    path.reverse();
    Ok(path)
}

pub(super) fn project_parent_paths(
    records: &[ProjectRecord],
) -> Result<HashMap<String, Vec<String>>, ApiError> {
    let by_id: HashMap<&str, &ProjectRecord> = records
        .iter()
        .map(|record| (record.id.as_str(), record))
        .collect();
    let mut paths = HashMap::with_capacity(records.len());
    for record in records {
        paths.insert(record.id.clone(), project_parent_path(record, &by_id)?);
    }
    Ok(paths)
}

pub(super) fn tree_order(records: &[ProjectRecord]) -> Vec<ProjectRecord> {
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
    let mut result = Vec::with_capacity(records.len());
    let mut visited = HashSet::with_capacity(records.len());
    let mut stack: Vec<ProjectRecord> = Vec::new();
    if let Some(roots) = groups.get(&None) {
        for root in roots.iter().rev() {
            stack.push(root.clone());
        }
    }
    while let Some(node) = stack.pop() {
        if !visited.insert(node.id.clone()) {
            continue;
        }
        if let Some(children) = groups.get(&Some(node.id.clone())) {
            for child in children.iter().rev() {
                stack.push(child.clone());
            }
        }
        result.push(node);
    }
    if result.len() != records.len() {
        for record in records {
            if visited.insert(record.id.clone()) {
                result.push(record.clone());
            }
        }
    }
    result
}

pub(super) fn project_dto_from_dates(
    record: &ProjectRecord,
    dates: &[String],
    today: &str,
) -> ProjectDto {
    let mut recent = dates.iter().rev().take(3).cloned().collect::<Vec<_>>();
    recent.reverse();
    ProjectDto {
        id: record.id.clone(),
        parent_id: record.parent_id.clone(),
        title: record.title.clone(),
        status: record.status,
        completed_date: record.completed_date.clone(),
        canceled_date: record.canceled_date.clone(),
        sort_order: record.sort_order,
        version: record.version,
        is_expanded: record.is_expanded,
        recent_progress_dates: recent,
        progress_count: dates.len() as i64,
        progressed_today: dates.iter().any(|date| date == today),
    }
}

pub(super) fn project_dto(
    record: &ProjectRecord,
    progress: &ProgressMap,
    today: &str,
) -> ProjectDto {
    let dates = progress.get(&record.id).map(Vec::as_slice).unwrap_or(&[]);
    project_dto_from_dates(record, dates, today)
}

pub(super) fn project_dto_by_id(
    connection: &Connection,
    id: &str,
    today: &str,
) -> Result<ProjectDto, ApiError> {
    let record = require_project(connection, id)?;
    let dates = load_project_progress_dates(connection, id)?;
    Ok(project_dto_from_dates(&record, &dates, today))
}

pub(super) fn reminder_dto(record: &ReminderRecord) -> ReminderDto {
    ReminderDto {
        id: record.id.clone(),
        title: record.title.clone(),
        scheduled_date: record.scheduled_date.clone(),
        status: record.status,
        completed_date: record.completed_date.clone(),
        completed_action_at: record.completed_action_at.clone(),
        canceled_date: record.canceled_date.clone(),
        sort_order: record.sort_order,
        version: record.version,
    }
}

pub(super) fn reminder_record_by_id(
    connection: &Connection,
    id: &str,
    include_deleted: bool,
) -> Result<Option<ReminderRecord>, ApiError> {
    let sql = if include_deleted {
        reminder_select!("WHERE id=?1")
    } else {
        reminder_select!("WHERE id=?1 AND deleted_at IS NULL")
    };
    connection
        .query_row(sql, params![id], reminder_from_row)
        .optional()
        .map_err(db_error)
}

pub(super) fn require_reminder(
    connection: &Connection,
    id: &str,
) -> Result<ReminderRecord, ApiError> {
    reminder_record_by_id(connection, id, false)?
        .ok_or_else(|| ApiError::new(ErrorCode::NotFound, "Reminder not found"))
}

pub(super) fn require_reminder_version(
    connection: &Connection,
    id: &str,
    expected_version: i64,
) -> Result<ReminderRecord, ApiError> {
    let record = require_reminder(connection, id)?;
    check_version(expected_version, record.version)?;
    Ok(record)
}

pub(super) fn reminder_dto_by_id(
    connection: &Connection,
    id: &str,
) -> Result<ReminderDto, ApiError> {
    Ok(reminder_dto(&require_reminder(connection, id)?))
}

pub(super) fn load_reminder_records(
    connection: &Connection,
) -> Result<Vec<ReminderRecord>, ApiError> {
    query_all(
        connection,
        reminder_select!("WHERE deleted_at IS NULL ORDER BY scheduled_date,sort_order,id"),
        [],
        reminder_from_row,
    )
}

pub(super) fn next_project_sort(
    connection: &Connection,
    parent_id: Option<&str>,
) -> Result<i64, ApiError> {
    connection
        .query_row(
            "SELECT COALESCE(MAX(sort_order),0)+1024 FROM projects WHERE parent_id IS ?1 AND deleted_at IS NULL",
            params![parent_id],
            |row| row.get(0),
        )
        .map_err(db_error)
}

pub(super) fn next_reminder_sort(connection: &Connection, date: &str) -> Result<i64, ApiError> {
    connection
        .query_row(
            "SELECT COALESCE(MAX(sort_order),0)+1024 FROM reminders WHERE scheduled_date=?1 AND deleted_at IS NULL",
            params![date],
            |row| row.get(0),
        )
        .map_err(db_error)
}
