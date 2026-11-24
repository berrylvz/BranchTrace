import { projectHandlers } from './projects.ts'
import { reminderHandlers } from './reminders.ts'
import { settingsHandlers } from './settings.ts'
import { createMockStore, mockFail } from './store.ts'
import type { MockCommandHandler } from './store.ts'
import { trashHandlers } from './trash.ts'
import { viewHandlers } from './views.ts'

const handlers: Record<string, MockCommandHandler> = {
  ...projectHandlers,
  ...reminderHandlers,
  ...viewHandlers,
  ...trashHandlers,
  ...settingsHandlers,
}

export function createMockCaller() {
  const store = createMockStore()
  return async function mockCall<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    const state = store.getState()
    const handler = handlers[command]
    if (!handler) {
      mockFail('DB_ERROR', `Unknown command: ${command}`)
    }
    return handler(store, state, args) as T
  }
}
