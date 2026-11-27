export const ALL_QUERY_KEYS = [
  'projectTree',
  'projectDetail',
  'projectProgressMonth',
  'dailyWeek',
  'dailyRange',
  'monthCalendar',
  'reminder',
  'trash',
  'settings',
  'clockContext',
] as const

export const EXPAND_KEYS = ['projectTree'] as const
export const PROJECT_KEYS = ['projectTree', 'projectDetail', 'projectProgressMonth', 'dailyWeek', 'dailyRange', 'monthCalendar'] as const
export const REMINDER_KEYS = ['dailyWeek', 'dailyRange', 'monthCalendar', 'reminder'] as const
export const TRASH_KEYS = ['projectTree', 'projectDetail', 'projectProgressMonth', 'dailyWeek', 'dailyRange', 'monthCalendar', 'reminder', 'trash'] as const
export const SETTINGS_KEYS = ['settings'] as const
