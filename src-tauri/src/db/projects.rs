use super::repo::{
    load_progress_map, load_project_progress_dates, load_project_progress_month,
    load_project_records, next_project_sort, project_dto, project_dto_by_id,
    project_dto_from_dates, project_parent_path, project_record_by_id, require_project,
    require_project_version, tree_order,
};
use super::support::{
    check_reorder_membership, check_version, date_string, db_error, local_today, now_utc,
    parse_date, parse_month, validate_title, with_write_tx,
};
use crate::models::{
    ApiError, ErrorCode, ItemStatus, ProjectDetailDto, ProjectDto, ProjectRecord, TerminalStatus,
};
use chrono::NaiveDate;
use rusqlite::{params, Connection, Transaction};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

fn ensure_terminal_date_not_before_progress(
    tx: &Transaction<'_>,
    project_id: &str,
    terminal_date: &str,
) -> Result<(), ApiError> {
    let latest: Option<String> = tx
        .query_row(
            "SELECT MAX(progress_date) FROM progress_records WHERE project_id=?1",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if let Some(last) = latest.as_deref().filter(|last| *last > terminal_date) {
        return Err(ApiError::new(
            ErrorCode::TerminalDateBeforeProgress,
            format!(
                "End date cannot be earlier than the latest progress date ({last}). Remove later progress entries first."
            ),
        )
        .with_details(serde_json::json!({ "latestProgressDate": last })));
    }
    Ok(())
}

pub(super) fn get_project_tree_on(
    connection: &Connection,
    today: NaiveDate,
) -> Result<Vec<ProjectDto>, ApiError> {
    let records = load_project_records(connection, false)?;
    let progress = load_progress_map(connection)?;
    let ordered = tree_order(&records);
    let today_str = date_string(today);
    Ok(ordered
        .iter()
        .map(|record| project_dto(record, &progress, &today_str))
        .collect())
}

pub(crate) fn get_project_tree(connection: &Connection) -> Result<Vec<ProjectDto>, ApiError> {
    get_project_tree_on(connection, local_today())
}

pub(crate) fn get_project_detail(
    connection: &Connection,
    project_id: &str,
) -> Result<ProjectDetailDto, ApiError> {
    let records = load_project_records(connection, false)?;
    let by_id: HashMap<&str, &ProjectRecord> = records
        .iter()
        .map(|record| (record.id.as_str(), record))
        .collect();
    let record = by_id
        .get(project_id)
        .copied()
        .ok_or_else(|| ApiError::new(ErrorCode::NotFound, "Project not found"))?;
    let dates = load_project_progress_dates(connection, project_id)?;
    let parent_path = project_parent_path(record, &by_id)?;
    let today_str = date_string(local_today());
    Ok(ProjectDetailDto {
        project: project_dto_from_dates(record, &dates, &today_str),
        parent_path,
        progress_dates: dates,
    })
}

pub(crate) fn get_project_progress_month(
    connection: &Connection,
    project_id: &str,
    month: &str,
) -> Result<Vec<String>, ApiError> {
    parse_month(month)?;
    require_project(connection, project_id)?;
    load_project_progress_month(connection, project_id, month)
}

pub(crate) fn create_project(
    connection: &mut Connection,
    title: &str,
    parent_id: Option<String>,
) -> Result<ProjectDto, ApiError> {
    let title = validate_title(title)?;
    let today_str = date_string(local_today());
    with_write_tx(connection, |tx| {
        if let Some(parent) = parent_id.as_deref() {
            if project_record_by_id(tx, parent, false)?.is_none() {
                return Err(ApiError::new(
                    ErrorCode::InvalidParent,
                    "Parent project does not exist or is in Trash",
                ));
            }
        }
        let sort_order = next_project_sort(tx, parent_id.as_deref())?;
        let id = Uuid::new_v4().to_string();
        let now = now_utc();
        tx.execute(
            "INSERT INTO projects(id,parent_id,title,status,sort_order,version,created_at,updated_at) VALUES(?1,?2,?3,'active',?4,0,?5,?5)",
            params![id, parent_id, title, sort_order, now],
        )
        .map_err(db_error)?;
        tx.execute(
            "INSERT INTO project_ui_states(project_id,is_expanded) VALUES(?1,1)",
            params![id],
        )
        .map_err(db_error)?;
        project_dto_by_id(tx, &id, &today_str)
    })
}

pub(crate) fn rename_project(
    connection: &mut Connection,
    project_id: &str,
    title: &str,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    let title = validate_title(title)?;
    let today_str = date_string(local_today());
    with_write_tx(connection, |tx| {
        require_project_version(tx, project_id, expected_version)?;
        let now = now_utc();
        tx.execute(
            "UPDATE projects SET title=?1,version=version+1,updated_at=?2 WHERE id=?3 AND deleted_at IS NULL",
            params![title, now, project_id],
        )
        .map_err(db_error)?;
        project_dto_by_id(tx, project_id, &today_str)
    })
}

pub(crate) fn set_project_expanded(
    connection: &mut Connection,
    project_id: &str,
    is_expanded: bool,
) -> Result<ProjectDto, ApiError> {
    let today_str = date_string(local_today());
    with_write_tx(connection, |tx| {
        require_project(tx, project_id)?;
        tx.execute(
            "INSERT INTO project_ui_states(project_id,is_expanded) VALUES(?1,?2) ON CONFLICT(project_id) DO UPDATE SET is_expanded=excluded.is_expanded",
            params![project_id, is_expanded],
        )
        .map_err(db_error)?;
        project_dto_by_id(tx, project_id, &today_str)
    })
}

pub(crate) fn set_all_projects_expanded(
    connection: &mut Connection,
    is_expanded: bool,
) -> Result<Vec<ProjectDto>, ApiError> {
    let today = local_today();
    with_write_tx(connection, |tx| {
        tx.execute(
            "INSERT INTO project_ui_states(project_id,is_expanded) SELECT id,?1 FROM projects WHERE deleted_at IS NULL ON CONFLICT(project_id) DO UPDATE SET is_expanded=excluded.is_expanded",
            params![is_expanded],
        )
        .map_err(db_error)?;
        get_project_tree_on(tx, today)
    })
}

pub(crate) fn reorder_project_siblings(
    connection: &mut Connection,
    parent_id: Option<String>,
    ordered_ids: Vec<String>,
) -> Result<Vec<ProjectDto>, ApiError> {
    let today_str = date_string(local_today());
    with_write_tx(connection, |tx| {
        let records = load_project_records(tx, false)?;
        let current: Vec<String> = records
            .iter()
            .filter(|record| record.parent_id == parent_id)
            .map(|record| record.id.clone())
            .collect();
        check_reorder_membership(
            &current,
            &ordered_ids,
            "Reorder list must include all projects in the same level",
        )?;
        let now = now_utc();
        for (index, id) in ordered_ids.iter().enumerate() {
            tx.execute(
                "UPDATE projects SET sort_order=?1,version=version+1,updated_at=?2 WHERE id=?3 AND deleted_at IS NULL",
                params![(index as i64 + 1) * 1024, now, id],
            )
            .map_err(db_error)?;
        }
        let progress = load_progress_map(tx)?;
        let mut result = Vec::new();
        for id in ordered_ids {
            if let Some(record) = project_record_by_id(tx, &id, false)? {
                result.push(project_dto(&record, &progress, &today_str));
            }
        }
        Ok(result)
    })
}

pub(crate) fn move_project(
    connection: &mut Connection,
    project_id: &str,
    target_parent_id: Option<String>,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    let today_str = date_string(local_today());
    with_write_tx(connection, |tx| {
        let records = load_project_records(tx, false)?;
        let by_id: HashMap<&str, &ProjectRecord> = records
            .iter()
            .map(|record| (record.id.as_str(), record))
            .collect();
        let source = by_id
            .get(project_id)
            .copied()
            .ok_or_else(|| ApiError::new(ErrorCode::NotFound, "Project not found"))?;
        check_version(expected_version, source.version)?;
        if let Some(target) = target_parent_id.as_deref() {
            if !by_id.contains_key(target) {
                return Err(ApiError::new(
                    ErrorCode::InvalidParent,
                    "Target project does not exist or is in Trash",
                ));
            }
            let mut current = Some(target);
            let mut visited = HashSet::new();
            while let Some(id) = current {
                if id == project_id {
                    return Err(ApiError::new(
                        ErrorCode::InvalidParent,
                        "Cannot move a project into itself or its descendants",
                    ));
                }
                if !visited.insert(id) {
                    return Err(ApiError::new(
                        ErrorCode::DbError,
                        "Project tree contains a cycle",
                    ));
                }
                current = by_id.get(id).and_then(|record| record.parent_id.as_deref());
            }
        }
        let sort_order = next_project_sort(tx, target_parent_id.as_deref())?;
        tx.execute(
            "UPDATE projects SET parent_id=?1,sort_order=?2,version=version+1,updated_at=?3 WHERE id=?4 AND deleted_at IS NULL",
            params![target_parent_id, sort_order, now_utc(), project_id],
        )
        .map_err(db_error)?;
        project_dto_by_id(tx, project_id, &today_str)
    })
}

pub(super) fn set_project_progress_on(
    connection: &mut Connection,
    project_id: &str,
    requested_date: Option<String>,
    present: bool,
    expected_version: i64,
    today: NaiveDate,
) -> Result<ProjectDto, ApiError> {
    let today_str = date_string(today);
    with_write_tx(connection, |tx| {
        let record = require_project_version(tx, project_id, expected_version)?;
        let (parsed, date) = match requested_date {
            Some(value) => (parse_date(&value)?, value),
            None => (today, today_str.clone()),
        };
        let now = now_utc();
        let changed = if present {
            if record.status != ItemStatus::Active {
                return Err(ApiError::new(
                    ErrorCode::InvalidStatusTransition,
                    "Cannot log new progress for a completed or canceled project",
                ));
            }
            if parsed > today {
                return Err(ApiError::new(
                    ErrorCode::FutureDateForbidden,
                    "Cannot log progress for a future date",
                ));
            }
            tx.execute(
                "INSERT OR IGNORE INTO progress_records(project_id,progress_date,created_at) VALUES(?1,?2,?3)",
                params![project_id, date, now],
            )
            .map_err(db_error)?
                > 0
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
                params![now, project_id],
            )
            .map_err(db_error)?;
        }
        project_dto_by_id(tx, project_id, &today_str)
    })
}

pub(crate) fn set_project_progress(
    connection: &mut Connection,
    project_id: &str,
    requested_date: Option<String>,
    present: bool,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    set_project_progress_on(
        connection,
        project_id,
        requested_date,
        present,
        expected_version,
        local_today(),
    )
}

pub(super) fn set_project_terminal_on(
    connection: &mut Connection,
    project_id: &str,
    expected_version: i64,
    target: TerminalStatus,
    today: NaiveDate,
) -> Result<ProjectDto, ApiError> {
    let today_str = date_string(today);
    with_write_tx(connection, |tx| {
        let record = require_project_version(tx, project_id, expected_version)?;
        if record.status != ItemStatus::Active {
            return Err(ApiError::new(
                ErrorCode::InvalidStatusTransition,
                "Only active projects can be completed or canceled",
            ));
        }
        ensure_terminal_date_not_before_progress(tx, project_id, &today_str)?;
        let now = now_utc();
        match target {
            TerminalStatus::Completed => {
                tx.execute(
                    "UPDATE projects SET status='completed',completed_date=?1,canceled_date=NULL,version=version+1,updated_at=?2 WHERE id=?3",
                    params![today_str, now, project_id],
                )
                .map_err(db_error)?;
            }
            TerminalStatus::Canceled => {
                tx.execute(
                    "UPDATE projects SET status='canceled',completed_date=NULL,canceled_date=?1,version=version+1,updated_at=?2 WHERE id=?3",
                    params![today_str, now, project_id],
                )
                .map_err(db_error)?;
            }
        }
        project_dto_by_id(tx, project_id, &today_str)
    })
}

pub(crate) fn set_project_terminal(
    connection: &mut Connection,
    project_id: &str,
    expected_version: i64,
    target: TerminalStatus,
) -> Result<ProjectDto, ApiError> {
    set_project_terminal_on(
        connection,
        project_id,
        expected_version,
        target,
        local_today(),
    )
}

pub(crate) fn restore_project(
    connection: &mut Connection,
    project_id: &str,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    let today_str = date_string(local_today());
    with_write_tx(connection, |tx| {
        let record = require_project_version(tx, project_id, expected_version)?;
        if record.status == ItemStatus::Active {
            return Err(ApiError::new(
                ErrorCode::InvalidStatusTransition,
                "Project is already active",
            ));
        }
        tx.execute(
            "UPDATE projects SET status='active',completed_date=NULL,canceled_date=NULL,version=version+1,updated_at=?1 WHERE id=?2",
            params![now_utc(), project_id],
        )
        .map_err(db_error)?;
        project_dto_by_id(tx, project_id, &today_str)
    })
}

pub(super) fn update_project_terminal_date_on(
    connection: &mut Connection,
    project_id: &str,
    date: &str,
    expected_version: i64,
    today: NaiveDate,
) -> Result<ProjectDto, ApiError> {
    let requested = parse_date(date)?;
    let today_str = date_string(today);
    with_write_tx(connection, |tx| {
        let record = require_project_version(tx, project_id, expected_version)?;
        if record.status == ItemStatus::Active {
            return Err(ApiError::new(
                ErrorCode::InvalidStatusTransition,
                "Active projects do not have an end date",
            ));
        }
        if requested > today {
            return Err(ApiError::new(
                ErrorCode::FutureDateForbidden,
                "End date cannot be in the future",
            ));
        }
        ensure_terminal_date_not_before_progress(tx, project_id, date)?;
        let now = now_utc();
        match record.status {
            ItemStatus::Completed => {
                tx.execute(
                    "UPDATE projects SET completed_date=?1,version=version+1,updated_at=?2 WHERE id=?3",
                    params![date, now, project_id],
                )
                .map_err(db_error)?;
            }
            ItemStatus::Canceled => {
                tx.execute(
                    "UPDATE projects SET canceled_date=?1,version=version+1,updated_at=?2 WHERE id=?3",
                    params![date, now, project_id],
                )
                .map_err(db_error)?;
            }
            ItemStatus::Active => unreachable!("active status rejected above"),
        }
        project_dto_by_id(tx, project_id, &today_str)
    })
}

pub(crate) fn update_project_terminal_date(
    connection: &mut Connection,
    project_id: &str,
    date: &str,
    expected_version: i64,
) -> Result<ProjectDto, ApiError> {
    update_project_terminal_date_on(
        connection,
        project_id,
        date,
        expected_version,
        local_today(),
    )
}
