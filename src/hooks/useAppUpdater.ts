import { useCallback, useEffect, useRef, useState } from 'react'
import {
  calculateDownloadPercent,
  checkForAppUpdate,
  formatUpdaterError,
  getAppRuntimeInfo,
  getInitialRuntimeInfo,
  relaunchApp,
  toUpdateSummary,
} from '../updater'
import type { AppRuntimeInfo, UpdateSummary, UpdaterHandle, UpdaterState } from '../updater'

export interface AppUpdaterController {
  runtime: AppRuntimeInfo
  state: UpdaterState
  hasUpdateAvailable: boolean
  checkForUpdates: (options?: { silent?: boolean }) => Promise<void>
  installUpdate: () => Promise<void>
  relaunch: () => Promise<void>
}

export function useAppUpdater(options?: {
  onAvailable?: (update: UpdateSummary) => void
}): AppUpdaterController {
  const [runtime, setRuntime] = useState<AppRuntimeInfo>(() => getInitialRuntimeInfo())
  const [state, setState] = useState<UpdaterState>({ status: 'idle' })
  const handleRef = useRef<UpdaterHandle | null>(null)
  const summaryRef = useRef<UpdateSummary | null>(null)
  const busyRef = useRef(false)
  const autoCheckedRef = useRef(false)
  const onAvailableRef = useRef(options?.onAvailable)
  onAvailableRef.current = options?.onAvailable

  const releaseHandle = useCallback(async () => {
    const current = handleRef.current
    handleRef.current = null
    if (current) {
      await current.close().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    let active = true
    void getAppRuntimeInfo().then((info) => {
      if (active) setRuntime(info)
    })
    return () => {
      active = false
      void releaseHandle()
    }
  }, [releaseHandle])

  const checkForUpdates = useCallback(async (checkOptions?: { silent?: boolean }) => {
    const silent = Boolean(checkOptions?.silent)
    if (!runtime.isDesktop || busyRef.current) return
    if (!runtime.canAutoUpdate) {
      if (!silent) {
        setState({
          status: 'error',
          message: 'In-app updates require an installed .deb package (unpackaged dev builds cannot self-update).',
          update: null,
        })
      }
      return
    }

    busyRef.current = true
    setState({ status: 'checking', silent })

    try {
      const nextHandle = await checkForAppUpdate()
      await releaseHandle()

      if (!nextHandle) {
        summaryRef.current = null
        setState(silent ? { status: 'idle' } : { status: 'up-to-date', checkedAt: new Date().toISOString() })
        return
      }

      handleRef.current = nextHandle
      const summary = toUpdateSummary(nextHandle)
      summaryRef.current = summary
      setState({ status: 'available', update: summary })
      if (silent) {
        onAvailableRef.current?.(summary)
      }
    } catch (error) {
      if (silent) {
        setState({ status: 'idle' })
      } else {
        setState({
          status: 'error',
          message: formatUpdaterError(error),
          update: summaryRef.current,
        })
      }
    } finally {
      busyRef.current = false
    }
  }, [releaseHandle, runtime.canAutoUpdate, runtime.isDesktop])

  useEffect(() => {
    if (!runtime.isDesktop || !runtime.canAutoUpdate || autoCheckedRef.current) return
    autoCheckedRef.current = true
    const timer = window.setTimeout(() => {
      void checkForUpdates({ silent: true })
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [checkForUpdates, runtime.canAutoUpdate, runtime.isDesktop])

  const installUpdate = useCallback(async () => {
    if (!runtime.isDesktop || !runtime.canAutoUpdate || busyRef.current) return
    const handle = handleRef.current
    const summary = summaryRef.current
    if (!handle || !summary) return

    busyRef.current = true
    let downloadedBytes = 0
    let totalBytes: number | null = null

    setState({
      status: 'downloading',
      update: summary,
      progress: { downloadedBytes: 0, totalBytes: null, percent: null },
    })

    try {
      await handle.download((event) => {
        if (event.event === 'Started') {
          totalBytes = typeof event.data.contentLength === 'number' ? event.data.contentLength : null
          setState({
            status: 'downloading',
            update: summary,
            progress: {
              downloadedBytes,
              totalBytes,
              percent: calculateDownloadPercent(downloadedBytes, totalBytes),
            },
          })
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength
          setState({
            status: 'downloading',
            update: summary,
            progress: {
              downloadedBytes,
              totalBytes,
              percent: calculateDownloadPercent(downloadedBytes, totalBytes),
            },
          })
        } else if (event.event === 'Finished') {
          setState({
            status: 'downloading',
            update: summary,
            progress: {
              downloadedBytes,
              totalBytes: totalBytes ?? downloadedBytes,
              percent: 100,
            },
          })
        }
      })

      setState({ status: 'installing', update: summary })
      await handle.install()
      await releaseHandle()
      setState({ status: 'installed', update: summary })
    } catch (error) {
      setState({
        status: 'error',
        message: formatUpdaterError(error),
        update: summary,
      })
    } finally {
      busyRef.current = false
    }
  }, [releaseHandle, runtime.canAutoUpdate, runtime.isDesktop])

  const relaunch = useCallback(async () => {
    await relaunchApp()
  }, [])

  const hasUpdateAvailable = state.status === 'available' || state.status === 'installed'

  return {
    runtime,
    state,
    hasUpdateAvailable,
    checkForUpdates,
    installUpdate,
    relaunch,
  }
}
