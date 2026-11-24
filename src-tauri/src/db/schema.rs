use super::support::db_error;
use crate::models::{ApiError, ErrorCode};
use rusqlite::Connection;
use std::path::Path;

const CONNECTION_PRAGMAS: &str = "\
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;";

struct Migration {
    version: i64,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    sql: include_str!("../../migrations/001_initial.sql"),
}];

fn configure_and_migrate(connection: Connection) -> Result<Connection, ApiError> {
    connection
        .execute_batch(CONNECTION_PRAGMAS)
        .map_err(db_error)?;

    let current_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(db_error)?;
    let latest_version = MIGRATIONS.last().map(|m| m.version).unwrap_or(0);
    if current_version < 0 || current_version > latest_version {
        return Err(ApiError::new(
            ErrorCode::MigrationError,
            format!("Unsupported database schema version: {current_version}"),
        ));
    }

    for migration in MIGRATIONS
        .iter()
        .filter(|migration| migration.version > current_version)
    {
        connection.execute_batch(migration.sql).map_err(db_error)?;
        let applied_version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(db_error)?;
        if applied_version != migration.version {
            return Err(ApiError::new(
                ErrorCode::MigrationError,
                format!(
                    "Migration to schema version {} recorded unexpected version {applied_version}",
                    migration.version
                ),
            ));
        }
    }

    {
        let mut statement = connection
            .prepare("PRAGMA foreign_key_check")
            .map_err(db_error)?;
        let mut rows = statement.query([]).map_err(db_error)?;
        if rows.next().map_err(db_error)?.is_some() {
            return Err(ApiError::new(
                ErrorCode::MigrationError,
                "Database foreign key integrity check failed",
            ));
        }
    }

    Ok(connection)
}

pub(super) fn initialize_connection(path: &Path) -> Result<Connection, ApiError> {
    let connection = Connection::open(path).map_err(db_error)?;
    configure_and_migrate(connection)
}

#[cfg(test)]
pub(super) fn initialize_in_memory() -> Result<Connection, ApiError> {
    let connection = Connection::open_in_memory().map_err(db_error)?;
    configure_and_migrate(connection)
}
