use super::support::{db_error, with_write_tx};
use crate::models::{ApiError, ThemeMode, ThemeSettings};
use rusqlite::{params, Connection, OptionalExtension};

pub(crate) fn get_app_settings(connection: &Connection) -> Result<ThemeSettings, ApiError> {
    let mode: ThemeMode = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key='theme_mode'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?
        .unwrap_or(ThemeMode::System);
    Ok(ThemeSettings { theme_mode: mode })
}

pub(crate) fn set_theme_mode(
    connection: &mut Connection,
    mode: &str,
) -> Result<ThemeSettings, ApiError> {
    let theme_mode = ThemeMode::parse(mode)?;
    with_write_tx(connection, |tx| {
        tx.execute(
            "INSERT INTO app_settings(key,value) VALUES('theme_mode',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![theme_mode],
        )
        .map_err(db_error)?;
        Ok(())
    })?;
    Ok(ThemeSettings { theme_mode })
}
