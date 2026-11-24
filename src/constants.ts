import type { ProjectStatus } from './types'

export const STATUS_TEXT: Record<ProjectStatus, string> = {
  active: 'Active',
  completed: 'Completed',
  canceled: 'Canceled',
}

export type DropPosition = 'before' | 'after'
