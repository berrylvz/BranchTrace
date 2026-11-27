import { api } from '../api'
import {
  BranchNodeIcon,
  CheckIcon,
  DownloadIcon,
  KeyboardIcon,
  MonitorIcon,
  MoonIcon,
  RefreshCwIcon,
  SlidersIcon,
  SunIcon,
} from '../components/icons'
import type { ActionRunner } from '../components/ui'
import type { AppUpdaterController } from '../hooks/useAppUpdater'
import type { DisplayDensity } from '../preferences'
import { SETTINGS_KEYS } from '../query-keys'
import type { ThemeMode } from '../types'
import { formatBundleLabel, formatByteSize, formatUpdateDate } from '../updater'

const themeOptions: { value: ThemeMode; label: string; caption: string; preview: 'system' | 'light' | 'dark' }[] = [
  { value: 'system', label: 'System', caption: 'Automatically match your operating system appearance', preview: 'system' },
  { value: 'light', label: 'Light', caption: 'High-contrast calm surface for daytime focus', preview: 'light' },
  { value: 'dark', label: 'Dark', caption: 'Independently tuned dark palette for night sessions', preview: 'dark' },
]

const densityOptions: { value: DisplayDensity; label: string; caption: string }[] = [
  { value: 'comfortable', label: 'Comfortable', caption: 'Balanced spacing (36px project rows, 44px root rows) for everyday desktop work' },
  { value: 'compact', label: 'Compact', caption: 'Higher information density (30px project rows, 36px root rows) for large trees' },
]

const shortcuts: { keys: string[]; label: string }[] = [
  { keys: ['1', '2', '⌘/Ctrl+1–2'], label: 'Switch between Projects and Calendar views' },
  { keys: ['M', 'S'], label: 'Switch between Month and Summary modes in Calendar' },
  { keys: ['⌘/Ctrl+K', '⌘/Ctrl+F'], label: 'Search projects in the Projects tree' },
  { keys: ['N'], label: 'Create a new project (Projects) or add a reminder (Calendar)' },
  { keys: ['↑', '↓', '←', '→', 'Home', 'End'], label: 'Navigate, expand, and collapse nodes in the Projects tree' },
  { keys: ['←', '→'], label: 'Navigate previous / next month or date range in Calendar' },
  { keys: ['T'], label: 'Jump to This Month or latest range ending today in Calendar' },
  { keys: ['F2'], label: 'Inline rename the focused project or reminder' },
  { keys: ['Right-click'], label: 'Open context menu on a project or reminder' },
  { keys: ['Enter', 'Esc'], label: 'Confirm edits, open details, or close side panels & dialogs' },
]

export function SettingsView({
  mode,
  density,
  pending,
  updater,
  onDensityChange,
  onAction,
}: {
  mode: ThemeMode
  density: DisplayDensity
  pending: boolean
  updater: AppUpdaterController
  onDensityChange: (density: DisplayDensity) => void
  onAction: ActionRunner
}) {
  const { runtime, state } = updater
  const updateBusy = state.status === 'checking' || state.status === 'downloading' || state.status === 'installing'
  const bundleLabel = formatBundleLabel(runtime.bundleType, runtime.isDesktop)
  const canCheckNow = runtime.isDesktop && runtime.canAutoUpdate && !updateBusy
  const updateDetail = state.status === 'available' || state.status === 'downloading' || state.status === 'installing' || state.status === 'installed'
    ? state.update
    : state.status === 'error'
      ? state.update
      : null
  const formattedUpdateDate = updateDetail ? formatUpdateDate(updateDetail.date) : null
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
          <h2 className="heading-with-icon"><SlidersIcon size={16} />Display Density</h2>
          <p className="muted">Adjust row heights and workspace spacing to match your screen size and project volume.</p>
        </div>
        <div className="density-grid" role="group" aria-label="Display density">
          {densityOptions.map((option) => {
            const active = density === option.value
            return <button
              key={option.value}
              type="button"
              className={`theme-option-card ${active ? 'active' : ''}`}
              aria-pressed={active}
              onClick={() => onDensityChange(option.value)}
            >
              <span className="theme-option-meta">
                <span className="theme-option-title">
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

      <section className="settings-card card">
        <div className="settings-card-header">
          <h2 className="heading-with-icon"><DownloadIcon size={16} />Software Updates</h2>
          <p className="muted">Check GitHub Releases for signed BranchTrace updates. On Debian/Ubuntu, installing a .deb update prompts for system authentication via dpkg.</p>
        </div>

        <div className="update-status-row">
          <div className="update-version-meta">
            <div className="update-version-line">
              <strong>BranchTrace v{runtime.version}</strong>
              <span className="meta-pill">{bundleLabel}</span>
            </div>
            <p className="muted update-caption">
              {!runtime.isDesktop
                ? 'In-app updates are available in the installed desktop app.'
                : !runtime.canAutoUpdate
                  ? 'Install BranchTrace from a signed .deb package to enable one-click dpkg updates.'
                  : state.status === 'checking'
                    ? 'Checking GitHub Releases for a newer signed package…'
                    : state.status === 'up-to-date'
                      ? 'You are running the latest published version.'
                      : state.status === 'available'
                        ? `Version v${state.update.version} is ready to download and install.`
                        : state.status === 'downloading'
                          ? `Downloading BranchTrace v${state.update.version}…`
                          : state.status === 'installing'
                            ? 'Installing .deb package via dpkg… Approve the system password prompt to continue.'
                            : state.status === 'installed'
                              ? `BranchTrace v${state.update.version} has been installed via dpkg.`
                              : 'Updates are checked against signed GitHub Releases manifests.'}
            </p>
          </div>
          <button
            type="button"
            className="secondary-button"
            disabled={!canCheckNow}
            onClick={() => void updater.checkForUpdates()}
          >
            <RefreshCwIcon size={14} className={state.status === 'checking' ? 'spin-icon' : undefined} />
            <span>{state.status === 'checking' ? 'Checking…' : 'Check for Updates'}</span>
          </button>
        </div>

        {updateDetail && state.status !== 'installed' && <div className="update-panel">
          <div className="update-panel-head">
            <div className="update-panel-title">
              <span className="ui-badge tone-primary">New version</span>
              <strong>v{updateDetail.version}</strong>
              {formattedUpdateDate && <span className="muted">Released {formattedUpdateDate}</span>}
            </div>
            {(state.status === 'available' || state.status === 'error') && <button
              type="button"
              className="primary-button btn-sm"
              disabled={!runtime.canAutoUpdate || updateBusy}
              onClick={() => void updater.installUpdate()}
            >
              <DownloadIcon size={14} />
              <span>{state.status === 'error' ? 'Retry Install' : 'Download & Install'}</span>
            </button>}
          </div>

          {updateDetail.body && <pre className="update-notes">{updateDetail.body}</pre>}

          {state.status === 'downloading' && <div className="update-progress-block" aria-live="polite">
            <div className="update-progress-meta">
              <span>{formatByteSize(state.progress.downloadedBytes)}{state.progress.totalBytes !== null ? ` / ${formatByteSize(state.progress.totalBytes)}` : ''}</span>
              {state.progress.percent !== null && <span>{state.progress.percent}%</span>}
            </div>
            <div
              className="update-progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={state.progress.percent ?? undefined}
            >
              <div
                className={`update-progress-fill ${state.progress.percent === null ? 'indeterminate' : ''}`}
                style={state.progress.percent !== null ? { width: `${state.progress.percent}%` } : undefined}
              />
            </div>
          </div>}

          {state.status === 'installing' && <p className="update-installing-note" role="status">
            Verifying signature and installing the .deb package with dpkg… Your local SQLite database is preserved.
          </p>}
        </div>}

        {state.status === 'installed' && <div className="update-banner update-banner-success" role="status">
          <div>
            <strong>Update v{state.update.version} installed</strong>
            <p className="muted">Restart BranchTrace to cleanly flush your SQLite database and launch the new version.</p>
          </div>
          <button type="button" className="primary-button btn-sm" onClick={() => void updater.relaunch()}>
            Restart Now
          </button>
        </div>}

        {state.status === 'error' && <div className="update-banner update-banner-error" role="alert">
          <span>{state.message}</span>
        </div>}
      </section>

      <section className="settings-card card about-card">
        <div className="about-header">
          <span className="brand-mark about-mark" aria-hidden="true"><BranchNodeIcon size={20} /></span>
          <div>
            <h2>BranchTrace</h2>
            <p className="muted">Track progress, not just completion — organize long-term goals as project trees.</p>
          </div>
        </div>
        <div className="about-badges">
          <span className="meta-pill">v{runtime.version}</span>
          <span className="meta-pill">{bundleLabel}</span>
          <span className="meta-pill">Offline-first</span>
          <span className="meta-pill">SQLite Transactions</span>
        </div>
      </section>
    </div>
  </section>
}
