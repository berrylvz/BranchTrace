use super::schema::initialize_connection;
use super::support::{date_string, db_error, with_write_tx};
use crate::models::{ApiError, ErrorCode, ItemStatus, TrashKind};
use chrono::{Duration, NaiveDate};
use rusqlite::{params, Connection};
use std::ffi::OsString;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DemoSeedSummary {
    pub anchor_today: String,
    pub visible_project_count: usize,
    pub trashed_project_count: usize,
    pub progress_record_count: usize,
    pub visible_reminder_count: usize,
    pub trashed_reminder_count: usize,
    pub project_trash_entry_count: usize,
    pub reminder_trash_entry_count: usize,
}

struct TrashEntrySeed {
    id: &'static str,
    kind: TrashKind,
    root_entity_id: &'static str,
    title_snapshot: &'static str,
    affected_count: i64,
    deleted_offset: i64,
    deleted_hour: u8,
    deleted_minute: u8,
}

struct ProjectSeed {
    id: &'static str,
    parent_id: Option<&'static str>,
    title: &'static str,
    status: ItemStatus,
    completed_offset: Option<i64>,
    canceled_offset: Option<i64>,
    sort_order: i64,
    is_expanded: bool,
    progress_offsets: &'static [i64],
    trash_entry_id: Option<&'static str>,
    deleted_offset: Option<(i64, u8, u8)>,
}

struct ReminderSeed {
    id: &'static str,
    title: &'static str,
    scheduled_offset: i64,
    status: ItemStatus,
    completed_offset: Option<(i64, u8, u8)>,
    canceled_offset: Option<i64>,
    sort_order: i64,
    trash_entry_id: Option<&'static str>,
    deleted_offset: Option<(i64, u8, u8)>,
}

const TRASH_Q3_READING: &str = "b7e10001-4a3c-4f90-8100-000000000001";
const TRASH_LEGACY_THEME: &str = "b7e10002-4a3c-4f90-8100-000000000002";
const TRASH_OLD_MOBILE: &str = "b7e10003-4a3c-4f90-8100-000000000003";
const TRASH_PUSH_SPIKE: &str = "b7e10004-4a3c-4f90-8100-000000000004";
const TRASH_REM_VENUE: &str = "b7e20001-4a3c-4f90-8200-000000000001";
const TRASH_REM_ADAPTERS: &str = "b7e20002-4a3c-4f90-8200-000000000002";
const TRASH_REM_Q2_RETRO: &str = "b7e20003-4a3c-4f90-8200-000000000003";

const P_RELEASE: &str = "10000001-7b2d-4e8a-9c10-000000000001";
const P_PORTABILITY: &str = "10000002-7b2d-4e8a-9c10-000000000002";
const P_FIXTURE_GEN: &str = "10000003-7b2d-4e8a-9c10-000000000003";
const P_CLI_SWITCH: &str = "10000004-7b2d-4e8a-9c10-000000000004";
const P_STARTUP_FALLBACK: &str = "10000005-7b2d-4e8a-9c10-000000000005";
const P_MONTHLY_POLISH: &str = "10000006-7b2d-4e8a-9c10-000000000006";
const P_A11Y_AUDIT: &str = "10000007-7b2d-4e8a-9c10-000000000007";
const P_OVERDUE_BANNER: &str = "10000008-7b2d-4e8a-9c10-000000000008";
const P_CLOUD_SYNC: &str = "10000009-7b2d-4e8a-9c10-000000000009";
const P_EXPORT_NOTES: &str = "10000010-7b2d-4e8a-9c10-000000000010";
// Shared 4-char prefix ("a4c1") guarantees identical shortId disambiguation ("a4c1e" vs "a4c1f")
// in both Weekly view and MoveProjectDialog.
const P_CHECKLIST_ACTIVE: &str = "a4c1e001-7b2d-4e8a-9c10-000000000011";
const P_CHECKLIST_DONE: &str = "a4c1f002-7b2d-4e8a-9c10-000000000012";

const P_RUST_MASTERY: &str = "20000001-7b2d-4e8a-9c20-000000000001";
const P_SQLITE_WAL: &str = "20000002-7b2d-4e8a-9c20-000000000002";
const P_BTREE_NOTES: &str = "20000003-7b2d-4e8a-9c20-000000000003";
const P_TX_ISOLATION: &str = "20000004-7b2d-4e8a-9c20-000000000004";
const P_ASYNC_RUNTIME: &str = "20000005-7b2d-4e8a-9c20-000000000005";
const P_TOKIO_CHANNELS: &str = "20000006-7b2d-4e8a-9c20-000000000006";
const P_GRACEFUL_SHUTDOWN: &str = "20000007-7b2d-4e8a-9c20-000000000007";

const P_MARATHON: &str = "30000001-7b2d-4e8a-9c30-000000000001";
const P_10K_TEMPO: &str = "30000002-7b2d-4e8a-9c30-000000000002";
const P_LONG_RUN: &str = "30000003-7b2d-4e8a-9c30-000000000003";
const P_MOBILITY: &str = "30000004-7b2d-4e8a-9c30-000000000004";

const P_HOME_STUDIO: &str = "40000001-7b2d-4e8a-9c40-000000000001";
const P_CABLE_MGMT: &str = "40000002-7b2d-4e8a-9c40-000000000002";
const P_ACOUSTIC_FOAM: &str = "40000003-7b2d-4e8a-9c40-000000000003";

const P_TRASH_READING: &str = "50000001-7b2d-4e8a-9c50-000000000001";
const P_TRASH_THEME: &str = "50000002-7b2d-4e8a-9c50-000000000002";
const P_TRASH_PALETTE: &str = "50000003-7b2d-4e8a-9c50-000000000003";
const P_TRASH_MOBILE: &str = "50000004-7b2d-4e8a-9c50-000000000004";
const P_TRASH_WIREFRAME: &str = "50000005-7b2d-4e8a-9c50-000000000005";
const P_TRASH_PUSH: &str = "50000006-7b2d-4e8a-9c50-000000000006";

const R_TRASH_VENUE: &str = "90000019-7b2d-4e8a-9c90-000000000019";
const R_TRASH_ADAPTERS: &str = "90000020-7b2d-4e8a-9c90-000000000020";
const R_TRASH_Q2_RETRO: &str = "90000021-7b2d-4e8a-9c90-000000000021";

const TRASH_SEEDS: &[TrashEntrySeed] = &[
    TrashEntrySeed {
        id: TRASH_Q3_READING,
        kind: TrashKind::Project,
        root_entity_id: P_TRASH_READING,
        title_snapshot: "Q3 Reading List Cleanup",
        affected_count: 1,
        deleted_offset: -1,
        deleted_hour: 15,
        deleted_minute: 20,
    },
    TrashEntrySeed {
        id: TRASH_LEGACY_THEME,
        kind: TrashKind::Project,
        root_entity_id: P_TRASH_THEME,
        title_snapshot: "Legacy Theme Prototype",
        affected_count: 2,
        deleted_offset: -2,
        deleted_hour: 11,
        deleted_minute: 40,
    },
    TrashEntrySeed {
        id: TRASH_OLD_MOBILE,
        kind: TrashKind::Project,
        root_entity_id: P_TRASH_MOBILE,
        title_snapshot: "Old Mobile Companion Idea",
        affected_count: 2,
        deleted_offset: -3,
        deleted_hour: 16,
        deleted_minute: 10,
    },
    TrashEntrySeed {
        id: TRASH_PUSH_SPIKE,
        kind: TrashKind::Project,
        root_entity_id: P_TRASH_PUSH,
        title_snapshot: "Push Notification Spike",
        affected_count: 1,
        deleted_offset: -5,
        deleted_hour: 9,
        deleted_minute: 30,
    },
    TrashEntrySeed {
        id: TRASH_REM_VENUE,
        kind: TrashKind::Reminder,
        root_entity_id: R_TRASH_VENUE,
        title_snapshot: "Confirm venue deposit",
        affected_count: 1,
        deleted_offset: -1,
        deleted_hour: 18,
        deleted_minute: 5,
    },
    TrashEntrySeed {
        id: TRASH_REM_ADAPTERS,
        kind: TrashKind::Reminder,
        root_entity_id: R_TRASH_ADAPTERS,
        title_snapshot: "Buy extra USB-C adapters",
        affected_count: 1,
        deleted_offset: -2,
        deleted_hour: 13,
        deleted_minute: 25,
    },
    TrashEntrySeed {
        id: TRASH_REM_Q2_RETRO,
        kind: TrashKind::Reminder,
        root_entity_id: R_TRASH_Q2_RETRO,
        title_snapshot: "Draft Q2 retrospective",
        affected_count: 1,
        deleted_offset: -4,
        deleted_hour: 17,
        deleted_minute: 45,
    },
];

const PROJECT_SEEDS: &[ProjectSeed] = &[
    // Root 1: Software Engineering flagship tree (4 levels deep, mixed statuses, duplicates)
    ProjectSeed {
        id: P_RELEASE,
        parent_id: None,
        title: "BranchTrace v1.2 Release",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 1024,
        is_expanded: true,
        progress_offsets: &[-33, -22, -15, -9, -5, -2, 0],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_PORTABILITY,
        parent_id: Some(P_RELEASE),
        title: "Data Portability & Demo Mode",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 1024,
        is_expanded: true,
        progress_offsets: &[-8, -4, -1, 0],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_FIXTURE_GEN,
        parent_id: Some(P_PORTABILITY),
        title: "SQLite Fixture Generator",
        status: ItemStatus::Completed,
        completed_offset: Some(0),
        canceled_offset: None,
        sort_order: 1024,
        is_expanded: true,
        progress_offsets: &[-3, -1, 0],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_CLI_SWITCH,
        parent_id: Some(P_PORTABILITY),
        title: "CLI Database Path Switch",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 2048,
        is_expanded: true,
        progress_offsets: &[-3, -1],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_STARTUP_FALLBACK,
        parent_id: Some(P_CLI_SWITCH),
        title: "Startup Validation & Fallback",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 1024,
        is_expanded: true,
        progress_offsets: &[0],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_MONTHLY_POLISH,
        parent_id: Some(P_RELEASE),
        title: "Monthly Calendar Polish",
        status: ItemStatus::Completed,
        completed_offset: Some(-2),
        canceled_offset: None,
        sort_order: 2048,
        is_expanded: true,
        progress_offsets: &[-11, -6, -4, -2],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_A11Y_AUDIT,
        parent_id: Some(P_MONTHLY_POLISH),
        title: "Keyboard Accessibility Audit",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 1024,
        is_expanded: true,
        progress_offsets: &[-1],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_OVERDUE_BANNER,
        parent_id: Some(P_MONTHLY_POLISH),
        title: "Overdue Banner Layout",
        status: ItemStatus::Completed,
        completed_offset: Some(-4),
        canceled_offset: None,
        sort_order: 2048,
        is_expanded: true,
        progress_offsets: &[-6, -5],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_CLOUD_SYNC,
        parent_id: Some(P_RELEASE),
        title: "Cross-Device Cloud Sync (Deferred)",
        status: ItemStatus::Canceled,
        completed_offset: None,
        canceled_offset: Some(-3),
        sort_order: 3072,
        is_expanded: true,
        progress_offsets: &[-12, -7, -5],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_EXPORT_NOTES,
        parent_id: Some(P_CLOUD_SYNC),
        title: "Local Export Format Notes",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 1024,
        is_expanded: true,
        progress_offsets: &[],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_CHECKLIST_ACTIVE,
        parent_id: Some(P_RELEASE),
        title: "Release Checklist",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 4096,
        is_expanded: true,
        progress_offsets: &[-2, 0],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_CHECKLIST_DONE,
        parent_id: Some(P_RELEASE),
        title: "Release Checklist",
        status: ItemStatus::Completed,
        completed_offset: Some(0),
        canceled_offset: None,
        sort_order: 5120,
        is_expanded: true,
        progress_offsets: &[],
        trash_entry_id: None,
        deleted_offset: None,
    },
    // Root 2: Personal Systems Learning (cross-month cadence & collapsed sub-branch)
    ProjectSeed {
        id: P_RUST_MASTERY,
        parent_id: None,
        title: "Systems & Rust Mastery",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 2048,
        is_expanded: true,
        progress_offsets: &[-40, -35, -26, -19, -14, -10, -6, -3, -1],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_SQLITE_WAL,
        parent_id: Some(P_RUST_MASTERY),
        title: "SQLite Internals & WAL",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 1024,
        is_expanded: true,
        progress_offsets: &[-28, -16, -9, -4, -2, 0],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_BTREE_NOTES,
        parent_id: Some(P_SQLITE_WAL),
        title: "B-Tree Page Layout Notes",
        status: ItemStatus::Completed,
        completed_offset: Some(-1),
        canceled_offset: None,
        sort_order: 1024,
        is_expanded: true,
        progress_offsets: &[-3, -1],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_TX_ISOLATION,
        parent_id: Some(P_SQLITE_WAL),
        title: "Transaction Isolation Lab",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 2048,
        is_expanded: true,
        progress_offsets: &[-4, 0],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_ASYNC_RUNTIME,
        parent_id: Some(P_RUST_MASTERY),
        title: "Async Runtime Deep Dive",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 2048,
        is_expanded: false,
        progress_offsets: &[-6, -2],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_TOKIO_CHANNELS,
        parent_id: Some(P_ASYNC_RUNTIME),
        title: "Tokio Channel Patterns",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 1024,
        is_expanded: true,
        progress_offsets: &[-8, -5],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_GRACEFUL_SHUTDOWN,
        parent_id: Some(P_ASYNC_RUNTIME),
        title: "Graceful Worker Shutdown",
        status: ItemStatus::Completed,
        completed_offset: Some(-6),
        canceled_offset: None,
        sort_order: 2048,
        is_expanded: true,
        progress_offsets: &[-7],
        trash_entry_id: None,
        deleted_offset: None,
    },
    // Root 3: Fitness / Habit Routine
    ProjectSeed {
        id: P_MARATHON,
        parent_id: None,
        title: "Half-Marathon Training",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 3072,
        is_expanded: true,
        progress_offsets: &[-31, -25, -20, -16, -12, -9, -7, -4, -2, 0],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_10K_TEMPO,
        parent_id: Some(P_MARATHON),
        title: "10K Tempo Milestone",
        status: ItemStatus::Completed,
        completed_offset: Some(-5),
        canceled_offset: None,
        sort_order: 1024,
        is_expanded: true,
        progress_offsets: &[-12, -9, -5],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_LONG_RUN,
        parent_id: Some(P_MARATHON),
        title: "Long Run Progression",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 2048,
        is_expanded: true,
        progress_offsets: &[-14, -7, -2],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_MOBILITY,
        parent_id: Some(P_MARATHON),
        title: "Mobility & Recovery Routine",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 3072,
        is_expanded: true,
        progress_offsets: &[-3, -1, 0],
        trash_entry_id: None,
        deleted_offset: None,
    },
    // Root 4: Completed & collapsed life project
    ProjectSeed {
        id: P_HOME_STUDIO,
        parent_id: None,
        title: "Home Studio Upgrade",
        status: ItemStatus::Completed,
        completed_offset: Some(-3),
        canceled_offset: None,
        sort_order: 4096,
        is_expanded: false,
        progress_offsets: &[-13, -8, -4],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_CABLE_MGMT,
        parent_id: Some(P_HOME_STUDIO),
        title: "Desk Cable Management",
        status: ItemStatus::Completed,
        completed_offset: Some(-8),
        canceled_offset: None,
        sort_order: 1024,
        is_expanded: true,
        progress_offsets: &[-10, -8],
        trash_entry_id: None,
        deleted_offset: None,
    },
    ProjectSeed {
        id: P_ACOUSTIC_FOAM,
        parent_id: Some(P_HOME_STUDIO),
        title: "Acoustic Foam Panels",
        status: ItemStatus::Canceled,
        completed_offset: None,
        canceled_offset: Some(-6),
        sort_order: 2048,
        is_expanded: true,
        progress_offsets: &[],
        trash_entry_id: None,
        deleted_offset: None,
    },
    // Soft-deleted projects (single, subtree, and nested trash batches)
    ProjectSeed {
        id: P_TRASH_READING,
        parent_id: None,
        title: "Q3 Reading List Cleanup",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 5120,
        is_expanded: true,
        progress_offsets: &[-12],
        trash_entry_id: Some(TRASH_Q3_READING),
        deleted_offset: Some((-1, 15, 20)),
    },
    ProjectSeed {
        id: P_TRASH_THEME,
        parent_id: None,
        title: "Legacy Theme Prototype",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 6144,
        is_expanded: true,
        progress_offsets: &[],
        trash_entry_id: Some(TRASH_LEGACY_THEME),
        deleted_offset: Some((-2, 11, 40)),
    },
    ProjectSeed {
        id: P_TRASH_PALETTE,
        parent_id: Some(P_TRASH_THEME),
        title: "High-Contrast Palette Draft",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 1024,
        is_expanded: true,
        progress_offsets: &[-15],
        trash_entry_id: Some(TRASH_LEGACY_THEME),
        deleted_offset: Some((-2, 11, 40)),
    },
    ProjectSeed {
        id: P_TRASH_MOBILE,
        parent_id: None,
        title: "Old Mobile Companion Idea",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 7168,
        is_expanded: true,
        progress_offsets: &[-18],
        trash_entry_id: Some(TRASH_OLD_MOBILE),
        deleted_offset: Some((-3, 16, 10)),
    },
    ProjectSeed {
        id: P_TRASH_WIREFRAME,
        parent_id: Some(P_TRASH_MOBILE),
        title: "Wireframe Sketches",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 1024,
        is_expanded: true,
        progress_offsets: &[],
        trash_entry_id: Some(TRASH_OLD_MOBILE),
        deleted_offset: Some((-3, 16, 10)),
    },
    ProjectSeed {
        id: P_TRASH_PUSH,
        parent_id: Some(P_TRASH_MOBILE),
        title: "Push Notification Spike",
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 2048,
        is_expanded: true,
        progress_offsets: &[-21],
        trash_entry_id: Some(TRASH_PUSH_SPIKE),
        deleted_offset: Some((-5, 9, 30)),
    },
];

const REMINDER_SEEDS: &[ReminderSeed] = &[
    // Overdue reminders (including a cross-month overdue item)
    ReminderSeed {
        id: "90000001-7b2d-4e8a-9c90-000000000001",
        title: "Renew annual SSL certificate",
        scheduled_offset: -34,
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 1024,
        trash_entry_id: None,
        deleted_offset: None,
    },
    ReminderSeed {
        id: "90000002-7b2d-4e8a-9c90-000000000002",
        title: "Submit quarterly expense receipts",
        scheduled_offset: -4,
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 1024,
        trash_entry_id: None,
        deleted_offset: None,
    },
    ReminderSeed {
        id: "90000003-7b2d-4e8a-9c90-000000000003",
        title: "Follow up with dentist on checkup",
        scheduled_offset: -1,
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 1024,
        trash_entry_id: None,
        deleted_offset: None,
    },
    // Today planned (active, same-day completed, canceled)
    ReminderSeed {
        id: "90000004-7b2d-4e8a-9c90-000000000004",
        title: "Review v1.2 changelog draft",
        scheduled_offset: 0,
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 1024,
        trash_entry_id: None,
        deleted_offset: None,
    },
    ReminderSeed {
        id: "90000005-7b2d-4e8a-9c90-000000000005",
        title: "Backup local SQLite databases",
        scheduled_offset: 0,
        status: ItemStatus::Completed,
        completed_offset: Some((0, 9, 15)),
        canceled_offset: None,
        sort_order: 2048,
        trash_entry_id: None,
        deleted_offset: None,
    },
    ReminderSeed {
        id: "90000006-7b2d-4e8a-9c90-000000000006",
        title: "Call courier about morning delivery",
        scheduled_offset: 0,
        status: ItemStatus::Canceled,
        completed_offset: None,
        canceled_offset: Some(0),
        sort_order: 3072,
        trash_entry_id: None,
        deleted_offset: None,
    },
    // Cross-day completed today (one overdue catch-up, one completed early)
    ReminderSeed {
        id: "90000007-7b2d-4e8a-9c90-000000000007",
        title: "Send architecture review notes",
        scheduled_offset: -3,
        status: ItemStatus::Completed,
        completed_offset: Some((0, 8, 30)),
        canceled_offset: None,
        sort_order: 1024,
        trash_entry_id: None,
        deleted_offset: None,
    },
    ReminderSeed {
        id: "90000008-7b2d-4e8a-9c90-000000000008",
        title: "Prepare sprint retrospective slides",
        scheduled_offset: 2,
        status: ItemStatus::Completed,
        completed_offset: Some((0, 10, 45)),
        canceled_offset: None,
        sort_order: 1024,
        trash_entry_id: None,
        deleted_offset: None,
    },
    // Historical reminders
    ReminderSeed {
        id: "90000009-7b2d-4e8a-9c90-000000000009",
        title: "Pay monthly internet bill",
        scheduled_offset: -2,
        status: ItemStatus::Completed,
        completed_offset: Some((-2, 14, 0)),
        canceled_offset: None,
        sort_order: 1024,
        trash_entry_id: None,
        deleted_offset: None,
    },
    ReminderSeed {
        id: "90000010-7b2d-4e8a-9c90-000000000010",
        title: "Order ergonomic keyboard switches",
        scheduled_offset: -5,
        status: ItemStatus::Completed,
        completed_offset: Some((-3, 16, 20)),
        canceled_offset: None,
        sort_order: 1024,
        trash_entry_id: None,
        deleted_offset: None,
    },
    ReminderSeed {
        id: "90000011-7b2d-4e8a-9c90-000000000011",
        title: "Book coworking desk for workshop",
        scheduled_offset: -6,
        status: ItemStatus::Canceled,
        completed_offset: None,
        canceled_offset: Some(-6),
        sort_order: 1024,
        trash_entry_id: None,
        deleted_offset: None,
    },
    ReminderSeed {
        id: "90000012-7b2d-4e8a-9c90-000000000012",
        title: "Review monthly budget sheet",
        scheduled_offset: -10,
        status: ItemStatus::Completed,
        completed_offset: Some((-10, 11, 0)),
        canceled_offset: None,
        sort_order: 1024,
        trash_entry_id: None,
        deleted_offset: None,
    },
    // Upcoming planned reminders
    ReminderSeed {
        id: "90000013-7b2d-4e8a-9c90-000000000013",
        title: "Sync with Alex on v1.2 QA plan",
        scheduled_offset: 1,
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 1024,
        trash_entry_id: None,
        deleted_offset: None,
    },
    ReminderSeed {
        id: "90000014-7b2d-4e8a-9c90-000000000014",
        title: "Pick up running shoes from locker",
        scheduled_offset: 1,
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 2048,
        trash_entry_id: None,
        deleted_offset: None,
    },
    ReminderSeed {
        id: "90000015-7b2d-4e8a-9c90-000000000015",
        title: "Draft release announcement post",
        scheduled_offset: 3,
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 1024,
        trash_entry_id: None,
        deleted_offset: None,
    },
    ReminderSeed {
        id: "90000016-7b2d-4e8a-9c90-000000000016",
        title: "Schedule car maintenance service",
        scheduled_offset: 5,
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 1024,
        trash_entry_id: None,
        deleted_offset: None,
    },
    ReminderSeed {
        id: "90000017-7b2d-4e8a-9c90-000000000017",
        title: "Quarterly health checkup appointment",
        scheduled_offset: 12,
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 1024,
        trash_entry_id: None,
        deleted_offset: None,
    },
    ReminderSeed {
        id: "90000018-7b2d-4e8a-9c90-000000000018",
        title: "Renew domain registration",
        scheduled_offset: 28,
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 1024,
        trash_entry_id: None,
        deleted_offset: None,
    },
    // Soft-deleted reminders
    ReminderSeed {
        id: R_TRASH_VENUE,
        title: "Confirm venue deposit",
        scheduled_offset: -2,
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 2048,
        trash_entry_id: Some(TRASH_REM_VENUE),
        deleted_offset: Some((-1, 18, 5)),
    },
    ReminderSeed {
        id: R_TRASH_ADAPTERS,
        title: "Buy extra USB-C adapters",
        scheduled_offset: 4,
        status: ItemStatus::Active,
        completed_offset: None,
        canceled_offset: None,
        sort_order: 1024,
        trash_entry_id: Some(TRASH_REM_ADAPTERS),
        deleted_offset: Some((-2, 13, 25)),
    },
    ReminderSeed {
        id: R_TRASH_Q2_RETRO,
        title: "Draft Q2 retrospective",
        scheduled_offset: -8,
        status: ItemStatus::Completed,
        completed_offset: Some((-7, 18, 0)),
        canceled_offset: None,
        sort_order: 1024,
        trash_entry_id: Some(TRASH_REM_Q2_RETRO),
        deleted_offset: Some((-4, 17, 45)),
    },
];

fn shift_date(anchor: NaiveDate, days: i64) -> Result<NaiveDate, ApiError> {
    anchor
        .checked_add_signed(Duration::days(days))
        .ok_or_else(|| ApiError::new(ErrorCode::InvalidDate, "Demo anchor date out of range"))
}

fn shifted_iso(anchor: NaiveDate, days: i64) -> Result<String, ApiError> {
    Ok(date_string(shift_date(anchor, days)?))
}

fn shifted_timestamp(
    anchor: NaiveDate,
    days: i64,
    hour: u8,
    minute: u8,
) -> Result<String, ApiError> {
    Ok(format!(
        "{}T{:02}:{:02}:00Z",
        shifted_iso(anchor, days)?,
        hour,
        minute
    ))
}

fn sidecar_path(base: &Path, suffix: &str) -> PathBuf {
    let mut raw = OsString::from(base.as_os_str());
    raw.push(suffix);
    PathBuf::from(raw)
}

fn remove_file_if_exists(path: &Path) -> Result<(), ApiError> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ApiError::new(
            ErrorCode::DbError,
            format!("Unable to remove existing file {}: {error}", path.display()),
        )),
    }
}

pub fn populate_demo_data(
    connection: &mut Connection,
    anchor_today: NaiveDate,
) -> Result<DemoSeedSummary, ApiError> {
    let existing_rows: i64 = connection
        .query_row(
            "SELECT (SELECT COUNT(*) FROM projects) + (SELECT COUNT(*) FROM reminders) + (SELECT COUNT(*) FROM trash_entries)",
            [],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if existing_rows > 0 {
        return Err(ApiError::new(
            ErrorCode::InvalidInput,
            "Refusing to populate demo data into a non-empty database",
        ));
    }

    let created_base = shifted_timestamp(anchor_today, -45, 8, 0)?;
    let updated_base = shifted_timestamp(anchor_today, 0, 10, 0)?;

    let summary = with_write_tx(connection, |tx| {
        let mut project_trash_entry_count = 0;
        let mut reminder_trash_entry_count = 0;
        for entry in TRASH_SEEDS {
            let deleted_at = shifted_timestamp(
                anchor_today,
                entry.deleted_offset,
                entry.deleted_hour,
                entry.deleted_minute,
            )?;
            tx.execute(
                "INSERT INTO trash_entries(id,kind,root_entity_id,title_snapshot,affected_count,deleted_at) VALUES(?1,?2,?3,?4,?5,?6)",
                params![
                    entry.id,
                    entry.kind,
                    entry.root_entity_id,
                    entry.title_snapshot,
                    entry.affected_count,
                    deleted_at
                ],
            )
            .map_err(db_error)?;
            match entry.kind {
                TrashKind::Project => project_trash_entry_count += 1,
                TrashKind::Reminder => reminder_trash_entry_count += 1,
            }
        }

        let mut visible_project_count = 0;
        let mut trashed_project_count = 0;
        let mut progress_record_count = 0;

        for project in PROJECT_SEEDS {
            let completed_date = project
                .completed_offset
                .map(|offset| shifted_iso(anchor_today, offset))
                .transpose()?;
            let canceled_date = project
                .canceled_offset
                .map(|offset| shifted_iso(anchor_today, offset))
                .transpose()?;
            let deleted_at = project
                .deleted_offset
                .map(|(offset, hour, minute)| shifted_timestamp(anchor_today, offset, hour, minute))
                .transpose()?;
            let updated_at = deleted_at.as_deref().unwrap_or(updated_base.as_str());

            tx.execute(
                "INSERT INTO projects(id,parent_id,title,status,completed_date,canceled_date,sort_order,version,created_at,updated_at,deleted_at,trash_entry_id)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,0,?8,?9,?10,?11)",
                params![
                    project.id,
                    project.parent_id,
                    project.title,
                    project.status,
                    completed_date,
                    canceled_date,
                    project.sort_order,
                    created_base,
                    updated_at,
                    deleted_at,
                    project.trash_entry_id
                ],
            )
            .map_err(db_error)?;

            tx.execute(
                "INSERT INTO project_ui_states(project_id,is_expanded) VALUES(?1,?2)",
                params![project.id, if project.is_expanded { 1 } else { 0 }],
            )
            .map_err(db_error)?;

            for &offset in project.progress_offsets {
                let progress_date = shifted_iso(anchor_today, offset)?;
                let recorded_at = shifted_timestamp(anchor_today, offset, 19, 0)?;
                tx.execute(
                    "INSERT INTO progress_records(project_id,progress_date,created_at) VALUES(?1,?2,?3)",
                    params![project.id, progress_date, recorded_at],
                )
                .map_err(db_error)?;
                progress_record_count += 1;
            }

            if project.trash_entry_id.is_some() {
                trashed_project_count += 1;
            } else {
                visible_project_count += 1;
            }
        }

        let mut visible_reminder_count = 0;
        let mut trashed_reminder_count = 0;

        for reminder in REMINDER_SEEDS {
            let scheduled_date = shifted_iso(anchor_today, reminder.scheduled_offset)?;
            let completed_date = reminder
                .completed_offset
                .map(|(offset, _, _)| shifted_iso(anchor_today, offset))
                .transpose()?;
            let completed_action_at = reminder
                .completed_offset
                .map(|(offset, hour, minute)| shifted_timestamp(anchor_today, offset, hour, minute))
                .transpose()?;
            let canceled_date = reminder
                .canceled_offset
                .map(|offset| shifted_iso(anchor_today, offset))
                .transpose()?;
            let deleted_at = reminder
                .deleted_offset
                .map(|(offset, hour, minute)| shifted_timestamp(anchor_today, offset, hour, minute))
                .transpose()?;
            let updated_at = deleted_at
                .as_deref()
                .or(completed_action_at.as_deref())
                .unwrap_or(updated_base.as_str());

            tx.execute(
                "INSERT INTO reminders(id,title,scheduled_date,status,completed_date,completed_action_at,canceled_date,sort_order,version,created_at,updated_at,deleted_at,trash_entry_id)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,0,?9,?10,?11,?12)",
                params![
                    reminder.id,
                    reminder.title,
                    scheduled_date,
                    reminder.status,
                    completed_date,
                    completed_action_at,
                    canceled_date,
                    reminder.sort_order,
                    created_base,
                    updated_at,
                    deleted_at,
                    reminder.trash_entry_id
                ],
            )
            .map_err(db_error)?;

            if reminder.trash_entry_id.is_some() {
                trashed_reminder_count += 1;
            } else {
                visible_reminder_count += 1;
            }
        }

        Ok(DemoSeedSummary {
            anchor_today: date_string(anchor_today),
            visible_project_count,
            trashed_project_count,
            progress_record_count,
            visible_reminder_count,
            trashed_reminder_count,
            project_trash_entry_count,
            reminder_trash_entry_count,
        })
    })?;

    {
        let mut statement = connection
            .prepare("PRAGMA foreign_key_check")
            .map_err(db_error)?;
        let mut rows = statement.query([]).map_err(db_error)?;
        if rows.next().map_err(db_error)?.is_some() {
            return Err(ApiError::new(
                ErrorCode::DbError,
                "Demo database failed foreign key integrity check",
            ));
        }
    }

    Ok(summary)
}

pub fn create_demo_database_file(
    path: &Path,
    anchor_today: NaiveDate,
    force: bool,
) -> Result<DemoSeedSummary, ApiError> {
    if path.exists() {
        if !force {
            return Err(ApiError::new(
                ErrorCode::InvalidInput,
                format!(
                    "Refusing to overwrite existing database at {} (pass --force to replace it)",
                    path.display()
                ),
            ));
        }
        remove_file_if_exists(path)?;
        remove_file_if_exists(&sidecar_path(path, "-wal"))?;
        remove_file_if_exists(&sidecar_path(path, "-shm"))?;
    }

    if let Some(parent) = path.parent().filter(|dir| !dir.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|error| {
            ApiError::new(
                ErrorCode::DbError,
                format!("Unable to create directory {}: {error}", parent.display()),
            )
        })?;
    }

    let mut connection = initialize_connection(path)?;
    let summary = populate_demo_data(&mut connection, anchor_today)?;

    // Flush WAL into the single .sqlite3 file so it can be moved or opened cleanly anywhere.
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;")
        .map_err(db_error)?;
    drop(connection);

    Ok(summary)
}
