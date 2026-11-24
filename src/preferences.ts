export type DisplayDensity = 'comfortable' | 'compact'
export type WeeklyViewMode = 'grid' | 'timeline'
export type MonthlyDisplayMode = 'both' | 'planned' | 'actual'
export type InactiveThresholdDays = 7 | 14 | 30

const KEYS = {
  density: 'branchtrace:ui:density',
  weeklyViewMode: 'branchtrace:ui:weekly-view-mode',
  weeklyHideEmpty: 'branchtrace:ui:weekly-hide-empty',
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

export function loadWeeklyViewMode(): WeeklyViewMode {
  const saved = safeGet(KEYS.weeklyViewMode)
  if (saved === 'grid' || saved === 'timeline') return saved
  if (typeof window !== 'undefined' && window.innerWidth < 1024) return 'timeline'
  return 'grid'
}

export function saveWeeklyViewMode(value: WeeklyViewMode): void {
  safeSet(KEYS.weeklyViewMode, value)
}

export function loadWeeklyHideEmpty(): boolean {
  return safeGet(KEYS.weeklyHideEmpty) === 'true'
}

export function saveWeeklyHideEmpty(value: boolean): void {
  safeSet(KEYS.weeklyHideEmpty, value ? 'true' : 'false')
}

export function loadMonthlyDisplayMode(): MonthlyDisplayMode {
  const saved = safeGet(KEYS.monthlyDisplayMode)
  if (saved === 'planned' || saved === 'actual' || saved === 'both') return saved
  return 'both'
}

export function saveMonthlyDisplayMode(value: MonthlyDisplayMode): void {
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
