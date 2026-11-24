export type MonthDensity = 'comfortable' | 'cozy' | 'compact'

export interface MonthCellMetrics {
  density: MonthDensity
  padY: number
  padX: number
  cellGap: number
  headerHeight: number
  statsHeight: number
  itemHeight: number
  itemGap: number
  moreHeight: number
  inlineStats: boolean
  inlineStatsWithToday: boolean
  showDateHint: boolean
  compactDetails: boolean
}

export interface CellReminderVisibility {
  visibleCount: number
  hiddenCount: number
  showMoreRow: boolean
  showHeaderReminderCount: boolean
}

export interface OverdueStripLayout {
  visibleCount: number
  hiddenCount: number
}

const DEFAULT_OVERDUE_MIN_ITEM_WIDTH = 220
const DEFAULT_OVERDUE_ITEM_GAP = 6
const DEFAULT_OVERDUE_MORE_BTN_WIDTH = 84

export function getMonthWeekCount(dayCount: number): number {
  if (dayCount <= 0) return 5
  return Math.max(1, Math.ceil(dayCount / 7))
}

export function computeMonthCellMetrics(cellWidth: number, cellHeight: number): MonthCellMetrics {
  const effectiveHeight = cellHeight > 0 ? cellHeight : 120
  const effectiveWidth = cellWidth > 0 ? cellWidth : 190
  const density: MonthDensity = effectiveHeight >= 112
    ? 'comfortable'
    : effectiveHeight >= 84
      ? 'cozy'
      : 'compact'

  const base = density === 'comfortable'
    ? { padY: 6, padX: 6, cellGap: 4, headerHeight: 22, statsHeight: 18, itemHeight: 22, itemGap: 3, moreHeight: 18 }
    : density === 'cozy'
      ? { padY: 5, padX: 6, cellGap: 3, headerHeight: 20, statsHeight: 17, itemHeight: 20, itemGap: 2, moreHeight: 17 }
      : { padY: 4, padX: 5, cellGap: 2, headerHeight: 19, statsHeight: 16, itemHeight: 19, itemGap: 2, moreHeight: 16 }

  return {
    density,
    ...base,
    inlineStats: effectiveWidth >= 156,
    inlineStatsWithToday: effectiveWidth >= 190,
    showDateHint: effectiveWidth >= 164,
    compactDetails: effectiveWidth < 114,
  }
}

export function computeCellReminderVisibility(
  totalReminders: number,
  cellHeight: number,
  hasSeparateStatsRow: boolean,
  metrics: MonthCellMetrics,
): CellReminderVisibility {
  if (totalReminders <= 0) {
    return { visibleCount: 0, hiddenCount: 0, showMoreRow: false, showHeaderReminderCount: false }
  }
  if (cellHeight <= 0) {
    const fallback = Math.min(totalReminders, 2)
    return {
      visibleCount: fallback,
      hiddenCount: totalReminders - fallback,
      showMoreRow: totalReminders > fallback,
      showHeaderReminderCount: false,
    }
  }

  // Reserve 2px for the cell border and fractional-pixel rounding safety.
  const innerHeight = Math.floor(cellHeight) - 2 - metrics.padY * 2
  const statsBlock = hasSeparateStatsRow ? metrics.statsHeight + metrics.cellGap : 0
  const availableHeight = innerHeight - metrics.headerHeight - metrics.cellGap - statsBlock

  if (availableHeight < metrics.moreHeight) {
    return {
      visibleCount: 0,
      hiddenCount: totalReminders,
      showMoreRow: false,
      showHeaderReminderCount: true,
    }
  }

  const maxFitAll = Math.max(
    0,
    Math.floor((availableHeight + metrics.itemGap) / (metrics.itemHeight + metrics.itemGap)),
  )
  if (totalReminders <= maxFitAll) {
    return {
      visibleCount: totalReminders,
      hiddenCount: 0,
      showMoreRow: false,
      showHeaderReminderCount: false,
    }
  }

  const availableWithMore = availableHeight - metrics.moreHeight - metrics.itemGap
  const fitWithMore = availableWithMore >= metrics.itemHeight
    ? Math.floor((availableWithMore + metrics.itemGap) / (metrics.itemHeight + metrics.itemGap))
    : 0
  const visibleCount = Math.min(fitWithMore, Math.max(0, totalReminders - 1))

  return {
    visibleCount,
    hiddenCount: totalReminders - visibleCount,
    showMoreRow: true,
    showHeaderReminderCount: false,
  }
}

export function computeOverdueStripLayout(
  totalCount: number,
  stripWidth: number,
  minItemWidth = DEFAULT_OVERDUE_MIN_ITEM_WIDTH,
  gap = DEFAULT_OVERDUE_ITEM_GAP,
  moreBtnWidth = DEFAULT_OVERDUE_MORE_BTN_WIDTH,
): OverdueStripLayout {
  if (totalCount <= 0) return { visibleCount: 0, hiddenCount: 0 }
  if (stripWidth <= 0) {
    const fallback = Math.min(totalCount, 3)
    return { visibleCount: fallback, hiddenCount: totalCount - fallback }
  }

  const maxFitAll = Math.max(0, Math.floor((stripWidth + gap) / (minItemWidth + gap)))
  if (totalCount <= maxFitAll) {
    return { visibleCount: totalCount, hiddenCount: 0 }
  }

  const availableWithMore = stripWidth - moreBtnWidth - gap
  const fitWithMore = availableWithMore >= minItemWidth
    ? Math.floor((availableWithMore + gap) / (minItemWidth + gap))
    : 0
  const visibleCount = Math.min(fitWithMore, Math.max(0, totalCount - 1))
  return { visibleCount, hiddenCount: totalCount - visibleCount }
}
