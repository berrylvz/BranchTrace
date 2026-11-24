import type { ReminderDto } from '../types'
import { todayIsoDate } from '../ui-format.ts'
import {
  activeReminderById,
  checkReorderMembership,
  checkVersion,
  mockFail,
  nextId,
  nextOrder,
  reminderIsTrashed,
  validateIsoDate,
  validateTitle,
} from './store.ts'
import type { MockCommandHandler, MockState, MockStore } from './store.ts'

function transitionReminderStatus(
  store: MockStore,
  state: MockState,
  args: Record<string, unknown>,
  target: 'completed' | 'canceled' | 'active',
): ReminderDto {
  const reminder = activeReminderById(state, String(args.reminderId))
  checkVersion(args.expectedVersion, reminder.version)
  const today = todayIsoDate()
  let updated: ReminderDto
  if (target === 'active') {
    if (reminder.status === 'active') {
      mockFail('INVALID_STATUS_TRANSITION', 'Reminder is already active')
    }
    updated = {
      ...reminder,
      status: 'active',
      completedDate: null,
      completedActionAt: null,
      canceledDate: null,
      version: reminder.version + 1,
    }
  } else if (target === 'completed') {
    if (reminder.status !== 'active') {
      mockFail('INVALID_STATUS_TRANSITION', 'Only active reminders can be completed')
    }
    updated = {
      ...reminder,
      status: 'completed',
      completedDate: today,
      completedActionAt: new Date().toISOString(),
      canceledDate: null,
      version: reminder.version + 1,
    }
  } else {
    if (reminder.status !== 'active') {
      mockFail('INVALID_STATUS_TRANSITION', 'Only active reminders can be canceled')
    }
    updated = {
      ...reminder,
      status: 'canceled',
      completedDate: null,
      completedActionAt: null,
      canceledDate: today,
      version: reminder.version + 1,
    }
  }
  store.updateReminder(state, reminder.id, updated)
  return { ...updated }
}

export const reminderHandlers: Record<string, MockCommandHandler> = {
  get_reminder: (_store, state, args) => ({ ...activeReminderById(state, String(args.reminderId)) }),

  create_reminder: (store, state, args) => {
    const title = validateTitle(args.title)
    const scheduledDate = validateIsoDate(args.scheduledDate)
    if (scheduledDate < todayIsoDate()) {
      mockFail('SCHEDULE_IN_PAST', 'Scheduled date must be today or in the future')
    }
    const siblings = state.reminders.filter((item) => item.scheduledDate === scheduledDate && !reminderIsTrashed(item.id, state))
    const reminder: ReminderDto = {
      id: nextId(),
      title,
      scheduledDate,
      status: 'active',
      completedDate: null,
      completedActionAt: null,
      canceledDate: null,
      sortOrder: nextOrder(siblings),
      version: 0,
    }
    const nextState: MockState = { ...state, reminders: [...state.reminders, reminder] }
    store.saveState(nextState)
    return { ...reminder }
  },

  rename_reminder: (store, state, args) => {
    const title = validateTitle(args.title)
    const reminder = activeReminderById(state, String(args.reminderId))
    checkVersion(args.expectedVersion, reminder.version)
    const updated: ReminderDto = { ...reminder, title, version: reminder.version + 1 }
    store.updateReminder(state, reminder.id, updated)
    return { ...updated }
  },

  update_reminder_schedule: (store, state, args) => {
    const reminder = activeReminderById(state, String(args.reminderId))
    checkVersion(args.expectedVersion, reminder.version)
    const scheduledDate = validateIsoDate(args.scheduledDate)
    if (scheduledDate < todayIsoDate()) {
      mockFail('SCHEDULE_IN_PAST', 'Scheduled date must be today or in the future')
    }
    const sortOrder = nextOrder(state.reminders.filter((item) => item.scheduledDate === scheduledDate && !reminderIsTrashed(item.id, state)))
    const updated: ReminderDto = { ...reminder, scheduledDate, sortOrder, version: reminder.version + 1 }
    store.updateReminder(state, reminder.id, updated)
    return { ...updated }
  },

  reorder_reminders: (store, state, args) => {
    const scheduledDate = validateIsoDate(args.scheduledDate)
    const orderedIds = Array.isArray(args.orderedIds) ? args.orderedIds.map(String) : []
    const current = state.reminders
      .filter((item) => item.scheduledDate === scheduledDate && !reminderIsTrashed(item.id, state))
      .map((item) => item.id)
    checkReorderMembership(current, orderedIds, 'Reorder list must include all reminders for that scheduled date')
    const orderIndex = new Map(orderedIds.map((reminderId, idx) => [reminderId, (idx + 1) * 1024]))
    const nextState: MockState = {
      ...state,
      reminders: state.reminders.map((item) => {
        const sortOrder = orderIndex.get(item.id)
        return sortOrder !== undefined ? { ...item, sortOrder, version: item.version + 1 } : item
      }),
    }
    store.saveState(nextState)
    return orderedIds.map((reminderId) => ({ ...nextState.reminders.find((item) => item.id === reminderId)! }))
  },

  complete_reminder: (store, state, args) => transitionReminderStatus(store, state, args, 'completed'),
  cancel_reminder: (store, state, args) => transitionReminderStatus(store, state, args, 'canceled'),
  restore_reminder: (store, state, args) => transitionReminderStatus(store, state, args, 'active'),

  update_reminder_completed_date: (store, state, args) => {
    const reminder = activeReminderById(state, String(args.reminderId))
    checkVersion(args.expectedVersion, reminder.version)
    if (reminder.status !== 'completed') {
      mockFail('INVALID_STATUS_TRANSITION', 'Only completed reminders can update their completed date')
    }
    const date = validateIsoDate(args.date)
    if (date > todayIsoDate()) {
      mockFail('FUTURE_DATE_FORBIDDEN', 'Completed date cannot be in the future')
    }
    const updated: ReminderDto = { ...reminder, completedDate: date, version: reminder.version + 1 }
    store.updateReminder(state, reminder.id, updated)
    return { ...updated }
  },
}
