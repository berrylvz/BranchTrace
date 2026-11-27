use super::repo::{
    load_progress_map, load_project_records, load_reminder_records, project_parent_paths,
    reminder_dto, tree_order, ProgressMap,
};
use super::support::{date_string, local_today, parse_date, parse_month};
use crate::models::{
    ApiError, DailyDayDto, DailyRangeDto, DailyWeekDto, ErrorCode, ItemStatus, MonthCalendarDto,
    MonthDayDto, ProjectDailyItem, ProjectRecord, ReminderDailyItem, ReminderDisplayType,
    ReminderRecord,
};
use chrono::{Datelike, Duration, NaiveDate};
use rusqlite::Connection;
use std::collections::HashMap;

pub(super) const MAX_DAILY_RANGE_DAYS: i64 = 30;

trait DayReminderBuckets {
    fn planned_mut(&mut self) -> &mut Vec<ReminderDailyItem>;
    fn cross_day_completed_mut(&mut self) -> &mut Vec<ReminderDailyItem>;
}

impl DayReminderBuckets for DailyDayDto {
    fn planned_mut(&mut self) -> &mut Vec<ReminderDailyItem> {
        &mut self.planned_reminders
    }

    fn cross_day_completed_mut(&mut self) -> &mut Vec<ReminderDailyItem> {
        &mut self.cross_day_completed_reminders
    }
}

impl DayReminderBuckets for MonthDayDto {
    fn planned_mut(&mut self) -> &mut Vec<ReminderDailyItem> {
        &mut self.planned_reminders
    }

    fn cross_day_completed_mut(&mut self) -> &mut Vec<ReminderDailyItem> {
        &mut self.cross_day_completed_reminders
    }
}

fn month_range_error() -> ApiError {
    ApiError::new(
        ErrorCode::InvalidDate,
        "Month range is outside supported dates",
    )
}

fn build_week_dates(week_start: &str) -> Result<Vec<String>, ApiError> {
    let start = parse_date(week_start)?;
    if start.weekday().number_from_monday() != 1 {
        return Err(ApiError::new(
            ErrorCode::InvalidDate,
            "Week start date must be a Monday",
        ));
    }
    let mut dates = Vec::with_capacity(7);
    for offset in 0..7 {
        let day = start
            .checked_add_signed(Duration::days(offset))
            .ok_or_else(|| {
                ApiError::new(
                    ErrorCode::InvalidDate,
                    "Week range is outside supported dates",
                )
            })?;
        dates.push(date_string(day));
    }
    Ok(dates)
}

fn build_range_dates(start_date: &str, end_date: &str) -> Result<Vec<String>, ApiError> {
    let start = parse_date(start_date)?;
    let end = parse_date(end_date)?;
    if start > end {
        return Err(ApiError::new(
            ErrorCode::InvalidDate,
            "Start date must be on or before end date",
        ));
    }
    let total_days = (end - start).num_days() + 1;
    if total_days > MAX_DAILY_RANGE_DAYS {
        return Err(ApiError::new(
            ErrorCode::InvalidDate,
            "Date range cannot exceed 30 days",
        ));
    }
    let mut dates = Vec::with_capacity(total_days as usize);
    for offset in 0..total_days {
        let day = start
            .checked_add_signed(Duration::days(offset))
            .ok_or_else(|| {
                ApiError::new(
                    ErrorCode::InvalidDate,
                    "Date range is outside supported dates",
                )
            })?;
        dates.push(date_string(day));
    }
    Ok(dates)
}

fn build_month_grid(
    month: &str,
) -> Result<
    (
        NaiveDate,
        NaiveDate,
        Vec<MonthDayDto>,
        HashMap<String, usize>,
    ),
    ApiError,
> {
    let first_day = parse_month(month)?;
    let next_month_first = if first_day.month() == 12 {
        NaiveDate::from_ymd_opt(first_day.year() + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(first_day.year(), first_day.month() + 1, 1)
    }
    .ok_or_else(month_range_error)?;
    let last_day = next_month_first
        .checked_sub_signed(Duration::days(1))
        .ok_or_else(month_range_error)?;
    let grid_start = first_day
        .checked_sub_signed(Duration::days(
            first_day.weekday().num_days_from_monday() as i64
        ))
        .ok_or_else(month_range_error)?;
    let grid_end = last_day
        .checked_add_signed(Duration::days(
            (6 - last_day.weekday().num_days_from_monday()) as i64,
        ))
        .ok_or_else(month_range_error)?;

    let total_days = (grid_end - grid_start).num_days() + 1;
    let mut days = Vec::with_capacity(total_days as usize);
    let mut day_indexes = HashMap::with_capacity(total_days as usize);
    for offset in 0..total_days {
        let current = grid_start
            .checked_add_signed(Duration::days(offset))
            .ok_or_else(month_range_error)?;
        let iso = date_string(current);
        day_indexes.insert(iso.clone(), days.len());
        days.push(MonthDayDto {
            in_current_month: iso.starts_with(month),
            date: iso,
            completed_project_count: 0,
            progressed_project_count: 0,
            planned_reminders: Vec::new(),
            cross_day_completed_reminders: Vec::new(),
        });
    }
    Ok((grid_start, grid_end, days, day_indexes))
}

fn make_project_daily_item(
    record: &ProjectRecord,
    paths: &HashMap<String, Vec<String>>,
    progressed_same_day: Option<bool>,
) -> ProjectDailyItem {
    ProjectDailyItem {
        project_id: record.id.clone(),
        title: record.title.clone(),
        parent_path: paths.get(&record.id).cloned().unwrap_or_default(),
        short_id: None,
        status: record.status,
        progressed_same_day,
    }
}

fn populate_range_projects(
    days: &mut [DailyDayDto],
    day_indexes: &HashMap<String, usize>,
    ordered_records: &[ProjectRecord],
    progress: &ProgressMap,
    paths: &HashMap<String, Vec<String>>,
) {
    let mut completed_positions: HashMap<(usize, &str), usize> = HashMap::new();
    for record in ordered_records {
        if record.status == ItemStatus::Completed {
            if let Some(&index) = record
                .completed_date
                .as_deref()
                .and_then(|date| day_indexes.get(date))
            {
                let item = make_project_daily_item(record, paths, Some(false));
                completed_positions.insert(
                    (index, record.id.as_str()),
                    days[index].completed_projects.len(),
                );
                days[index].completed_projects.push(item);
            }
        }
        let Some(project_dates) = progress.get(&record.id) else {
            continue;
        };
        for progress_date in project_dates {
            let Some(&index) = day_indexes.get(progress_date) else {
                continue;
            };
            if let Some(&position) = completed_positions.get(&(index, record.id.as_str())) {
                days[index].completed_projects[position].progressed_same_day = Some(true);
            } else {
                days[index]
                    .progressed_projects
                    .push(make_project_daily_item(record, paths, None));
            }
        }
    }
}

fn populate_month_projects(
    days: &mut [MonthDayDto],
    day_indexes: &HashMap<String, usize>,
    records: &[ProjectRecord],
    progress: &ProgressMap,
) {
    for record in records {
        let completed_on = if record.status == ItemStatus::Completed {
            record.completed_date.as_deref()
        } else {
            None
        };
        if let Some(&index) = completed_on.and_then(|date| day_indexes.get(date)) {
            days[index].completed_project_count += 1;
        }
        let Some(project_dates) = progress.get(&record.id) else {
            continue;
        };
        for progress_date in project_dates {
            if completed_on == Some(progress_date.as_str()) {
                continue;
            }
            if let Some(&index) = day_indexes.get(progress_date) {
                days[index].progressed_project_count += 1;
            }
        }
    }
}

fn bucket_reminders<D: DayReminderBuckets>(
    days: &mut [D],
    reminders: Vec<ReminderRecord>,
    today_str: &str,
    day_indexes: &HashMap<String, usize>,
) -> Vec<ReminderDailyItem> {
    let mut overdue = Vec::new();
    for record in reminders {
        let reminder = reminder_dto(&record);
        if let Some(&index) = day_indexes.get(&record.scheduled_date) {
            days[index].planned_mut().push(ReminderDailyItem {
                reminder: reminder.clone(),
                display_type: ReminderDisplayType::Planned,
                is_planned_and_completed_same_day: record.status == ItemStatus::Completed
                    && record.completed_date.as_deref() == Some(record.scheduled_date.as_str()),
            });
        }
        if record.status == ItemStatus::Completed {
            if let Some(completed_date) = record
                .completed_date
                .as_deref()
                .filter(|date| *date != record.scheduled_date.as_str())
            {
                if let Some(&index) = day_indexes.get(completed_date) {
                    days[index]
                        .cross_day_completed_mut()
                        .push(ReminderDailyItem {
                            reminder: reminder.clone(),
                            display_type: ReminderDisplayType::Completed,
                            is_planned_and_completed_same_day: false,
                        });
                }
            }
        }
        if record.status == ItemStatus::Active && record.scheduled_date.as_str() < today_str {
            overdue.push(ReminderDailyItem {
                reminder,
                display_type: ReminderDisplayType::Overdue,
                is_planned_and_completed_same_day: false,
            });
        }
    }
    overdue
}

fn sort_project_daily_items(items: &mut [ProjectDailyItem]) {
    items.sort_by(|a, b| a.title.cmp(&b.title).then(a.project_id.cmp(&b.project_id)));
}

fn sort_planned_reminders(items: &mut [ReminderDailyItem]) {
    items.sort_by(|a, b| {
        a.reminder
            .sort_order
            .cmp(&b.reminder.sort_order)
            .then(a.reminder.id.cmp(&b.reminder.id))
    });
}

fn sort_overdue_reminders(items: &mut [ReminderDailyItem]) {
    items.sort_by(|a, b| {
        a.reminder
            .scheduled_date
            .cmp(&b.reminder.scheduled_date)
            .then(a.reminder.sort_order.cmp(&b.reminder.sort_order))
            .then(a.reminder.id.cmp(&b.reminder.id))
    });
}

fn sort_cross_day_completed_reminders(items: &mut [ReminderDailyItem]) {
    items.sort_by(|a, b| {
        a.reminder
            .completed_action_at
            .cmp(&b.reminder.completed_action_at)
            .then(a.reminder.id.cmp(&b.reminder.id))
    });
}

fn build_daily_days_on(
    connection: &Connection,
    dates: Vec<String>,
    today: NaiveDate,
) -> Result<(String, Vec<ReminderDailyItem>, Vec<DailyDayDto>), ApiError> {
    let today_str = date_string(today);
    let records = load_project_records(connection, false)?;
    let ordered_records = tree_order(&records);
    let progress = load_progress_map(connection)?;
    let paths = project_parent_paths(&records)?;

    let mut days: Vec<DailyDayDto> = dates
        .iter()
        .map(|date| DailyDayDto {
            date: date.clone(),
            completed_projects: Vec::new(),
            progressed_projects: Vec::new(),
            planned_reminders: Vec::new(),
            overdue_reminders: Vec::new(),
            cross_day_completed_reminders: Vec::new(),
        })
        .collect();
    let day_indexes: HashMap<String, usize> = dates
        .into_iter()
        .enumerate()
        .map(|(index, date)| (date, index))
        .collect();
    let today_index = day_indexes.get(&today_str).copied();

    populate_range_projects(&mut days, &day_indexes, &ordered_records, &progress, &paths);

    let reminders = load_reminder_records(connection)?;
    let mut overdue = bucket_reminders(&mut days, reminders, &today_str, &day_indexes);
    sort_overdue_reminders(&mut overdue);
    if let Some(index) = today_index {
        days[index].overdue_reminders = overdue.clone();
    }

    for day in &mut days {
        sort_project_daily_items(&mut day.completed_projects);
        sort_project_daily_items(&mut day.progressed_projects);
        sort_planned_reminders(&mut day.planned_reminders);
        sort_overdue_reminders(&mut day.overdue_reminders);
        sort_cross_day_completed_reminders(&mut day.cross_day_completed_reminders);
        apply_short_ids(&mut day.completed_projects, &mut day.progressed_projects);
    }

    Ok((today_str, overdue, days))
}

pub(super) fn get_daily_week_on(
    connection: &Connection,
    week_start: &str,
    today: NaiveDate,
) -> Result<DailyWeekDto, ApiError> {
    let dates = build_week_dates(week_start)?;
    let (today_str, _overdue, days) = build_daily_days_on(connection, dates, today)?;

    Ok(DailyWeekDto {
        week_start: week_start.to_string(),
        today: today_str,
        days,
    })
}

pub(crate) fn get_daily_week(
    connection: &Connection,
    week_start: &str,
) -> Result<DailyWeekDto, ApiError> {
    get_daily_week_on(connection, week_start, local_today())
}

pub(super) fn get_daily_range_on(
    connection: &Connection,
    start_date: &str,
    end_date: &str,
    today: NaiveDate,
) -> Result<DailyRangeDto, ApiError> {
    let dates = build_range_dates(start_date, end_date)?;
    let (today_str, overdue_reminders, days) = build_daily_days_on(connection, dates, today)?;

    Ok(DailyRangeDto {
        start_date: start_date.to_string(),
        end_date: end_date.to_string(),
        today: today_str,
        overdue_reminders,
        days,
    })
}

pub(crate) fn get_daily_range(
    connection: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<DailyRangeDto, ApiError> {
    get_daily_range_on(connection, start_date, end_date, local_today())
}

pub(super) fn get_month_calendar_on(
    connection: &Connection,
    month: &str,
    today: NaiveDate,
) -> Result<MonthCalendarDto, ApiError> {
    let (grid_start, grid_end, mut days, day_indexes) = build_month_grid(month)?;
    let records = load_project_records(connection, false)?;
    let progress = load_progress_map(connection)?;
    populate_month_projects(&mut days, &day_indexes, &records, &progress);

    let today_str = date_string(today);
    let reminders = load_reminder_records(connection)?;
    let mut overdue_reminders = bucket_reminders(&mut days, reminders, &today_str, &day_indexes);

    for day in &mut days {
        sort_planned_reminders(&mut day.planned_reminders);
        sort_cross_day_completed_reminders(&mut day.cross_day_completed_reminders);
    }
    sort_overdue_reminders(&mut overdue_reminders);

    Ok(MonthCalendarDto {
        month: month.to_string(),
        grid_start: date_string(grid_start),
        grid_end: date_string(grid_end),
        today: today_str,
        overdue_reminders,
        days,
    })
}

pub(crate) fn get_month_calendar(
    connection: &Connection,
    month: &str,
) -> Result<MonthCalendarDto, ApiError> {
    get_month_calendar_on(connection, month, local_today())
}

pub(super) fn apply_short_ids(
    completed: &mut [ProjectDailyItem],
    progressed: &mut [ProjectDailyItem],
) {
    let mut groups: HashMap<(Vec<String>, String), Vec<String>> = HashMap::new();
    for item in completed.iter().chain(progressed.iter()) {
        groups
            .entry((item.parent_path.clone(), item.title.clone()))
            .or_default()
            .push(item.project_id.clone());
    }
    for item in completed.iter_mut().chain(progressed.iter_mut()) {
        let key = (item.parent_path.clone(), item.title.clone());
        let Some(ids) = groups.get(&key) else {
            continue;
        };
        if ids.len() <= 1 {
            continue;
        }
        let id_chars: Vec<char> = item.project_id.chars().collect();
        let mut chosen = item.project_id.clone();
        for length in 1..=id_chars.len() {
            let prefix: String = id_chars.iter().take(length).collect();
            let matches = ids
                .iter()
                .filter(|other| other.chars().take(length).collect::<String>() == prefix)
                .count();
            if matches == 1 {
                chosen = prefix;
                break;
            }
        }
        item.short_id = Some(chosen);
    }
}
