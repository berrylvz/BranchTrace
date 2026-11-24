use super::repo::{
    next_reminder_sort, reminder_dto, reminder_dto_by_id, reminder_record_by_id,
    require_reminder_version,
};
use super::support::{
    check_reorder_membership, date_string, db_error, local_today, now_utc, parse_date, query_all,
    validate_title, with_write_tx,
};
use crate::models::{ApiError, ErrorCode, ItemStatus, ReminderDto};
use chrono::NaiveDate;
use rusqlite::{params, Connection};
use uuid::Uuid;

fn ensure_schedule_not_in_past(date: NaiveDate, today: NaiveDate) -> Result<(), ApiError> {
    if date < today {
        return Err(ApiError::new(
            ErrorCode::ScheduleInPast,
            "Scheduled date must be today or in the future",
        ));
    }
    Ok(())
}

pub(crate) fn get_reminder(
    connection: &Connection,
    reminder_id: &str,
) -> Result<ReminderDto, ApiError> {
    reminder_dto_by_id(connection, reminder_id)
}

pub(super) fn create_reminder_on(
    connection: &mut Connection,
    title: &str,
    scheduled_date: &str,
    today: NaiveDate,
) -> Result<ReminderDto, ApiError> {
    let title = validate_title(title)?;
    let date = parse_date(scheduled_date)?;
    ensure_schedule_not_in_past(date, today)?;
    with_write_tx(connection, |tx| {
        let sort_order = next_reminder_sort(tx, scheduled_date)?;
        let id = Uuid::new_v4().to_string();
        let now = now_utc();
        tx.execute(
            "INSERT INTO reminders(id,title,scheduled_date,status,sort_order,version,created_at,updated_at) VALUES(?1,?2,?3,'active',?4,0,?5,?5)",
            params![id, title, scheduled_date, sort_order, now],
        )
        .map_err(db_error)?;
        reminder_dto_by_id(tx, &id)
    })
}

pub(crate) fn create_reminder(
    connection: &mut Connection,
    title: &str,
    scheduled_date: &str,
) -> Result<ReminderDto, ApiError> {
    create_reminder_on(connection, title, scheduled_date, local_today())
}

pub(crate) fn rename_reminder(
    connection: &mut Connection,
    reminder_id: &str,
    title: &str,
    expected_version: i64,
) -> Result<ReminderDto, ApiError> {
    let title = validate_title(title)?;
    with_write_tx(connection, |tx| {
        require_reminder_version(tx, reminder_id, expected_version)?;
        tx.execute(
            "UPDATE reminders SET title=?1,version=version+1,updated_at=?2 WHERE id=?3 AND deleted_at IS NULL",
            params![title, now_utc(), reminder_id],
        )
        .map_err(db_error)?;
        reminder_dto_by_id(tx, reminder_id)
    })
}

pub(super) fn update_reminder_schedule_on(
    connection: &mut Connection,
    reminder_id: &str,
    scheduled_date: &str,
    expected_version: i64,
    today: NaiveDate,
) -> Result<ReminderDto, ApiError> {
    let date = parse_date(scheduled_date)?;
    with_write_tx(connection, |tx| {
        require_reminder_version(tx, reminder_id, expected_version)?;
        ensure_schedule_not_in_past(date, today)?;
        let sort_order = next_reminder_sort(tx, scheduled_date)?;
        tx.execute(
            "UPDATE reminders SET scheduled_date=?1,sort_order=?2,version=version+1,updated_at=?3 WHERE id=?4 AND deleted_at IS NULL",
            params![scheduled_date, sort_order, now_utc(), reminder_id],
        )
        .map_err(db_error)?;
        reminder_dto_by_id(tx, reminder_id)
    })
}

pub(crate) fn update_reminder_schedule(
    connection: &mut Connection,
    reminder_id: &str,
    scheduled_date: &str,
    expected_version: i64,
) -> Result<ReminderDto, ApiError> {
    update_reminder_schedule_on(
        connection,
        reminder_id,
        scheduled_date,
        expected_version,
        local_today(),
    )
}

pub(super) fn complete_reminder_on(
    connection: &mut Connection,
    reminder_id: &str,
    expected_version: i64,
    today: NaiveDate,
) -> Result<ReminderDto, ApiError> {
    let today_str = date_string(today);
    with_write_tx(connection, |tx| {
        let record = require_reminder_version(tx, reminder_id, expected_version)?;
        if record.status != ItemStatus::Active {
            return Err(ApiError::new(
                ErrorCode::InvalidStatusTransition,
                "Only active reminders can be completed",
            ));
        }
        tx.execute(
            "UPDATE reminders SET status='completed',completed_date=?1,completed_action_at=?2,canceled_date=NULL,version=version+1,updated_at=?2 WHERE id=?3",
            params![today_str, now_utc(), reminder_id],
        )
        .map_err(db_error)?;
        reminder_dto_by_id(tx, reminder_id)
    })
}

pub(crate) fn complete_reminder(
    connection: &mut Connection,
    reminder_id: &str,
    expected_version: i64,
) -> Result<ReminderDto, ApiError> {
    complete_reminder_on(connection, reminder_id, expected_version, local_today())
}

pub(super) fn cancel_reminder_on(
    connection: &mut Connection,
    reminder_id: &str,
    expected_version: i64,
    today: NaiveDate,
) -> Result<ReminderDto, ApiError> {
    let today_str = date_string(today);
    with_write_tx(connection, |tx| {
        let record = require_reminder_version(tx, reminder_id, expected_version)?;
        if record.status != ItemStatus::Active {
            return Err(ApiError::new(
                ErrorCode::InvalidStatusTransition,
                "Only active reminders can be canceled",
            ));
        }
        tx.execute(
            "UPDATE reminders SET status='canceled',completed_date=NULL,completed_action_at=NULL,canceled_date=?1,version=version+1,updated_at=?2 WHERE id=?3",
            params![today_str, now_utc(), reminder_id],
        )
        .map_err(db_error)?;
        reminder_dto_by_id(tx, reminder_id)
    })
}

pub(crate) fn cancel_reminder(
    connection: &mut Connection,
    reminder_id: &str,
    expected_version: i64,
) -> Result<ReminderDto, ApiError> {
    cancel_reminder_on(connection, reminder_id, expected_version, local_today())
}

pub(crate) fn restore_reminder(
    connection: &mut Connection,
    reminder_id: &str,
    expected_version: i64,
) -> Result<ReminderDto, ApiError> {
    with_write_tx(connection, |tx| {
        let record = require_reminder_version(tx, reminder_id, expected_version)?;
        if record.status == ItemStatus::Active {
            return Err(ApiError::new(
                ErrorCode::InvalidStatusTransition,
                "Reminder is already active",
            ));
        }
        tx.execute(
            "UPDATE reminders SET status='active',completed_date=NULL,completed_action_at=NULL,canceled_date=NULL,version=version+1,updated_at=?1 WHERE id=?2",
            params![now_utc(), reminder_id],
        )
        .map_err(db_error)?;
        reminder_dto_by_id(tx, reminder_id)
    })
}

pub(super) fn update_reminder_completed_date_on(
    connection: &mut Connection,
    reminder_id: &str,
    date: &str,
    expected_version: i64,
    today: NaiveDate,
) -> Result<ReminderDto, ApiError> {
    let requested = parse_date(date)?;
    with_write_tx(connection, |tx| {
        let record = require_reminder_version(tx, reminder_id, expected_version)?;
        if record.status != ItemStatus::Completed {
            return Err(ApiError::new(
                ErrorCode::InvalidStatusTransition,
                "Only completed reminders can update their completed date",
            ));
        }
        if requested > today {
            return Err(ApiError::new(
                ErrorCode::FutureDateForbidden,
                "Completed date cannot be in the future",
            ));
        }
        tx.execute(
            "UPDATE reminders SET completed_date=?1,version=version+1,updated_at=?2 WHERE id=?3",
            params![date, now_utc(), reminder_id],
        )
        .map_err(db_error)?;
        reminder_dto_by_id(tx, reminder_id)
    })
}

pub(crate) fn update_reminder_completed_date(
    connection: &mut Connection,
    reminder_id: &str,
    date: &str,
    expected_version: i64,
) -> Result<ReminderDto, ApiError> {
    update_reminder_completed_date_on(
        connection,
        reminder_id,
        date,
        expected_version,
        local_today(),
    )
}

pub(crate) fn reorder_reminders(
    connection: &mut Connection,
    scheduled_date: &str,
    ordered_ids: Vec<String>,
) -> Result<Vec<ReminderDto>, ApiError> {
    parse_date(scheduled_date)?;
    with_write_tx(connection, |tx| {
        let current = query_all(
            tx,
            "SELECT id FROM reminders WHERE scheduled_date=?1 AND deleted_at IS NULL ORDER BY sort_order,id",
            params![scheduled_date],
            |row| row.get::<_, String>(0),
        )?;
        check_reorder_membership(
            &current,
            &ordered_ids,
            "Reorder list must include all reminders for that scheduled date",
        )?;
        let now = now_utc();
        for (index, id) in ordered_ids.iter().enumerate() {
            tx.execute(
                "UPDATE reminders SET sort_order=?1,version=version+1,updated_at=?2 WHERE id=?3 AND scheduled_date=?4 AND deleted_at IS NULL",
                params![(index as i64 + 1) * 1024, now, id, scheduled_date],
            )
            .map_err(db_error)?;
        }
        let mut result = Vec::new();
        for id in ordered_ids {
            if let Some(record) = reminder_record_by_id(tx, &id, false)? {
                result.push(reminder_dto(&record));
            }
        }
        Ok(result)
    })
}
