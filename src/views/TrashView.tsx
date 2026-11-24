import { useState } from 'react'
import { api } from '../api'
import { BranchNodeIcon, ReminderIcon } from '../components/icons'
import { ConfirmDialog, EmptyState } from '../components/ui'
import type { ActionRunner } from '../components/ui'
import { TRASH_KEYS } from '../query-keys'
import type { TrashEntryDto } from '../types'
import { formatTrashTimestamp } from '../ui-format'

export function TrashView({
  kind,
  entries,
  loading,
  pendingKey,
  onKindChange,
  onAction,
}: {
  kind: 'project' | 'reminder'
  entries: TrashEntryDto[]
  loading: boolean
  pendingKey: string | null
  onKindChange: (kind: 'project' | 'reminder') => void
  onAction: ActionRunner
}) {
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const emptying = pendingKey === 'trash:empty'
  return <section className="view-stack trash-view" aria-label="Trash">
    <div className="page-toolbar">
      <div className="page-title"><h1>Trash</h1><span className="count-label">{entries.length}</span></div>
      <button type="button" className="text-button danger-text" disabled={emptying || loading || !entries.length} onClick={() => setConfirmEmpty(true)}>Empty Current Tab</button>
    </div>
    <div className="segmented" aria-label="Trash category"><button type="button" aria-pressed={kind === 'project'} onClick={() => onKindChange('project')}>Projects</button><button type="button" aria-pressed={kind === 'reminder'} onClick={() => onKindChange('reminder')}>Reminders</button></div>
    <div className="trash-list card" aria-busy={loading}>{loading ? <div className="loading-state">Loading Trash…</div> : entries.length ? entries.map((entry) => <TrashRow key={entry.id} entry={entry} pending={pendingKey === `trash:${entry.id}` || emptying} onAction={onAction} />) : <EmptyState>Trash is empty.</EmptyState>}</div>
    {confirmEmpty && <ConfirmDialog title="Empty Trash" description={`Permanently delete ${entries.length} ${kind === 'project' ? 'project' : 'reminder'} ${entries.length === 1 ? 'entry' : 'entries'} and all associated data.${kind === 'project' ? ' All descendants and progress history will also be removed.' : ''} This action cannot be undone.`} confirmLabel="Delete Permanently" onClose={() => setConfirmEmpty(false)} onConfirm={() => onAction(() => api.emptyTrash(kind), 'Trash emptied', { key: 'trash:empty', invalidate: TRASH_KEYS })} />}
  </section>
}

function TrashRow({ entry, pending, onAction }: { entry: TrashEntryDto; pending: boolean; onAction: ActionRunner }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deletedTime = formatTrashTimestamp(entry.deletedAt)
  return <>
    <div className={`trash-row ${pending ? 'is-pending' : ''}`}>
      <span className="trash-kind-icon" aria-hidden="true">{entry.kind === 'project' ? <BranchNodeIcon size={16} /> : <ReminderIcon size={16} />}</span>
      <div className="trash-info">
        <strong title={entry.titleSnapshot}>{entry.titleSnapshot}</strong>
        <small title={entry.deletedAt}>{entry.kind === 'project' ? `Project tree · ${entry.affectedCountAtDelete} active ${entry.affectedCountAtDelete === 1 ? 'node' : 'nodes'} when deleted` : 'Reminder'} · <time dateTime={entry.deletedAt}>{deletedTime}</time></small>
      </div>
      <div className="trash-actions"><button type="button" className="text-button" disabled={pending} onClick={() => void onAction(() => api.restoreTrashEntry(entry.id), 'Restored', { key: `trash:${entry.id}`, invalidate: TRASH_KEYS })}>Restore</button><button type="button" className="text-button danger-text" disabled={pending} onClick={() => setConfirmDelete(true)}>Delete Permanently</button></div>
    </div>
    {confirmDelete && <ConfirmDialog title="Delete Permanently" description={entry.kind === 'project' ? `Permanently delete the project tree rooted at "${entry.titleSnapshot}"${entry.currentDescendantCount === null ? '' : ` (${entry.currentDescendantCount} ${entry.currentDescendantCount === 1 ? 'node' : 'nodes'})`} and its progress history? This action cannot be undone.` : `Permanently delete reminder "${entry.titleSnapshot}"? This action cannot be undone.`} confirmLabel="Delete Permanently" onClose={() => setConfirmDelete(false)} onConfirm={() => onAction(() => api.permanentlyDeleteTrashEntry(entry.id), 'Permanently deleted', { key: `trash:${entry.id}`, invalidate: TRASH_KEYS })} />}
  </>
}
