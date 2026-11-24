import type { ProjectDto, ReminderDto, TrashEntryDto } from '../types'
import { addDays, todayIsoDate } from '../ui-format.ts'
import type { MockState } from './store.ts'

const TRASH_Q3_READING = 'b7e10001-4a3c-4f90-8100-000000000001'
const TRASH_LEGACY_THEME = 'b7e10002-4a3c-4f90-8100-000000000002'
const TRASH_OLD_MOBILE = 'b7e10003-4a3c-4f90-8100-000000000003'
const TRASH_PUSH_SPIKE = 'b7e10004-4a3c-4f90-8100-000000000004'
const TRASH_REM_VENUE = 'b7e20001-4a3c-4f90-8200-000000000001'
const TRASH_REM_ADAPTERS = 'b7e20002-4a3c-4f90-8200-000000000002'
const TRASH_REM_Q2_RETRO = 'b7e20003-4a3c-4f90-8200-000000000003'

const P_RELEASE = '10000001-7b2d-4e8a-9c10-000000000001'
const P_PORTABILITY = '10000002-7b2d-4e8a-9c10-000000000002'
const P_FIXTURE_GEN = '10000003-7b2d-4e8a-9c10-000000000003'
const P_CLI_SWITCH = '10000004-7b2d-4e8a-9c10-000000000004'
const P_STARTUP_FALLBACK = '10000005-7b2d-4e8a-9c10-000000000005'
const P_MONTHLY_POLISH = '10000006-7b2d-4e8a-9c10-000000000006'
const P_A11Y_AUDIT = '10000007-7b2d-4e8a-9c10-000000000007'
const P_OVERDUE_BANNER = '10000008-7b2d-4e8a-9c10-000000000008'
const P_CLOUD_SYNC = '10000009-7b2d-4e8a-9c10-000000000009'
const P_EXPORT_NOTES = '10000010-7b2d-4e8a-9c10-000000000010'
const P_CHECKLIST_ACTIVE = 'a4c1e001-7b2d-4e8a-9c10-000000000011'
const P_CHECKLIST_DONE = 'a4c1f002-7b2d-4e8a-9c10-000000000012'

const P_RUST_MASTERY = '20000001-7b2d-4e8a-9c20-000000000001'
const P_SQLITE_WAL = '20000002-7b2d-4e8a-9c20-000000000002'
const P_BTREE_NOTES = '20000003-7b2d-4e8a-9c20-000000000003'
const P_TX_ISOLATION = '20000004-7b2d-4e8a-9c20-000000000004'
const P_ASYNC_RUNTIME = '20000005-7b2d-4e8a-9c20-000000000005'
const P_TOKIO_CHANNELS = '20000006-7b2d-4e8a-9c20-000000000006'
const P_GRACEFUL_SHUTDOWN = '20000007-7b2d-4e8a-9c20-000000000007'

const P_MARATHON = '30000001-7b2d-4e8a-9c30-000000000001'
const P_10K_TEMPO = '30000002-7b2d-4e8a-9c30-000000000002'
const P_LONG_RUN = '30000003-7b2d-4e8a-9c30-000000000003'
const P_MOBILITY = '30000004-7b2d-4e8a-9c30-000000000004'

const P_HOME_STUDIO = '40000001-7b2d-4e8a-9c40-000000000001'
const P_CABLE_MGMT = '40000002-7b2d-4e8a-9c40-000000000002'
const P_ACOUSTIC_FOAM = '40000003-7b2d-4e8a-9c40-000000000003'

const P_TRASH_READING = '50000001-7b2d-4e8a-9c50-000000000001'
const P_TRASH_THEME = '50000002-7b2d-4e8a-9c50-000000000002'
const P_TRASH_PALETTE = '50000003-7b2d-4e8a-9c50-000000000003'
const P_TRASH_MOBILE = '50000004-7b2d-4e8a-9c50-000000000004'
const P_TRASH_WIREFRAME = '50000005-7b2d-4e8a-9c50-000000000005'
const P_TRASH_PUSH = '50000006-7b2d-4e8a-9c50-000000000006'

const R_TRASH_VENUE = '90000019-7b2d-4e8a-9c90-000000000019'
const R_TRASH_ADAPTERS = '90000020-7b2d-4e8a-9c90-000000000020'
const R_TRASH_Q2_RETRO = '90000021-7b2d-4e8a-9c90-000000000021'

function shiftedTimestamp(anchor: string, days: number, hour: number, minute: number): string {
  return `${addDays(anchor, days)}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`
}

interface ProjectSeedInput {
  id: string
  parentId: string | null
  title: string
  status: ProjectDto['status']
  completedOffset?: number
  canceledOffset?: number
  sortOrder: number
  isExpanded?: boolean
  progressOffsets?: number[]
}

interface ReminderSeedInput {
  id: string
  title: string
  scheduledOffset: number
  status: ReminderDto['status']
  completed?: [number, number, number]
  canceledOffset?: number
  sortOrder?: number
}

export function createDemoMockState(anchorToday = todayIsoDate()): MockState {
  const projectSeeds: ProjectSeedInput[] = [
    { id: P_RELEASE, parentId: null, title: 'BranchTrace v1.2 Release', status: 'active', sortOrder: 1024, progressOffsets: [-33, -22, -15, -9, -5, -2, 0] },
    { id: P_PORTABILITY, parentId: P_RELEASE, title: 'Data Portability & Demo Mode', status: 'active', sortOrder: 1024, progressOffsets: [-8, -4, -1, 0] },
    { id: P_FIXTURE_GEN, parentId: P_PORTABILITY, title: 'SQLite Fixture Generator', status: 'completed', completedOffset: 0, sortOrder: 1024, progressOffsets: [-3, -1, 0] },
    { id: P_CLI_SWITCH, parentId: P_PORTABILITY, title: 'CLI Database Path Switch', status: 'active', sortOrder: 2048, progressOffsets: [-3, -1] },
    { id: P_STARTUP_FALLBACK, parentId: P_CLI_SWITCH, title: 'Startup Validation & Fallback', status: 'active', sortOrder: 1024, progressOffsets: [0] },
    { id: P_MONTHLY_POLISH, parentId: P_RELEASE, title: 'Monthly Calendar Polish', status: 'completed', completedOffset: -2, sortOrder: 2048, progressOffsets: [-11, -6, -4, -2] },
    { id: P_A11Y_AUDIT, parentId: P_MONTHLY_POLISH, title: 'Keyboard Accessibility Audit', status: 'active', sortOrder: 1024, progressOffsets: [-1] },
    { id: P_OVERDUE_BANNER, parentId: P_MONTHLY_POLISH, title: 'Overdue Banner Layout', status: 'completed', completedOffset: -4, sortOrder: 2048, progressOffsets: [-6, -5] },
    { id: P_CLOUD_SYNC, parentId: P_RELEASE, title: 'Cross-Device Cloud Sync (Deferred)', status: 'canceled', canceledOffset: -3, sortOrder: 3072, progressOffsets: [-12, -7, -5] },
    { id: P_EXPORT_NOTES, parentId: P_CLOUD_SYNC, title: 'Local Export Format Notes', status: 'active', sortOrder: 1024 },
    { id: P_CHECKLIST_ACTIVE, parentId: P_RELEASE, title: 'Release Checklist', status: 'active', sortOrder: 4096, progressOffsets: [-2, 0] },
    { id: P_CHECKLIST_DONE, parentId: P_RELEASE, title: 'Release Checklist', status: 'completed', completedOffset: 0, sortOrder: 5120 },

    { id: P_RUST_MASTERY, parentId: null, title: 'Systems & Rust Mastery', status: 'active', sortOrder: 2048, progressOffsets: [-40, -35, -26, -19, -14, -10, -6, -3, -1] },
    { id: P_SQLITE_WAL, parentId: P_RUST_MASTERY, title: 'SQLite Internals & WAL', status: 'active', sortOrder: 1024, progressOffsets: [-28, -16, -9, -4, -2, 0] },
    { id: P_BTREE_NOTES, parentId: P_SQLITE_WAL, title: 'B-Tree Page Layout Notes', status: 'completed', completedOffset: -1, sortOrder: 1024, progressOffsets: [-3, -1] },
    { id: P_TX_ISOLATION, parentId: P_SQLITE_WAL, title: 'Transaction Isolation Lab', status: 'active', sortOrder: 2048, progressOffsets: [-4, 0] },
    { id: P_ASYNC_RUNTIME, parentId: P_RUST_MASTERY, title: 'Async Runtime Deep Dive', status: 'active', sortOrder: 2048, isExpanded: false, progressOffsets: [-6, -2] },
    { id: P_TOKIO_CHANNELS, parentId: P_ASYNC_RUNTIME, title: 'Tokio Channel Patterns', status: 'active', sortOrder: 1024, progressOffsets: [-8, -5] },
    { id: P_GRACEFUL_SHUTDOWN, parentId: P_ASYNC_RUNTIME, title: 'Graceful Worker Shutdown', status: 'completed', completedOffset: -6, sortOrder: 2048, progressOffsets: [-7] },

    { id: P_MARATHON, parentId: null, title: 'Half-Marathon Training', status: 'active', sortOrder: 3072, progressOffsets: [-31, -25, -20, -16, -12, -9, -7, -4, -2, 0] },
    { id: P_10K_TEMPO, parentId: P_MARATHON, title: '10K Tempo Milestone', status: 'completed', completedOffset: -5, sortOrder: 1024, progressOffsets: [-12, -9, -5] },
    { id: P_LONG_RUN, parentId: P_MARATHON, title: 'Long Run Progression', status: 'active', sortOrder: 2048, progressOffsets: [-14, -7, -2] },
    { id: P_MOBILITY, parentId: P_MARATHON, title: 'Mobility & Recovery Routine', status: 'active', sortOrder: 3072, progressOffsets: [-3, -1, 0] },

    { id: P_HOME_STUDIO, parentId: null, title: 'Home Studio Upgrade', status: 'completed', completedOffset: -3, sortOrder: 4096, isExpanded: false, progressOffsets: [-13, -8, -4] },
    { id: P_CABLE_MGMT, parentId: P_HOME_STUDIO, title: 'Desk Cable Management', status: 'completed', completedOffset: -8, sortOrder: 1024, progressOffsets: [-10, -8] },
    { id: P_ACOUSTIC_FOAM, parentId: P_HOME_STUDIO, title: 'Acoustic Foam Panels', status: 'canceled', canceledOffset: -6, sortOrder: 2048 },

    // Soft-deleted projects (single, subtree, nested batches)
    { id: P_TRASH_READING, parentId: null, title: 'Q3 Reading List Cleanup', status: 'active', sortOrder: 5120, progressOffsets: [-12] },
    { id: P_TRASH_THEME, parentId: null, title: 'Legacy Theme Prototype', status: 'active', sortOrder: 6144 },
    { id: P_TRASH_PALETTE, parentId: P_TRASH_THEME, title: 'High-Contrast Palette Draft', status: 'active', sortOrder: 1024, progressOffsets: [-15] },
    { id: P_TRASH_MOBILE, parentId: null, title: 'Old Mobile Companion Idea', status: 'active', sortOrder: 7168, progressOffsets: [-18] },
    { id: P_TRASH_WIREFRAME, parentId: P_TRASH_MOBILE, title: 'Wireframe Sketches', status: 'active', sortOrder: 1024 },
    { id: P_TRASH_PUSH, parentId: P_TRASH_MOBILE, title: 'Push Notification Spike', status: 'active', sortOrder: 2048, progressOffsets: [-21] },
  ]

  const progress: Record<string, string[]> = {}
  const projects: ProjectDto[] = projectSeeds.map((seed) => {
    const dates = (seed.progressOffsets ?? []).map((offset) => addDays(anchorToday, offset)).sort()
    if (dates.length > 0) progress[seed.id] = dates
    return {
      id: seed.id,
      parentId: seed.parentId,
      title: seed.title,
      status: seed.status,
      completedDate: seed.completedOffset !== undefined ? addDays(anchorToday, seed.completedOffset) : null,
      canceledDate: seed.canceledOffset !== undefined ? addDays(anchorToday, seed.canceledOffset) : null,
      sortOrder: seed.sortOrder,
      version: 0,
      isExpanded: seed.isExpanded ?? true,
      recentProgressDates: dates.slice(-3),
      progressCount: dates.length,
      progressedToday: dates.includes(anchorToday),
    }
  })

  const reminderSeeds: ReminderSeedInput[] = [
    { id: '90000001-7b2d-4e8a-9c90-000000000001', title: 'Renew annual SSL certificate', scheduledOffset: -34, status: 'active' },
    { id: '90000002-7b2d-4e8a-9c90-000000000002', title: 'Submit quarterly expense receipts', scheduledOffset: -4, status: 'active' },
    { id: '90000003-7b2d-4e8a-9c90-000000000003', title: 'Follow up with dentist on checkup', scheduledOffset: -1, status: 'active' },
    { id: '90000004-7b2d-4e8a-9c90-000000000004', title: 'Review v1.2 changelog draft', scheduledOffset: 0, status: 'active', sortOrder: 1024 },
    { id: '90000005-7b2d-4e8a-9c90-000000000005', title: 'Backup local SQLite databases', scheduledOffset: 0, status: 'completed', completed: [0, 9, 15], sortOrder: 2048 },
    { id: '90000006-7b2d-4e8a-9c90-000000000006', title: 'Call courier about morning delivery', scheduledOffset: 0, status: 'canceled', canceledOffset: 0, sortOrder: 3072 },
    { id: '90000007-7b2d-4e8a-9c90-000000000007', title: 'Send architecture review notes', scheduledOffset: -3, status: 'completed', completed: [0, 8, 30] },
    { id: '90000008-7b2d-4e8a-9c90-000000000008', title: 'Prepare sprint retrospective slides', scheduledOffset: 2, status: 'completed', completed: [0, 10, 45] },
    { id: '90000009-7b2d-4e8a-9c90-000000000009', title: 'Pay monthly internet bill', scheduledOffset: -2, status: 'completed', completed: [-2, 14, 0] },
    { id: '90000010-7b2d-4e8a-9c90-000000000010', title: 'Order ergonomic keyboard switches', scheduledOffset: -5, status: 'completed', completed: [-3, 16, 20] },
    { id: '90000011-7b2d-4e8a-9c90-000000000011', title: 'Book coworking desk for workshop', scheduledOffset: -6, status: 'canceled', canceledOffset: -6 },
    { id: '90000012-7b2d-4e8a-9c90-000000000012', title: 'Review monthly budget sheet', scheduledOffset: -10, status: 'completed', completed: [-10, 11, 0] },
    { id: '90000013-7b2d-4e8a-9c90-000000000013', title: 'Sync with Alex on v1.2 QA plan', scheduledOffset: 1, status: 'active', sortOrder: 1024 },
    { id: '90000014-7b2d-4e8a-9c90-000000000014', title: 'Pick up running shoes from locker', scheduledOffset: 1, status: 'active', sortOrder: 2048 },
    { id: '90000015-7b2d-4e8a-9c90-000000000015', title: 'Draft release announcement post', scheduledOffset: 3, status: 'active' },
    { id: '90000016-7b2d-4e8a-9c90-000000000016', title: 'Schedule car maintenance service', scheduledOffset: 5, status: 'active' },
    { id: '90000017-7b2d-4e8a-9c90-000000000017', title: 'Quarterly health checkup appointment', scheduledOffset: 12, status: 'active' },
    { id: '90000018-7b2d-4e8a-9c90-000000000018', title: 'Renew domain registration', scheduledOffset: 28, status: 'active' },
    // Soft-deleted reminders
    { id: R_TRASH_VENUE, title: 'Confirm venue deposit', scheduledOffset: -2, status: 'active', sortOrder: 2048 },
    { id: R_TRASH_ADAPTERS, title: 'Buy extra USB-C adapters', scheduledOffset: 4, status: 'active' },
    { id: R_TRASH_Q2_RETRO, title: 'Draft Q2 retrospective', scheduledOffset: -8, status: 'completed', completed: [-7, 18, 0] },
  ]

  const reminders: ReminderDto[] = reminderSeeds.map((seed) => ({
    id: seed.id,
    title: seed.title,
    scheduledDate: addDays(anchorToday, seed.scheduledOffset),
    status: seed.status,
    completedDate: seed.completed ? addDays(anchorToday, seed.completed[0]) : null,
    completedActionAt: seed.completed ? shiftedTimestamp(anchorToday, seed.completed[0], seed.completed[1], seed.completed[2]) : null,
    canceledDate: seed.canceledOffset !== undefined ? addDays(anchorToday, seed.canceledOffset) : null,
    sortOrder: seed.sortOrder ?? 1024,
    version: 0,
  }))

  const trash: TrashEntryDto[] = [
    {
      id: TRASH_Q3_READING,
      kind: 'project',
      rootEntityId: P_TRASH_READING,
      titleSnapshot: 'Q3 Reading List Cleanup',
      deletedAt: shiftedTimestamp(anchorToday, -1, 15, 20),
      affectedCountAtDelete: 1,
      currentDescendantCount: 1,
    },
    {
      id: TRASH_LEGACY_THEME,
      kind: 'project',
      rootEntityId: P_TRASH_THEME,
      titleSnapshot: 'Legacy Theme Prototype',
      deletedAt: shiftedTimestamp(anchorToday, -2, 11, 40),
      affectedCountAtDelete: 2,
      currentDescendantCount: 2,
    },
    {
      id: TRASH_OLD_MOBILE,
      kind: 'project',
      rootEntityId: P_TRASH_MOBILE,
      titleSnapshot: 'Old Mobile Companion Idea',
      deletedAt: shiftedTimestamp(anchorToday, -3, 16, 10),
      affectedCountAtDelete: 2,
      currentDescendantCount: 3,
    },
    {
      id: TRASH_PUSH_SPIKE,
      kind: 'project',
      rootEntityId: P_TRASH_PUSH,
      titleSnapshot: 'Push Notification Spike',
      deletedAt: shiftedTimestamp(anchorToday, -5, 9, 30),
      affectedCountAtDelete: 1,
      currentDescendantCount: 1,
    },
    {
      id: TRASH_REM_VENUE,
      kind: 'reminder',
      rootEntityId: R_TRASH_VENUE,
      titleSnapshot: 'Confirm venue deposit',
      deletedAt: shiftedTimestamp(anchorToday, -1, 18, 5),
      affectedCountAtDelete: 1,
      currentDescendantCount: null,
    },
    {
      id: TRASH_REM_ADAPTERS,
      kind: 'reminder',
      rootEntityId: R_TRASH_ADAPTERS,
      titleSnapshot: 'Buy extra USB-C adapters',
      deletedAt: shiftedTimestamp(anchorToday, -2, 13, 25),
      affectedCountAtDelete: 1,
      currentDescendantCount: null,
    },
    {
      id: TRASH_REM_Q2_RETRO,
      kind: 'reminder',
      rootEntityId: R_TRASH_Q2_RETRO,
      titleSnapshot: 'Draft Q2 retrospective',
      deletedAt: shiftedTimestamp(anchorToday, -4, 17, 45),
      affectedCountAtDelete: 1,
      currentDescendantCount: null,
    },
  ]

  const trashBatches: Record<string, string[]> = {
    [TRASH_Q3_READING]: [P_TRASH_READING],
    [TRASH_LEGACY_THEME]: [P_TRASH_THEME, P_TRASH_PALETTE],
    [TRASH_OLD_MOBILE]: [P_TRASH_MOBILE, P_TRASH_WIREFRAME],
    [TRASH_PUSH_SPIKE]: [P_TRASH_PUSH],
  }

  return {
    projects,
    progress,
    reminders,
    trash,
    trashBatches,
    themeMode: 'system',
  }
}
