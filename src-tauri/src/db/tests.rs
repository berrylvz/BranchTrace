use super::projects::{
    create_project, get_project_detail, get_project_progress_month, get_project_tree,
    get_project_tree_on, rename_project, reorder_project_siblings, restore_project,
    set_all_projects_expanded, set_project_expanded, set_project_progress, set_project_progress_on,
    set_project_terminal, update_project_terminal_date,
};
use super::reminders::{
    complete_reminder, complete_reminder_on, create_reminder, create_reminder_on,
    reorder_reminders, update_reminder_completed_date,
};
use super::repo::{project_record_by_id, tree_order};
use super::schema::{initialize_connection, initialize_in_memory};
use super::settings::{get_app_settings, set_theme_mode};
use super::support::{clock_context, date_string, local_today, now_utc, parse_date};
use super::trash::{
    empty_trash, hard_delete_project_tx, list_trash, permanently_delete_trash_entry,
    preview_project_trash, restore_trash_entry, trash_project, trash_reminder,
};
use super::views::{
    apply_short_ids, get_daily_week, get_daily_week_on, get_month_calendar, get_month_calendar_on,
};
use super::worker::DbHandle;
use crate::models::{
    ApiError, ErrorCode, ItemStatus, ProjectDailyItem, ProjectRecord, TerminalStatus, ThemeMode,
};
use chrono::{Datelike, Duration, NaiveDate};
use rusqlite::{params, Connection};
use uuid::Uuid;

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
        status: ItemStatus::Active,
        completed_date: None,
        canceled_date: None,
        sort_order: 1024,
        version: 0,
        is_expanded: true,
    };
    let child = ProjectRecord {
        id: "child".into(),
        parent_id: Some("root".into()),
        title: "Child".into(),
        status: ItemStatus::Active,
        completed_date: None,
        canceled_date: None,
        sort_order: 1024,
        version: 0,
        is_expanded: true,
    };
    let sibling = ProjectRecord {
        id: "sibling".into(),
        parent_id: None,
        title: "Sibling".into(),
        status: ItemStatus::Active,
        completed_date: None,
        canceled_date: None,
        sort_order: 2048,
        version: 0,
        is_expanded: true,
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
        status: ItemStatus::Active,
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
    let root_id = create_project(&mut connection, "目标", None).unwrap().id;
    let today = date_string(local_today());
    let progressed =
        set_project_progress(&mut connection, &root_id, Some(today.clone()), true, 0).unwrap();
    let completed = set_project_terminal(
        &mut connection,
        &root_id,
        progressed.version,
        TerminalStatus::Completed,
    )
    .unwrap();
    assert_eq!(completed.status, ItemStatus::Completed);
    let restored = restore_project(&mut connection, &root_id, completed.version).unwrap();
    assert_eq!(restored.status, ItemStatus::Active);

    let reminder_id = create_reminder(&mut connection, "回顾", &today).unwrap().id;
    let week = clock_context();
    let daily = get_daily_week(&connection, &week.week_start).unwrap();
    assert_eq!(daily.days.len(), 7);
    let done = complete_reminder(&mut connection, &reminder_id, 0).unwrap();
    assert_eq!(done.status, ItemStatus::Completed);
}

#[test]
fn trash_restore_and_permanent_delete_round_trip() {
    let mut connection = test_connection();
    let root_id = create_project(&mut connection, "父", None).unwrap().id;
    let child_id = create_project(&mut connection, "子", Some(root_id.clone()))
        .unwrap()
        .id;
    assert!(!child_id.is_empty());
    let entry_id = trash_project(&mut connection, &root_id).unwrap().id;
    assert!(get_project_tree(&connection).unwrap().is_empty());
    let restored = restore_trash_entry(&mut connection, &entry_id).unwrap();
    assert_eq!(restored.restored_count, 2);

    let entry_id = trash_project(&mut connection, &root_id).unwrap().id;
    let deleted = permanently_delete_trash_entry(&mut connection, &entry_id).unwrap();
    assert_eq!(deleted.deleted_project_count, 2);
    assert!(get_project_tree(&connection).unwrap().is_empty());
}

#[test]
fn bulk_expansion_updates_hidden_and_terminal_projects_without_business_changes() {
    let mut connection = test_connection();
    let root = expansion_test_project(&mut connection, "父", None);
    let child = expansion_test_project(&mut connection, "子", Some(&root));
    expansion_test_project(&mut connection, "孙", Some(&child));
    let completed = expansion_test_project(&mut connection, "完成", None);
    let canceled = expansion_test_project(&mut connection, "取消", None);
    set_project_terminal(&mut connection, &completed, 0, TerminalStatus::Completed).unwrap();
    set_project_terminal(&mut connection, &canceled, 0, TerminalStatus::Canceled).unwrap();
    set_project_progress(&mut connection, &root, None, true, 0).unwrap();
    let trashed = expansion_test_project(&mut connection, "回收站父", None);
    let trashed_child = expansion_test_project(&mut connection, "回收站子", Some(&trashed));
    trash_project(&mut connection, &trashed).unwrap();

    let original = expansion_test_snapshot(&connection);
    let mut collapsed = original.clone();
    for project in collapsed.as_array_mut().unwrap() {
        project["isExpanded"] = serde_json::json!(false);
    }
    let projects = set_all_projects_expanded(&mut connection, false).unwrap();
    assert_eq!(serde_json::to_value(projects).unwrap(), collapsed);
    for id in [&trashed, &trashed_child] {
        assert!(
            project_record_by_id(&connection, id, true)
                .unwrap()
                .unwrap()
                .is_expanded
        );
    }

    set_project_expanded(&mut connection, &root, true).unwrap();
    assert!(
        !project_record_by_id(&connection, &child, false)
            .unwrap()
            .unwrap()
            .is_expanded
    );
    set_all_projects_expanded(&mut connection, false).unwrap();
    set_all_projects_expanded(&mut connection, false).unwrap();
    assert_eq!(expansion_test_snapshot(&connection), collapsed);
    set_all_projects_expanded(&mut connection, true).unwrap();
    set_all_projects_expanded(&mut connection, true).unwrap();
    assert_eq!(expansion_test_snapshot(&connection), original);
}

#[test]
fn bulk_expansion_creates_missing_ui_states_and_accepts_empty_trees() {
    let mut connection = test_connection();
    assert!(set_all_projects_expanded(&mut connection, false)
        .unwrap()
        .is_empty());
    let root = expansion_test_project(&mut connection, "父", None);
    let child = expansion_test_project(&mut connection, "子", Some(&root));
    connection
        .execute(
            "DELETE FROM project_ui_states WHERE project_id=?1",
            params![root],
        )
        .unwrap();
    set_project_expanded(&mut connection, &child, false).unwrap();
    set_all_projects_expanded(&mut connection, false).unwrap();
    assert!(expansion_test_snapshot(&connection)
        .as_array()
        .unwrap()
        .iter()
        .all(|project| project["isExpanded"] == false));
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM project_ui_states", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        2
    );
    set_all_projects_expanded(&mut connection, true).unwrap();
    assert!(expansion_test_snapshot(&connection)
        .as_array()
        .unwrap()
        .iter()
        .all(|project| project["isExpanded"] == true));
}

#[test]
fn bulk_expansion_rolls_back_earlier_rows_when_a_later_write_fails() {
    let mut connection = test_connection();
    let root = expansion_test_project(&mut connection, "父", None);
    expansion_test_project(&mut connection, "子", Some(&root));
    let original = expansion_test_snapshot(&connection);
    // FAIL retains earlier statement writes; the surrounding transaction must undo them.
    connection
        .execute_batch(
            "CREATE TEMP TRIGGER fail_bulk_expansion BEFORE INSERT ON project_ui_states
             WHEN NEW.is_expanded=0 AND EXISTS(SELECT 1 FROM project_ui_states WHERE is_expanded=0)
             BEGIN SELECT RAISE(FAIL, 'injected expansion failure'); END;",
        )
        .unwrap();
    let error = set_all_projects_expanded(&mut connection, false).unwrap_err();
    assert_eq!(error.code, ErrorCode::DbError);
    assert_eq!(expansion_test_snapshot(&connection), original);
    connection
        .execute_batch("DROP TRIGGER fail_bulk_expansion;")
        .unwrap();
    set_all_projects_expanded(&mut connection, false).unwrap();
    assert!(expansion_test_snapshot(&connection)
        .as_array()
        .unwrap()
        .iter()
        .all(|project| project["isExpanded"] == false));
}

#[test]
fn bulk_expansion_persists_when_the_database_is_reopened() {
    let path =
        std::env::temp_dir().join(format!("branchtrace-expansion-{}.sqlite3", Uuid::new_v4()));
    {
        let mut connection = initialize_connection(&path).unwrap();
        let root = expansion_test_project(&mut connection, "父", None);
        expansion_test_project(&mut connection, "子", Some(&root));
        set_all_projects_expanded(&mut connection, false).unwrap();
    }
    {
        let mut connection = initialize_connection(&path).unwrap();
        assert!(expansion_test_snapshot(&connection)
            .as_array()
            .unwrap()
            .iter()
            .all(|project| project["isExpanded"] == false));
        set_all_projects_expanded(&mut connection, true).unwrap();
    }
    {
        let connection = initialize_connection(&path).unwrap();
        assert!(expansion_test_snapshot(&connection)
            .as_array()
            .unwrap()
            .iter()
            .all(|project| project["isExpanded"] == true));
    }
    std::fs::remove_file(path).unwrap();
}

fn expansion_test_project(
    connection: &mut Connection,
    title: &str,
    parent_id: Option<&str>,
) -> String {
    create_project(connection, title, parent_id.map(str::to_string))
        .unwrap()
        .id
}

fn expansion_test_snapshot(connection: &Connection) -> serde_json::Value {
    serde_json::to_value(get_project_tree(connection).unwrap()).unwrap()
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

#[test]
fn tree_order_handles_deep_trees_and_cycles_iteratively() {
    let depth = 10_000usize;
    let mut records = Vec::with_capacity(depth + 2);
    for index in 0..depth {
        records.push(ProjectRecord {
            id: format!("node-{index}"),
            parent_id: if index == 0 {
                None
            } else {
                Some(format!("node-{}", index - 1))
            },
            title: format!("Node {index}"),
            status: ItemStatus::Active,
            completed_date: None,
            canceled_date: None,
            sort_order: 1024,
            version: 0,
            is_expanded: true,
        });
    }
    records.push(ProjectRecord {
        id: "cycle-a".into(),
        parent_id: Some("cycle-b".into()),
        title: "Cycle A".into(),
        status: ItemStatus::Active,
        completed_date: None,
        canceled_date: None,
        sort_order: 1024,
        version: 0,
        is_expanded: true,
    });
    records.push(ProjectRecord {
        id: "cycle-b".into(),
        parent_id: Some("cycle-a".into()),
        title: "Cycle B".into(),
        status: ItemStatus::Active,
        completed_date: None,
        canceled_date: None,
        sort_order: 1024,
        version: 0,
        is_expanded: true,
    });
    let ordered = tree_order(&records);
    assert_eq!(ordered.len(), depth + 2);
    assert_eq!(ordered[0].id, "node-0");
    assert_eq!(ordered[depth - 1].id, format!("node-{}", depth - 1));
}

#[test]
fn db_handle_shutdown_drains_queued_writes_and_rejects_after_close() {
    let path =
        std::env::temp_dir().join(format!("branchtrace-shutdown-{}.sqlite3", Uuid::new_v4()));
    let handle = DbHandle::start(path.clone()).unwrap();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    let created_id = runtime.block_on(async {
        handle
            .call(|conn| create_project(conn, "关闭前写入", None))
            .await
            .unwrap()
            .id
    });
    handle.shutdown();
    handle.shutdown();

    let after_close = runtime.block_on(handle.call(|conn| get_project_tree(conn)));
    assert!(after_close.is_err());

    let connection = initialize_connection(&path).unwrap();
    assert!(project_record_by_id(&connection, &created_id, false)
        .unwrap()
        .is_some());
    drop(connection);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn db_handle_start_preserves_original_error_code_on_init_failure() {
    let future_path =
        std::env::temp_dir().join(format!("branchtrace-future-{}.sqlite3", Uuid::new_v4()));
    {
        let connection = Connection::open(&future_path).unwrap();
        connection
            .execute_batch("PRAGMA user_version = 99;")
            .unwrap();
    }
    let error = match DbHandle::start(future_path.clone()) {
        Ok(_) => panic!("expected migration error"),
        Err(error) => error,
    };
    assert_eq!(error.code, ErrorCode::MigrationError);
    let _ = std::fs::remove_file(&future_path);

    let dir_path = std::env::temp_dir().join(format!("branchtrace-dir-{}", Uuid::new_v4()));
    std::fs::create_dir(&dir_path).unwrap();
    let open_error = match DbHandle::start(dir_path.clone()) {
        Ok(_) => panic!("expected db open error when path is a directory"),
        Err(error) => error,
    };
    assert_eq!(open_error.code, ErrorCode::DbError);
    let _ = std::fs::remove_dir(&dir_path);
}

#[test]
fn nested_trash_batches_preserve_child_batch_on_parent_restore_and_clean_on_hard_delete() {
    let mut connection = test_connection();
    let parent_id = expansion_test_project(&mut connection, "父项目", None);
    let child_id = expansion_test_project(&mut connection, "子项目", Some(&parent_id));

    let child_entry = trash_project(&mut connection, &child_id).unwrap();
    assert_eq!(child_entry.affected_count_at_delete, 1);

    let preview = preview_project_trash(&connection, &parent_id).unwrap();
    assert_eq!(preview.active_node_count, 1);

    let parent_entry = trash_project(&mut connection, &parent_id).unwrap();
    assert_eq!(parent_entry.affected_count_at_delete, 1);
    assert_eq!(parent_entry.current_descendant_count, Some(2));

    let child_restore_err = restore_trash_entry(&mut connection, &child_entry.id).unwrap_err();
    assert_eq!(child_restore_err.code, ErrorCode::ParentInTrash);

    let restored = restore_trash_entry(&mut connection, &parent_entry.id).unwrap();
    assert_eq!(restored.restored_count, 1);
    let projects = get_project_tree(&connection).unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].id, parent_id);

    let parent_entry_2 = trash_project(&mut connection, &parent_id).unwrap();
    let deleted = permanently_delete_trash_entry(&mut connection, &parent_entry_2.id).unwrap();
    assert_eq!(deleted.deleted_project_count, 2);
    assert!(list_trash(&connection, "project").unwrap().is_empty());
    let fk_violations: i64 = connection
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query_map([], |_| Ok(1))
        .unwrap()
        .count() as i64;
    assert_eq!(fk_violations, 0);
}

#[test]
fn version_conflict_blocks_stale_undo_after_newer_edit() {
    let mut connection = test_connection();
    let project_id = expansion_test_project(&mut connection, "可撤销项目", None);
    let completed =
        set_project_terminal(&mut connection, &project_id, 0, TerminalStatus::Completed).unwrap();
    rename_project(
        &mut connection,
        &project_id,
        "改名后项目",
        completed.version,
    )
    .unwrap();
    let error = restore_project(&mut connection, &project_id, completed.version).unwrap_err();
    assert_eq!(error.code, ErrorCode::VersionConflict);
}

#[test]
fn update_reminder_completed_date_preserves_completed_action_at() {
    let mut connection = test_connection();
    let today = local_today();
    let today_str = date_string(today);
    let yesterday_str = date_string(today - Duration::days(1));
    let reminder = create_reminder(&mut connection, "提醒事项", &today_str).unwrap();
    let completed = complete_reminder(&mut connection, &reminder.id, reminder.version).unwrap();
    let original_action_at = completed.completed_action_at.clone();
    assert!(original_action_at.is_some());

    let updated = update_reminder_completed_date(
        &mut connection,
        &completed.id,
        &yesterday_str,
        completed.version,
    )
    .unwrap();
    assert_eq!(
        updated.completed_date.as_deref(),
        Some(yesterday_str.as_str())
    );
    assert_eq!(updated.completed_action_at, original_action_at);
}

#[test]
fn month_calendar_builds_full_week_grid_and_aggregates_projects_and_reminders() {
    let mut connection = test_connection();
    let today = local_today();
    let today_str = date_string(today);
    let month_key = today_str[..7].to_string();
    let yesterday_str = date_string(today - Duration::days(1));
    let tomorrow_str = date_string(today + Duration::days(1));
    let overdue_past_str = date_string(today - Duration::days(45));

    let completed_and_progressed = expansion_test_project(&mut connection, "Alpha", None);
    let progressed_only = expansion_test_project(&mut connection, "Beta", None);
    set_project_progress(
        &mut connection,
        &completed_and_progressed,
        Some(today_str.clone()),
        true,
        0,
    )
    .unwrap();
    set_project_terminal(
        &mut connection,
        &completed_and_progressed,
        1,
        TerminalStatus::Completed,
    )
    .unwrap();
    set_project_progress(
        &mut connection,
        &progressed_only,
        Some(today_str.clone()),
        true,
        0,
    )
    .unwrap();

    let today_reminder = create_reminder(&mut connection, "Today task", &today_str).unwrap();
    let tomorrow_reminder = create_reminder(&mut connection, "Early done", &tomorrow_str).unwrap();
    complete_reminder(
        &mut connection,
        &tomorrow_reminder.id,
        tomorrow_reminder.version,
    )
    .unwrap();

    connection
        .execute(
            "INSERT INTO reminders(id,title,scheduled_date,status,sort_order,version,created_at,updated_at) VALUES(?1,?2,?3,'active',1024,0,?4,?4)",
            params!["overdue-1", "Past due", overdue_past_str, now_utc()],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO reminders(id,title,scheduled_date,status,sort_order,version,created_at,updated_at) VALUES(?1,?2,?3,'active',1024,0,?4,?4)",
            params!["overdue-2", "Yesterday due", yesterday_str, now_utc()],
        )
        .unwrap();

    let calendar = get_month_calendar(&connection, &month_key).unwrap();

    assert_eq!(calendar.month, month_key);
    assert_eq!(calendar.today, today_str);
    assert_eq!(calendar.days.len() % 7, 0);
    assert!(calendar.days.len() >= 28 && calendar.days.len() <= 42);
    assert_eq!(
        parse_date(&calendar.grid_start)
            .unwrap()
            .weekday()
            .number_from_monday(),
        1
    );
    assert_eq!(
        parse_date(&calendar.grid_end)
            .unwrap()
            .weekday()
            .number_from_monday(),
        7
    );

    let today_cell = calendar
        .days
        .iter()
        .find(|day| day.date == today_str)
        .expect("today must be in current month grid");
    assert!(today_cell.in_current_month);
    assert_eq!(today_cell.completed_project_count, 1);
    assert_eq!(today_cell.progressed_project_count, 1);
    assert_eq!(today_cell.planned_reminders.len(), 1);
    assert_eq!(
        today_cell.planned_reminders[0].reminder.id,
        today_reminder.id
    );
    assert_eq!(today_cell.cross_day_completed_reminders.len(), 1);
    assert_eq!(
        today_cell.cross_day_completed_reminders[0].reminder.id,
        tomorrow_reminder.id
    );

    assert_eq!(calendar.overdue_reminders.len(), 2);
    assert_eq!(calendar.overdue_reminders[0].reminder.id, "overdue-1");
    assert_eq!(calendar.overdue_reminders[1].reminder.id, "overdue-2");

    // Verify December-to-January cross-year month boundary and invalid input rejection.
    let dec = get_month_calendar(&connection, "2026-12").unwrap();
    assert_eq!(dec.grid_start, "2026-11-30");
    assert_eq!(dec.grid_end, "2027-01-03");
    assert_eq!(dec.days.len(), 35);
    assert!(!dec.days[0].in_current_month);
    assert!(dec.days[1].in_current_month);
    assert!(!dec.days[34].in_current_month);

    assert_eq!(
        get_month_calendar(&connection, "2026-13").unwrap_err().code,
        ErrorCode::InvalidDate
    );
}

#[test]
fn reorder_projects_and_reminders_validate_membership_and_persist_order() {
    let mut connection = test_connection();
    let first = expansion_test_project(&mut connection, "First", None);
    let second = expansion_test_project(&mut connection, "Second", None);

    let err = reorder_project_siblings(&mut connection, None, vec![first.clone()]).unwrap_err();
    assert_eq!(err.code, ErrorCode::ReorderMembershipMismatch);

    let items =
        reorder_project_siblings(&mut connection, None, vec![second.clone(), first.clone()])
            .unwrap();
    assert_eq!(
        items.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
        vec![second.as_str(), first.as_str()]
    );

    let today_str = date_string(local_today());
    let r1 = create_reminder(&mut connection, "R1", &today_str)
        .unwrap()
        .id;
    let r2 = create_reminder(&mut connection, "R2", &today_str)
        .unwrap()
        .id;
    let err =
        reorder_reminders(&mut connection, &today_str, vec![r1.clone(), r1.clone()]).unwrap_err();
    assert_eq!(err.code, ErrorCode::ReorderMembershipMismatch);

    let items =
        reorder_reminders(&mut connection, &today_str, vec![r2.clone(), r1.clone()]).unwrap();
    assert_eq!(
        items.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
        vec![r2.as_str(), r1.as_str()]
    );
}

#[test]
fn terminal_date_update_rejects_dates_before_latest_progress() {
    let mut connection = test_connection();
    let today = local_today();
    let today_str = date_string(today);
    let yesterday_str = date_string(today - Duration::days(1));

    let project_id = expansion_test_project(&mut connection, "Progress guarded", None);
    set_project_progress(&mut connection, &project_id, Some(today_str), true, 0).unwrap();
    let completed =
        set_project_terminal(&mut connection, &project_id, 1, TerminalStatus::Completed).unwrap();

    let err = update_project_terminal_date(
        &mut connection,
        &project_id,
        &yesterday_str,
        completed.version,
    )
    .unwrap_err();
    assert_eq!(err.code, ErrorCode::TerminalDateBeforeProgress);
}

#[test]
fn empty_trash_and_theme_settings_round_trip_and_reject_invalid_inputs() {
    let mut connection = test_connection();
    let today_str = date_string(local_today());
    let p_id = expansion_test_project(&mut connection, "Trash me", None);
    let r_id = create_reminder(&mut connection, "Trash reminder", &today_str)
        .unwrap()
        .id;
    trash_project(&mut connection, &p_id).unwrap();
    trash_reminder(&mut connection, &r_id).unwrap();

    assert_eq!(
        list_trash(&connection, "unknown").unwrap_err().code,
        ErrorCode::InvalidInput
    );
    assert_eq!(
        empty_trash(&mut connection, "unknown").unwrap_err().code,
        ErrorCode::InvalidInput
    );
    assert_eq!(
        set_theme_mode(&mut connection, "sepia").unwrap_err().code,
        ErrorCode::InvalidInput
    );

    let deleted_projects = empty_trash(&mut connection, "project").unwrap();
    assert_eq!(deleted_projects.deleted_project_count, 1);
    assert_eq!(deleted_projects.deleted_reminder_count, 0);

    let deleted_reminders = empty_trash(&mut connection, "reminder").unwrap();
    assert_eq!(deleted_reminders.deleted_project_count, 0);
    assert_eq!(deleted_reminders.deleted_reminder_count, 1);

    assert_eq!(
        get_app_settings(&connection).unwrap().theme_mode,
        ThemeMode::System
    );
    assert_eq!(
        set_theme_mode(&mut connection, "dark").unwrap().theme_mode,
        ThemeMode::Dark
    );
    assert_eq!(
        get_app_settings(&connection).unwrap().theme_mode,
        ThemeMode::Dark
    );

    let serialized = serde_json::to_value(ApiError::new(ErrorCode::InvalidInput, "bad")).unwrap();
    assert_eq!(serialized["code"], "INVALID_INPUT");
}

#[test]
fn midnight_rollover_updates_progressed_today_overdue_and_date_guards_consistently() {
    let mut connection = test_connection();
    let dec_31 = NaiveDate::from_ymd_opt(2026, 12, 31).unwrap();
    let jan_01 = NaiveDate::from_ymd_opt(2027, 1, 1).unwrap();

    let project = create_project(&mut connection, "Year-end goal", None).unwrap();
    let progressed = set_project_progress_on(
        &mut connection,
        &project.id,
        None,
        true,
        project.version,
        dec_31,
    )
    .unwrap();
    assert!(progressed.progressed_today);

    // Future date rejected before midnight.
    let future_err = set_project_progress_on(
        &mut connection,
        &project.id,
        Some("2027-01-01".to_string()),
        true,
        progressed.version,
        dec_31,
    )
    .unwrap_err();
    assert_eq!(future_err.code, ErrorCode::FutureDateForbidden);

    let reminder =
        create_reminder_on(&mut connection, "Close books", "2026-12-31", dec_31).unwrap();

    // Before midnight: progressedToday is true, reminder is planned (not overdue).
    let tree_before = get_project_tree_on(&connection, dec_31).unwrap();
    assert!(tree_before[0].progressed_today);
    let week_before = get_daily_week_on(&connection, "2026-12-28", dec_31).unwrap();
    let dec_31_col = week_before
        .days
        .iter()
        .find(|d| d.date == "2026-12-31")
        .unwrap();
    assert_eq!(dec_31_col.planned_reminders.len(), 1);
    assert!(dec_31_col.overdue_reminders.is_empty());
    let dec_cal = get_month_calendar_on(&connection, "2026-12", dec_31).unwrap();
    assert!(dec_cal.overdue_reminders.is_empty());

    // After midnight on 2027-01-01: progressedToday flips false, reminder becomes overdue.
    let tree_after = get_project_tree_on(&connection, jan_01).unwrap();
    assert!(!tree_after[0].progressed_today);
    assert_eq!(tree_after[0].progress_count, 1);

    let past_err =
        create_reminder_on(&mut connection, "Too late", "2026-12-31", jan_01).unwrap_err();
    assert_eq!(past_err.code, ErrorCode::ScheduleInPast);

    let week_after = get_daily_week_on(&connection, "2026-12-28", jan_01).unwrap();
    let jan_01_col = week_after
        .days
        .iter()
        .find(|d| d.date == "2027-01-01")
        .unwrap();
    assert_eq!(jan_01_col.overdue_reminders.len(), 1);
    assert_eq!(jan_01_col.overdue_reminders[0].reminder.id, reminder.id);

    let jan_cal = get_month_calendar_on(&connection, "2027-01", jan_01).unwrap();
    assert_eq!(jan_cal.overdue_reminders.len(), 1);
    let dec_31_cell = jan_cal
        .days
        .iter()
        .find(|d| d.date == "2026-12-31")
        .unwrap();
    assert!(!dec_31_cell.in_current_month);
    assert_eq!(dec_31_cell.progressed_project_count, 1);

    // Completing the overdue reminder on 2027-01-01 moves it to cross-day completed.
    complete_reminder_on(&mut connection, &reminder.id, reminder.version, jan_01).unwrap();
    let week_done = get_daily_week_on(&connection, "2026-12-28", jan_01).unwrap();
    let jan_01_done = week_done
        .days
        .iter()
        .find(|d| d.date == "2027-01-01")
        .unwrap();
    assert!(jan_01_done.overdue_reminders.is_empty());
    assert_eq!(jan_01_done.cross_day_completed_reminders.len(), 1);
    assert_eq!(
        jan_01_done.cross_day_completed_reminders[0].reminder.id,
        reminder.id
    );
}

#[test]
fn detail_and_daily_week_reject_corrupted_project_cycles_consistently() {
    let connection = test_connection();
    connection
        .execute_batch(
            "PRAGMA foreign_keys = OFF;
             INSERT INTO projects(id,parent_id,title,status,sort_order,version,created_at,updated_at)
             VALUES ('cyc-a','cyc-b','A','active',1024,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
                    ('cyc-b','cyc-a','B','active',2048,0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
             PRAGMA foreign_keys = ON;",
        )
        .unwrap();
    assert_eq!(
        get_project_detail(&connection, "cyc-a").unwrap_err().code,
        ErrorCode::DbError
    );
    assert_eq!(
        get_daily_week(&connection, "2026-01-05").unwrap_err().code,
        ErrorCode::DbError
    );
}

#[test]
fn project_progress_month_and_list_trash_return_targeted_results() {
    let mut connection = test_connection();
    let p1 = create_project(&mut connection, "Alpha", None).unwrap();
    let p2 = create_project(&mut connection, "Beta", Some(p1.id.clone())).unwrap();
    let feb = NaiveDate::from_ymd_opt(2026, 2, 28).unwrap();
    let p1 = set_project_progress_on(
        &mut connection,
        &p1.id,
        Some("2026-01-31".into()),
        true,
        p1.version,
        feb,
    )
    .unwrap();
    let p1 = set_project_progress_on(
        &mut connection,
        &p1.id,
        Some("2026-02-01".into()),
        true,
        p1.version,
        feb,
    )
    .unwrap();
    set_project_progress_on(
        &mut connection,
        &p1.id,
        Some("2026-02-15".into()),
        true,
        p1.version,
        feb,
    )
    .unwrap();
    set_project_progress_on(
        &mut connection,
        &p2.id,
        Some("2026-02-10".into()),
        true,
        p2.version,
        feb,
    )
    .unwrap();

    assert_eq!(
        get_project_progress_month(&connection, &p1.id, "2026-02").unwrap(),
        vec!["2026-02-01", "2026-02-15"]
    );
    assert_eq!(
        get_project_progress_month(&connection, &p1.id, "2026-01").unwrap(),
        vec!["2026-01-31"]
    );

    trash_project(&mut connection, &p1.id).unwrap();
    let entries = list_trash(&connection, "project").unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].current_descendant_count, Some(2));
}

fn test_connection() -> Connection {
    initialize_in_memory().unwrap()
}
