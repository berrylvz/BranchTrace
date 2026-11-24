use super::repo::{require_project, require_reminder};
use super::support::{db_error, now_utc, query_all, with_write_tx};
use crate::models::{
    ApiError, DeleteResult, ErrorCode, PreviewResult, RestoreResult, TrashEntryDto, TrashKind,
};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use std::collections::HashSet;
use uuid::Uuid;

macro_rules! project_descendants_cte {
    ($query:expr) => {
        concat!(
            "WITH RECURSIVE descendants(id,depth) AS (SELECT id,0 FROM projects WHERE id=?1 UNION ALL SELECT p.id,d.depth+1 FROM projects p JOIN descendants d ON p.parent_id=d.id) ",
            $query
        )
    };
}

macro_rules! trash_entry_select {
    ($suffix:expr) => {
        concat!(
            "SELECT id,kind,root_entity_id,title_snapshot,deleted_at,affected_count,NULL FROM trash_entries ",
            $suffix
        )
    };
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

fn require_trash_entry(connection: &Connection, entry_id: &str) -> Result<TrashEntryDto, ApiError> {
    connection
        .query_row(
            trash_entry_select!("WHERE id=?1"),
            params![entry_id],
            trash_entry_from_row,
        )
        .optional()
        .map_err(db_error)?
        .ok_or_else(|| ApiError::new(ErrorCode::NotFound, "Trash entry not found"))
}

fn active_descendant_count(connection: &Connection, root_id: &str) -> Result<i64, ApiError> {
    connection
        .query_row(
            project_descendants_cte!(
                "SELECT COUNT(*) FROM descendants d JOIN projects p ON p.id=d.id WHERE p.deleted_at IS NULL"
            ),
            params![root_id],
            |row| row.get(0),
        )
        .map_err(db_error)
}

fn total_descendant_count(connection: &Connection, root_id: &str) -> Result<i64, ApiError> {
    connection
        .query_row(
            project_descendants_cte!("SELECT COUNT(*) FROM descendants"),
            params![root_id],
            |row| row.get(0),
        )
        .map_err(db_error)
}

pub(crate) fn preview_project_trash(
    connection: &Connection,
    project_id: &str,
) -> Result<PreviewResult, ApiError> {
    require_project(connection, project_id)?;
    let active_node_count = active_descendant_count(connection, project_id)?;
    Ok(PreviewResult { active_node_count })
}

pub(crate) fn trash_project(
    connection: &mut Connection,
    project_id: &str,
) -> Result<TrashEntryDto, ApiError> {
    with_write_tx(connection, |tx| {
        let root = require_project(tx, project_id)?;
        let active_count = active_descendant_count(tx, project_id)?;
        let total_count = total_descendant_count(tx, project_id)?;
        let entry_id = Uuid::new_v4().to_string();
        let deleted_at = now_utc();
        tx.execute(
            "INSERT INTO trash_entries(id,kind,root_entity_id,title_snapshot,affected_count,deleted_at) VALUES(?1,?2,?3,?4,?5,?6)",
            params![
                entry_id,
                TrashKind::Project,
                project_id,
                root.title,
                active_count,
                deleted_at
            ],
        )
        .map_err(db_error)?;
        tx.execute(
            project_descendants_cte!(
                "UPDATE projects SET deleted_at=?2,trash_entry_id=?3,version=version+1,updated_at=?2 WHERE id IN (SELECT id FROM descendants) AND deleted_at IS NULL"
            ),
            params![project_id, deleted_at, entry_id],
        )
        .map_err(db_error)?;
        Ok(TrashEntryDto {
            id: entry_id,
            kind: TrashKind::Project,
            root_entity_id: project_id.to_string(),
            title_snapshot: root.title,
            deleted_at,
            affected_count_at_delete: active_count,
            current_descendant_count: Some(total_count),
        })
    })
}

pub(crate) fn trash_reminder(
    connection: &mut Connection,
    reminder_id: &str,
) -> Result<TrashEntryDto, ApiError> {
    with_write_tx(connection, |tx| {
        let reminder = require_reminder(tx, reminder_id)?;
        let entry_id = Uuid::new_v4().to_string();
        let deleted_at = now_utc();
        tx.execute(
            "INSERT INTO trash_entries(id,kind,root_entity_id,title_snapshot,affected_count,deleted_at) VALUES(?1,?2,?3,?4,1,?5)",
            params![
                entry_id,
                TrashKind::Reminder,
                reminder_id,
                reminder.title,
                deleted_at
            ],
        )
        .map_err(db_error)?;
        tx.execute(
            "UPDATE reminders SET deleted_at=?1,trash_entry_id=?2,version=version+1,updated_at=?1 WHERE id=?3 AND deleted_at IS NULL",
            params![deleted_at, entry_id, reminder_id],
        )
        .map_err(db_error)?;
        Ok(TrashEntryDto {
            id: entry_id,
            kind: TrashKind::Reminder,
            root_entity_id: reminder_id.to_string(),
            title_snapshot: reminder.title,
            deleted_at,
            affected_count_at_delete: 1,
            current_descendant_count: None,
        })
    })
}

pub(crate) fn list_trash(
    connection: &Connection,
    kind: &str,
) -> Result<Vec<TrashEntryDto>, ApiError> {
    let kind = TrashKind::parse(kind)?;
    match kind {
        TrashKind::Project => query_all(
            connection,
            "WITH RECURSIVE descendants(root_id,id) AS (
                SELECT t.root_entity_id,p.id FROM trash_entries t JOIN projects p ON p.id=t.root_entity_id WHERE t.kind='project'
                UNION ALL
                SELECT d.root_id,p.id FROM projects p JOIN descendants d ON p.parent_id=d.id
             )
             SELECT t.id,t.kind,t.root_entity_id,t.title_snapshot,t.deleted_at,t.affected_count,
                    (SELECT COUNT(*) FROM descendants d WHERE d.root_id=t.root_entity_id)
             FROM trash_entries t
             WHERE t.kind='project'
             ORDER BY t.deleted_at DESC,t.id DESC",
            [],
            trash_entry_from_row,
        ),
        TrashKind::Reminder => query_all(
            connection,
            trash_entry_select!("WHERE kind='reminder' ORDER BY deleted_at DESC,id DESC"),
            [],
            trash_entry_from_row,
        ),
    }
}

pub(crate) fn restore_trash_entry(
    connection: &mut Connection,
    entry_id: &str,
) -> Result<RestoreResult, ApiError> {
    with_write_tx(connection, |tx| {
        let entry = require_trash_entry(tx, entry_id)?;
        let restored_count = match entry.kind {
            TrashKind::Project => {
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
                        return Err(ApiError::new(
                            ErrorCode::ParentInTrash,
                            "Restore the parent project first",
                        ));
                    }
                }
                tx.execute(
                    "UPDATE projects SET deleted_at=NULL,trash_entry_id=NULL,version=version+1,updated_at=?2 WHERE trash_entry_id=?1",
                    params![entry_id, now_utc()],
                )
                .map_err(db_error)? as i64
            }
            TrashKind::Reminder => tx
                .execute(
                    "UPDATE reminders SET deleted_at=NULL,trash_entry_id=NULL,version=version+1,updated_at=?2 WHERE trash_entry_id=?1",
                    params![entry_id, now_utc()],
                )
                .map_err(db_error)? as i64,
        };
        tx.execute("DELETE FROM trash_entries WHERE id=?1", params![entry_id])
            .map_err(db_error)?;
        Ok(RestoreResult {
            kind: entry.kind,
            restored_count,
        })
    })
}

pub(super) fn hard_delete_project_tx(tx: &Transaction<'_>, root_id: &str) -> Result<i64, ApiError> {
    let ids_with_depth = query_all(
        tx,
        project_descendants_cte!("SELECT id,depth FROM descendants ORDER BY depth DESC,id DESC"),
        params![root_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
    )?;
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

pub(crate) fn permanently_delete_trash_entry(
    connection: &mut Connection,
    entry_id: &str,
) -> Result<DeleteResult, ApiError> {
    with_write_tx(connection, |tx| {
        let entry = require_trash_entry(tx, entry_id)?;
        let (deleted_project_count, deleted_reminder_count) = match entry.kind {
            TrashKind::Project => (hard_delete_project_tx(tx, &entry.root_entity_id)?, 0),
            TrashKind::Reminder => (0, hard_delete_reminder_tx(tx, &entry.root_entity_id)?),
        };
        Ok(DeleteResult {
            deleted_project_count,
            deleted_reminder_count,
        })
    })
}

pub(crate) fn empty_trash(
    connection: &mut Connection,
    kind: &str,
) -> Result<DeleteResult, ApiError> {
    let kind = TrashKind::parse(kind)?;
    with_write_tx(connection, |tx| {
        let entries = query_all(
            tx,
            "SELECT kind,root_entity_id FROM trash_entries WHERE kind=?1 ORDER BY deleted_at,id",
            params![kind],
            |row| Ok((row.get::<_, TrashKind>(0)?, row.get::<_, String>(1)?)),
        )?;
        let mut deleted_project_count = 0;
        let mut deleted_reminder_count = 0;
        for (entry_kind, root_id) in entries {
            match entry_kind {
                TrashKind::Project => {
                    deleted_project_count += hard_delete_project_tx(tx, &root_id)?;
                }
                TrashKind::Reminder => {
                    deleted_reminder_count += hard_delete_reminder_tx(tx, &root_id)?;
                }
            }
        }
        Ok(DeleteResult {
            deleted_project_count,
            deleted_reminder_count,
        })
    })
}
