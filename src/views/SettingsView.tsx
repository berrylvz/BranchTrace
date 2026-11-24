import { api } from '../api'
import { BranchNodeIcon, CheckIcon, KeyboardIcon, MonitorIcon, MoonIcon, SunIcon } from '../components/icons'
import type { ActionRunner } from '../components/ui'
import { SETTINGS_KEYS } from '../query-keys'
import type { ThemeMode } from '../types'

const themeOptions: { value: ThemeMode; label: string; caption: string; preview: 'system' | 'light' | 'dark' }[] = [
  { value: 'system', label: 'System', caption: 'Automatically match your operating system appearance', preview: 'system' },
  { value: 'light', label: 'Light', caption: 'Crisp paper-like surface for daytime focus', preview: 'light' },
  { value: 'dark', label: 'Dark', caption: 'Low-glare forest dark palette for night sessions', preview: 'dark' },
]

const shortcuts: { keys: string[]; label: string }[] = [
  { keys: ['1', '2', '3'], label: 'Switch between Projects, Weekly, and Monthly views' },
  { keys: ['N'], label: 'Focus the new top-level project input' },
  { keys: ['←', '→'], label: 'Navigate previous / next week (Weekly) or month (Monthly)' },
  { keys: ['T'], label: 'Jump to This Week (Weekly) or This Month (Monthly)' },
  { keys: ['F2'], label: 'Inline rename the focused project or reminder' },
  { keys: ['Right-click'], label: 'Open the action menu on a project or reminder' },
  { keys: ['Enter', 'Esc'], label: 'Submit continuously, confirm edits, or cancel' },
]

export function SettingsView({ mode, pending, onAction }: { mode: ThemeMode; pending: boolean; onAction: ActionRunner }) {
  return <section className="view-stack settings-view" aria-label="Settings">
    <div className="page-toolbar"><h1>Settings</h1></div>
    <div className="settings-stack">
      <section className="settings-card card">
        <div className="settings-card-header">
          <h2>Appearance</h2>
          <p className="muted">Choose your interface theme. Changes apply immediately and are saved locally.</p>
        </div>
        <div className="theme-grid" role="group" aria-label="Theme">
          {themeOptions.map((option) => {
            const active = mode === option.value
            return <button
              key={option.value}
              type="button"
              className={`theme-option-card ${active ? 'active' : ''}`}
              aria-pressed={active}
              disabled={pending}
              onClick={() => { if (mode !== option.value) void onAction(() => api.setThemeMode(option.value), 'Theme updated', { key: 'settings:theme', invalidate: SETTINGS_KEYS }) }}
            >
              <span className={`theme-preview preview-${option.preview}`} aria-hidden="true">
                <span className="preview-bar"><span className="preview-dot" /><span className="preview-line short" /></span>
                <span className="preview-body">
                  <span className="preview-row"><span className="preview-line" /><span className="preview-pill" /></span>
                  <span className="preview-row indent"><span className="preview-line mid" /><span className="preview-pill done" /></span>
                  <span className="preview-row indent"><span className="preview-line short" /></span>
                </span>
              </span>
              <span className="theme-option-meta">
                <span className="theme-option-title">
                  {option.value === 'system' ? <MonitorIcon size={14} /> : option.value === 'light' ? <SunIcon size={14} /> : <MoonIcon size={14} />}
                  <strong>{option.label}</strong>
                  {active && <span className="theme-active-check" aria-hidden="true"><CheckIcon size={11} strokeWidth={2.4} /></span>}
                </span>
                <small>{option.caption}</small>
              </span>
            </button>
          })}
        </div>
      </section>

      <section className="settings-card card">
        <div className="settings-card-header">
          <h2 className="heading-with-icon"><KeyboardIcon size={16} />Keyboard Shortcuts</h2>
          <p className="muted">Navigate views and manage items quickly when no text field is focused.</p>
        </div>
        <div className="shortcut-list">
          {shortcuts.map((item) => <div key={item.label} className="shortcut-row">
            <span className="shortcut-label">{item.label}</span>
            <span className="shortcut-keys">{item.keys.map((key) => <kbd key={key}>{key}</kbd>)}</span>
          </div>)}
        </div>
      </section>

      <section className="settings-card card about-card">
        <div className="about-header">
          <span className="brand-mark about-mark" aria-hidden="true"><BranchNodeIcon size={20} /></span>
          <div>
            <h2>BranchTrace</h2>
            <p className="muted">Organize long-term goals as project trees and track daily momentum.</p>
          </div>
        </div>
        <div className="about-badges">
          <span className="meta-pill">v1.0.0</span>
          <span className="meta-pill">Offline-first</span>
          <span className="meta-pill">SQLite Transactions</span>
        </div>
      </section>
    </div>
  </section>
}
