import type { ThemeMode } from '../types'
import { mockFail } from './store.ts'
import type { MockCommandHandler, MockState } from './store.ts'

export const settingsHandlers: Record<string, MockCommandHandler> = {
  get_app_settings: (_store, state) => ({ themeMode: state.themeMode }),

  set_theme_mode: (store, state, args) => {
    const mode = String(args.mode)
    if (!['light', 'dark', 'system'].includes(mode)) {
      mockFail('INVALID_INPUT', 'Invalid theme mode')
    }
    const nextState: MockState = { ...state, themeMode: mode as ThemeMode }
    store.saveState(nextState)
    return { themeMode: nextState.themeMode }
  },
}
