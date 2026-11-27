export type DisplayDensity = 'comfortable' | 'compact'
export type CalendarDisplayMode = 'both' | 'planned' | 'actual'
export type MonthlyDisplayMode = CalendarDisplayMode
export type RangeBreakdownMode = 'projects' | 'days'
export type InactiveThresholdDays = 7 | 14 | 30

const KEYS = {
  density: 'branchtrace:ui:density',
  rangeBreakdownMode: 'branchtrace:ui:range-breakdown-mode',
  rangeHideEmpty: 'branchtrace:ui:range-hide-empty',
  legacyWeeklyHideEmpty: 'branchtrace:ui:weekly-hide-empty',
  monthlyDisplayMode: 'branchtrace:ui:monthly-display-mode',
  inactiveThresholdDays: 'branchtrace:ui:inactive-threshold-days',
} as const

function safeGet(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
  } catch {
    // Ignore storage quota or private-mode restrictions for non-critical UI preferences.
  }
}

export function loadDisplayDensity(): DisplayDensity {
  const saved = safeGet(KEYS.density)
  return saved === 'compact' ? 'compact' : 'comfortable'
}

export function saveDisplayDensity(value: DisplayDensity): void {
  safeSet(KEYS.density, value)
}

export function loadRangeBreakdownMode(): RangeBreakdownMode {
  const saved = safeGet(KEYS.rangeBreakdownMode)
  if (saved === 'projects' || saved === 'days') return saved
  return 'projects'
}

export function saveRangeBreakdownMode(value: RangeBreakdownMode): void {
  safeSet(KEYS.rangeBreakdownMode, value)
}

export function loadRangeHideEmpty(): boolean {
  const saved = safeGet(KEYS.rangeHideEmpty)
  if (saved !== null) return saved === 'true'
  return safeGet(KEYS.legacyWeeklyHideEmpty) === 'true'
}

export function saveRangeHideEmpty(value: boolean): void {
  safeSet(KEYS.rangeHideEmpty, value ? 'true' : 'false')
}

export function loadMonthlyDisplayMode(): CalendarDisplayMode {
  const saved = safeGet(KEYS.monthlyDisplayMode)
  if (saved === 'planned' || saved === 'actual' || saved === 'both') return saved
  return 'both'
}

export function saveMonthlyDisplayMode(value: CalendarDisplayMode): void {
  safeSet(KEYS.monthlyDisplayMode, value)
}

export function loadInactiveThresholdDays(): InactiveThresholdDays {
  const saved = Number(safeGet(KEYS.inactiveThresholdDays))
  if (saved === 7 || saved === 14 || saved === 30) return saved
  return 14
}

export function saveInactiveThresholdDays(value: InactiveThresholdDays): void {
  safeSet(KEYS.inactiveThresholdDays, String(value))
}
