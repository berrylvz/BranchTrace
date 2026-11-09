-- BranchTrace (枝迹) MVP / SQLite Schema / migration v1
-- Apply via rusqlite migration runner to a new database only.
-- Suggested local database filename: branchtrace.sqlite3 (not an SQL schema property).
-- Connection PRAGMAs (set once per connection, before the transaction):
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;

BEGIN IMMEDIATE;

CREATE TABLE trash_entries (
    id                  TEXT PRIMARY KEY NOT NULL,
    kind                TEXT NOT NULL CHECK (kind IN ('project', 'reminder')),
    root_entity_id      TEXT NOT NULL,
    title_snapshot      TEXT NOT NULL,
    affected_count      INTEGER NOT NULL CHECK (affected_count >= 1),
    deleted_at          TEXT NOT NULL,
    UNIQUE (kind, root_entity_id)
);
CREATE INDEX idx_trash_kind_deleted ON trash_entries(kind, deleted_at DESC);

CREATE TABLE projects (
    id                  TEXT PRIMARY KEY NOT NULL,
    parent_id           TEXT REFERENCES projects(id) ON DELETE CASCADE,
    title               TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
    status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'completed', 'canceled')),
    completed_date      TEXT,
    canceled_date       TEXT,
    sort_order          INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    version             INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    deleted_at          TEXT,
    trash_entry_id      TEXT REFERENCES trash_entries(id) ON DELETE RESTRICT,
    CHECK (parent_id IS NULL OR parent_id <> id),
    CHECK (
        (status = 'active'    AND completed_date IS NULL AND canceled_date IS NULL) OR
        (status = 'completed' AND completed_date IS NOT NULL AND canceled_date IS NULL) OR
        (status = 'canceled'  AND completed_date IS NULL AND canceled_date IS NOT NULL)
    ),
    CHECK (
        (deleted_at IS NULL AND trash_entry_id IS NULL) OR
        (deleted_at IS NOT NULL AND trash_entry_id IS NOT NULL)
    ),
    CHECK (completed_date IS NULL OR
        (length(completed_date) = 10 AND completed_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')),
    CHECK (canceled_date IS NULL OR
        (length(canceled_date) = 10 AND canceled_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'))
);
CREATE INDEX idx_projects_siblings ON projects(parent_id, sort_order, id);
CREATE INDEX idx_projects_trash ON projects(trash_entry_id);
CREATE INDEX idx_projects_completed ON projects(completed_date)
    WHERE status = 'completed' AND deleted_at IS NULL;

CREATE TABLE project_ui_states (
    project_id     TEXT PRIMARY KEY NOT NULL
                   REFERENCES projects(id) ON DELETE CASCADE,
    is_expanded    INTEGER NOT NULL DEFAULT 1 CHECK (is_expanded IN (0, 1))
);

CREATE TABLE progress_records (
    project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    progress_date  TEXT NOT NULL CHECK (
        length(progress_date) = 10 AND
        progress_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    created_at     TEXT NOT NULL,
    PRIMARY KEY (project_id, progress_date)
);
CREATE INDEX idx_progress_by_date ON progress_records(progress_date, project_id);

CREATE TABLE reminders (
    id                  TEXT PRIMARY KEY NOT NULL,
    title               TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
    scheduled_date      TEXT NOT NULL CHECK (
        length(scheduled_date) = 10 AND
        scheduled_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'completed', 'canceled')),
    completed_date      TEXT,
    completed_action_at TEXT,
    canceled_date       TEXT,
    sort_order          INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    version             INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    deleted_at          TEXT,
    trash_entry_id      TEXT REFERENCES trash_entries(id) ON DELETE RESTRICT,
    CHECK (
        (status = 'active' AND completed_date IS NULL AND completed_action_at IS NULL AND canceled_date IS NULL) OR
        (status = 'completed' AND completed_date IS NOT NULL AND completed_action_at IS NOT NULL AND canceled_date IS NULL) OR
        (status = 'canceled' AND completed_date IS NULL AND completed_action_at IS NULL AND canceled_date IS NOT NULL)
    ),
    CHECK (
        (deleted_at IS NULL AND trash_entry_id IS NULL) OR
        (deleted_at IS NOT NULL AND trash_entry_id IS NOT NULL)
    ),
    CHECK (completed_date IS NULL OR
        (length(completed_date) = 10 AND completed_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')),
    CHECK (canceled_date IS NULL OR
        (length(canceled_date) = 10 AND canceled_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'))
);
CREATE INDEX idx_reminders_scheduled ON reminders(scheduled_date, sort_order, id)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_reminders_completed ON reminders(completed_date, completed_action_at, id)
    WHERE status = 'completed' AND deleted_at IS NULL;
CREATE INDEX idx_reminders_overdue ON reminders(scheduled_date, id)
    WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX idx_reminders_trash ON reminders(trash_entry_id);

CREATE TABLE app_settings (
    key           TEXT PRIMARY KEY NOT NULL,
    value         TEXT NOT NULL
);
INSERT INTO app_settings (key, value) VALUES ('theme_mode', 'system');

PRAGMA user_version = 1;
COMMIT;
