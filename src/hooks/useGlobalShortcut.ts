import { useEffect, useRef } from 'react'
import { isEditableElement } from '../components/ui'

export interface GlobalShortcutOptions {
  allowModifiers?: boolean
}

export function useGlobalShortcut(
  handler: (event: KeyboardEvent) => void,
  options?: GlobalShortcutOptions,
) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  const allowModifiers = options?.allowModifiers ?? false

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      if (!allowModifiers && (event.ctrlKey || event.metaKey || event.altKey)) return
      if (document.getElementById('root')?.hasAttribute('inert')) return
      if (document.querySelector('[role="menu"]')) return
      if (isEditableElement(event.target)) return
      handlerRef.current(event)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [allowModifiers])
}

export function usePeriodNavigationShortcuts(
  onStep: (delta: number) => void,
  onToday: () => void,
) {
  useGlobalShortcut((event) => {
    if (event.key === 'ArrowLeft' || event.key === '[') {
      event.preventDefault()
      onStep(-1)
    } else if (event.key === 'ArrowRight' || event.key === ']') {
      event.preventDefault()
      onStep(1)
    } else if (event.key.toLowerCase() === 't') {
      event.preventDefault()
      onToday()
    }
  })
}
