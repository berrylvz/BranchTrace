export const ALL_QUERY_KEYS = [
  'projectTree',
  'projectDetail',
  'projectProgressMonth',
  'dailyWeek',
  'monthCalendar',
  'reminder',
  'trash',
  'settings',
  'clockContext',
] as const

export const EXPAND_KEYS = ['projectTree'] as const
export const PROJECT_KEYS = ['projectTree', 'projectDetail', 'projectProgressMonth', 'dailyWeek', 'monthCalendar'] as const
export const REMINDER_KEYS = ['dailyWeek', 'monthCalendar', 'reminder'] as const
export const TRASH_KEYS = ['projectTree', 'projectDetail', 'projectProgressMonth', 'dailyWeek', 'monthCalendar', 'reminder', 'trash'] as const
export const SETTINGS_KEYS = ['settings'] as const
