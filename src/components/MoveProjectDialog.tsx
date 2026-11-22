import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createMoveTreeOptions } from '../project-options'
import type { ProjectDto } from '../types'
import { CheckIcon, FolderRootIcon, MinusIcon } from './icons'
import { Modal, useDialogSubmit } from './ui'
import type { ActionResult } from './ui'

const MAX_PICKER_DEPTH = 8

export function MoveProjectDialog({
  project,
  projects,
  onSubmit,
  onClose,
}: {
  project: ProjectDto
  projects: ProjectDto[]
  onSubmit: (targetParentId: string | null) => Promise<ActionResult>
  onClose: () => void
}) {
  const currentParent = project.parentId ?? ''
  const options = useMemo(() => createMoveTreeOptions(project.id, projects), [project.id, projects])
  const [selected, setSelected] = useState(currentParent)
  const { submitting, error, submit } = useDialogSubmit(onClose)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const commit = (target: string) => {
    if (submitting) return
    void submit(() => onSubmit(target || null))
  }

  const moveSelection = (delta: number) => {
    const currentIndex = Math.max(0, options.findIndex((option) => option.value === selected))
    const nextIndex = Math.min(options.length - 1, Math.max(0, currentIndex + delta))
    setSelected(options[nextIndex].value)
  }

  return <Modal title="Move Project" description={`Choose a new parent for "${project.title}"`} onClose={onClose} busy={submitting} className="move-modal">
    <form onSubmit={(event: FormEvent) => { event.preventDefault(); commit(selected) }}>
      <div
        ref={listRef}
        className="move-tree-list"
        role="listbox"
        aria-label="Target location"
        tabIndex={0}
        data-autofocus
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            moveSelection(1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            moveSelection(-1)
          } else if (event.key === 'Home') {
            event.preventDefault()
            if (options[0]) setSelected(options[0].value)
          } else if (event.key === 'End') {
            event.preventDefault()
            if (options.length) setSelected(options[options.length - 1].value)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            commit(selected)
          }
        }}
      >
        {options.map((option) => {
          const isSelected = option.value === selected
          const isCurrent = option.value === currentParent
          const visualDepth = Math.min(option.depth, MAX_PICKER_DEPTH)
          return <button
            key={option.value || '__root__'}
            type="button"
            role="option"
            aria-selected={isSelected}
            tabIndex={-1}
            disabled={submitting}
            className={`move-tree-option ${isSelected ? 'selected' : ''} ${option.value === '' ? 'is-root-option' : ''}`}
            style={{ paddingLeft: `${12 + visualDepth * 16}px` }}
            title={option.label}
            onClick={() => setSelected(option.value)}
            onDoubleClick={() => commit(option.value)}
          >
            {option.value === ''
              ? <span className="move-root-icon" aria-hidden="true"><FolderRootIcon size={14} /></span>
              : <span className={`status-dot small ${option.status ?? 'active'}`} aria-hidden="true">
                {option.status === 'completed' && <CheckIcon size={8} strokeWidth={2.4} />}
                {option.status === 'canceled' && <MinusIcon size={8} strokeWidth={2.4} />}
              </span>}
            <span className="move-option-title">{option.title}</span>
            {option.depth > MAX_PICKER_DEPTH && <span className="move-option-badge">Level {option.depth}</span>}
            {option.shortId && <span className="move-option-badge">{option.shortId}</span>}
            {isCurrent && <span className="move-current-badge">Current</span>}
            {isSelected && <span className="move-selected-check" aria-hidden="true"><CheckIcon size={13} strokeWidth={2.4} /></span>}
          </button>
        })}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="secondary-button" disabled={submitting} onClick={onClose}>Cancel</button>
        <button type="submit" className="primary-button" disabled={submitting}>{submitting ? 'Moving…' : 'Move'}</button>
      </div>
    </form>
  </Modal>
}
