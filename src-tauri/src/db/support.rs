use crate::models::{ApiError, ClockContext, ErrorCode};
use chrono::{Datelike, Duration, Local, NaiveDate, Utc};
use rusqlite::{
    Connection, ErrorCode as SqliteErrorCode, Params, Row, Transaction, TransactionBehavior,
};

fn begin_immediate(connection: &mut Connection) -> Result<Transaction<'_>, ApiError> {
    connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)
}

pub(super) fn with_write_tx<T>(
    connection: &mut Connection,
    operation: impl FnOnce(&Transaction<'_>) -> Result<T, ApiError>,
) -> Result<T, ApiError> {
    let tx = begin_immediate(connection)?;
    let result = operation(&tx)?;
    tx.commit().map_err(db_error)?;
    Ok(result)
}

pub(super) fn query_all<T>(
    connection: &Connection,
    sql: &str,
    params: impl Params,
    mapper: impl FnMut(&Row<'_>) -> rusqlite::Result<T>,
) -> Result<Vec<T>, ApiError> {
    let mut statement = connection.prepare(sql).map_err(db_error)?;
    let rows = statement.query_map(params, mapper).map_err(db_error)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)
}

pub(super) fn db_error(error: rusqlite::Error) -> ApiError {
    match &error {
        rusqlite::Error::SqliteFailure(code, _)
            if code.code == SqliteErrorCode::DatabaseBusy
                || code.code == SqliteErrorCode::DatabaseLocked =>
        {
            ApiError::new(
                ErrorCode::DbBusy,
                "Database is currently busy. Please try again shortly.",
            )
        }
        _ => ApiError::new(
            ErrorCode::DbError,
            format!("Database operation failed: {error}"),
        ),
    }
}

pub(super) fn now_utc() -> String {
    Utc::now().to_rfc3339()
}

pub(super) fn local_today() -> NaiveDate {
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

pub(super) fn parse_date(value: &str) -> Result<NaiveDate, ApiError> {
    let bytes = value.as_bytes();
    let valid_shape = bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit());
    if !valid_shape {
        return Err(ApiError::new(
            ErrorCode::InvalidDate,
            format!("Invalid date: {value}"),
        ));
    }
    let parsed = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| ApiError::new(ErrorCode::InvalidDate, format!("Invalid date: {value}")))?;
    if parsed.format("%Y-%m-%d").to_string() != value {
        return Err(ApiError::new(
            ErrorCode::InvalidDate,
            format!("Invalid date: {value}"),
        ));
    }
    Ok(parsed)
}

pub(super) fn parse_month(value: &str) -> Result<NaiveDate, ApiError> {
    if value.len() != 7 {
        return Err(ApiError::new(
            ErrorCode::InvalidDate,
            "Month must use YYYY-MM format",
        ));
    }
    parse_date(&format!("{value}-01"))
}

pub(super) fn date_string(value: NaiveDate) -> String {
    value.format("%Y-%m-%d").to_string()
}

pub(super) fn validate_title(title: &str) -> Result<String, ApiError> {
    let trimmed = title.trim();
    let length = trimmed.chars().count();
    if length == 0 || length > 500 {
        return Err(ApiError::new(
            ErrorCode::InvalidTitle,
            "Title cannot be empty and must be 500 characters or fewer",
        ));
    }
    Ok(trimmed.to_string())
}

fn version_error(expected: i64, actual: i64) -> ApiError {
    ApiError::new(
        ErrorCode::VersionConflict,
        "This item was modified elsewhere. Please refresh and try again.",
    )
    .with_details(serde_json::json!({ "expectedVersion": expected, "actualVersion": actual }))
}

pub(super) fn check_version(expected: i64, actual: i64) -> Result<(), ApiError> {
    if expected == actual {
        Ok(())
    } else {
        Err(version_error(expected, actual))
    }
}

pub(super) fn check_reorder_membership(
    current: &[String],
    ordered_ids: &[String],
    message: &str,
) -> Result<(), ApiError> {
    let mut expected = current.to_vec();
    let mut supplied = ordered_ids.to_vec();
    expected.sort();
    supplied.sort();
    if expected != supplied {
        return Err(ApiError::new(ErrorCode::ReorderMembershipMismatch, message));
    }
    Ok(())
}
