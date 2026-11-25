import { getBundleType, getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater'

export const SUPPORTED_UPDATER_BUNDLES = ['deb', 'rpm', 'appimage', 'nsis', 'msi', 'app'] as const
export type SupportedUpdaterBundle = (typeof SUPPORTED_UPDATER_BUNDLES)[number]

export interface AppRuntimeInfo {
  version: string
  bundleType: string | null
  isDesktop: boolean
  canAutoUpdate: boolean
}

export interface UpdateSummary {
  currentVersion: string
  version: string
  date: string | null
  body: string | null
}

export interface UpdateProgress {
  downloadedBytes: number
  totalBytes: number | null
  percent: number | null
}

export type UpdaterState =
  | { status: 'idle' }
  | { status: 'checking'; silent: boolean }
  | { status: 'up-to-date'; checkedAt: string }
  | { status: 'available'; update: UpdateSummary }
  | { status: 'downloading'; update: UpdateSummary; progress: UpdateProgress }
  | { status: 'installing'; update: UpdateSummary }
  | { status: 'installed'; update: UpdateSummary }
  | { status: 'error'; message: string; update: UpdateSummary | null }

export type UpdaterHandle = Update
export type UpdaterDownloadEvent = DownloadEvent

function fallbackAppVersion() {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env
  return env?.VITE_APP_VERSION || '1.0.0'
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

export function isUpdaterSupportedBundle(bundleType: string | null): bundleType is SupportedUpdaterBundle {
  return bundleType !== null && (SUPPORTED_UPDATER_BUNDLES as readonly string[]).includes(bundleType)
}

export function getInitialRuntimeInfo(): AppRuntimeInfo {
  const isDesktop = isTauriRuntime()
  return {
    version: fallbackAppVersion(),
    bundleType: null,
    isDesktop,
    canAutoUpdate: false,
  }
}

export async function getAppRuntimeInfo(): Promise<AppRuntimeInfo> {
  if (!isTauriRuntime()) {
    return {
      version: fallbackAppVersion(),
      bundleType: null,
      isDesktop: false,
      canAutoUpdate: false,
    }
  }

  let version = fallbackAppVersion()
  let bundleType: string | null = null

  try {
    version = await getVersion()
  } catch {
    version = fallbackAppVersion()
  }

  try {
    const detected = await getBundleType()
    bundleType = typeof detected === 'string' && detected.length > 0 ? detected : null
  } catch {
    bundleType = null
  }

  return {
    version,
    bundleType,
    isDesktop: true,
    canAutoUpdate: isUpdaterSupportedBundle(bundleType),
  }
}

export function calculateDownloadPercent(downloadedBytes: number, totalBytes: number | null): number | null {
  if (totalBytes === null || !Number.isFinite(totalBytes) || totalBytes <= 0) return null
  const clamped = Math.max(0, Math.min(downloadedBytes, totalBytes))
  return Math.round((clamped / totalBytes) * 100)
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

export function formatBundleLabel(bundleType: string | null, isDesktop: boolean): string {
  if (!isDesktop) return 'Web preview'
  switch (bundleType) {
    case 'deb':
      return 'deb package (dpkg)'
    case 'rpm':
      return 'RPM package'
    case 'appimage':
      return 'AppImage'
    case 'nsis':
    case 'msi':
      return 'Windows installer'
    case 'app':
      return 'macOS bundle'
    default:
      return 'Unpackaged build'
  }
}

export function formatUpdateDate(date: string | null): string | null {
  if (!date) return null
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(parsed)
}

export function toUpdateSummary(update: Pick<Update, 'currentVersion' | 'version' | 'date' | 'body'>): UpdateSummary {
  return {
    currentVersion: update.currentVersion,
    version: update.version,
    date: update.date ?? null,
    body: update.body?.trim() ? update.body.trim() : null,
  }
}

export function formatUpdaterError(error: unknown): string {
  const raw = typeof error === 'string'
    ? error
    : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error)
  const lower = raw.toLowerCase()

  if (lower.includes('authentication failed') || lower.includes('cancelled') || lower.includes('canceled')) {
    return 'Administrator authentication was cancelled. Try again when ready to install the .deb update.'
  }
  if (lower.includes('failed to install .deb') || lower.includes('failed to install package')) {
    return 'dpkg could not install the update package. Ensure no other apt/dpkg process is running and try again.'
  }
  if (lower.includes('signedversionmismatch') || lower.includes('missingsignedversion') || lower.includes('signed for version') || lower.includes('signature') || lower.includes('minisign')) {
    return 'Update signature verification failed. Installation was aborted to protect your system.'
  }
  if (lower.includes('valid release json') || lower.includes('404')) {
    return 'No published update release was found on GitHub Releases yet.'
  }
  if (lower.includes('not found in the response') || lower.includes('fallback platforms')) {
    return 'No matching .deb package for this platform was found in the latest release.'
  }
  if (lower.includes('error sending request') || lower.includes('timed out') || lower.includes('dns') || lower.includes('connect') || lower.includes('network')) {
    return 'Unable to reach GitHub Releases. Check your internet connection and try again.'
  }
  return raw || 'An unexpected error occurred while updating.'
}

export async function checkForAppUpdate(options?: { timeoutMs?: number }): Promise<UpdaterHandle | null> {
  if (!isTauriRuntime()) return null
  const { check } = await import('@tauri-apps/plugin-updater')
  return check({ timeout: options?.timeoutMs ?? 15_000 })
}

export async function relaunchApp(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('relaunch_app')
}
