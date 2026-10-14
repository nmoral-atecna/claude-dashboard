import type { IssueRecord, Step } from 'claude-code'
import { STEPS } from './issue-step'

/** A `termine` issue is hidden once it has spent at least this long in that step. */
export const TERMINE_MAX_AGE_MS = 168 * 3600 * 1000
export const EMPTY_MESSAGE = 'No tracked issue.'
export const NO_NOTE = '—'

export type Mark = 'blocked' | 'orphan'

export type DashboardRow = {
  issue: number
  /** Title, or branch when the title is null. */
  label: string
  step: Step
  /** Marks shown next to the step, blocked before orphan. */
  marks: Mark[]
  note: string
  ageMs: number
  age: string
}

/** The display row for one issue record. */
export function toRow(record: IssueRecord, orphan: boolean, now: number): DashboardRow {
  const marks: Mark[] = []
  if (record.blockedReason !== null) marks.push('blocked')
  if (orphan) marks.push('orphan')
  const ms = ageMs(record, now)
  return {
    issue: record.issue,
    label: record.title ?? record.branch,
    step: record.step,
    marks,
    note: lastNote(record),
    ageMs: ms,
    age: formatAge(ms),
  }
}

/** The visible rows for `issueIds`: missing and hidden records dropped, then sorted (C3). */
export function composeRows(
  issueIds: number[],
  issues: Record<number, IssueRecord | undefined>,
  orphans: Set<number>,
  now: number,
): DashboardRow[] {
  const rows: DashboardRow[] = []
  for (const id of issueIds) {
    const record = issues[id]
    if (!record) continue
    if (isHidden(record, now)) continue
    rows.push(toRow(record, orphans.has(id), now))
  }
  return rows.sort(compareRows)
}

/** One rendered line per row, truncated to `bodyColumns`; the empty message when there is none. */
export function renderDashboard(rows: DashboardRow[], bodyColumns: number): string[] {
  if (rows.length === 0) return [EMPTY_MESSAGE]
  return rows.map((row) => renderRow(row, bodyColumns))
}

/**
 * `#n  label  step[ marks]  note  age`, never wider than `bodyColumns`.
 * Label and note evenly share the columns left after the fixed fields and separators.
 */
export function renderRow(row: DashboardRow, bodyColumns: number): string {
  const sep = '  '
  const head = `#${row.issue}`
  const stepField = row.marks.length > 0 ? `${row.step} ${row.marks.join(' ')}` : row.step
  const fixed = head.length + stepField.length + row.age.length + sep.length * 4
  const remaining = Math.max(0, bodyColumns - fixed)
  const labelBudget = Math.floor(remaining / 2)
  const noteBudget = remaining - labelBudget
  return [head, truncate(row.label, labelBudget), stepField, truncate(row.note, noteBudget), row.age].join(sep)
}

/** The issue numbers whose worktree is gone, excluding `termine`; empty when git failed (porcelain null). */
export function orphanIssues(
  porcelain: string | null,
  issueIds: number[],
  issues: Record<number, IssueRecord | undefined>,
): Set<number> {
  const orphans = new Set<number>()
  if (porcelain === null) return orphans
  const present = parseWorktreePaths(porcelain)
  for (const id of issueIds) {
    const record = issues[id]
    if (!record || record.step === 'termine') continue
    if (!present.has(record.worktree)) orphans.add(id)
  }
  return orphans
}

/** Age formatted with a single floored unit: `Xm` under 1h, `Xh` under 1d, else `Xd`. */
export function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** Sort key: blocked first, then least advanced step, then oldest first, then issue number. */
function compareRows(a: DashboardRow, b: DashboardRow): number {
  const blockedDelta = Number(isBlocked(b)) - Number(isBlocked(a))
  if (blockedDelta !== 0) return blockedDelta
  const stepDelta = STEPS.indexOf(a.step) - STEPS.indexOf(b.step)
  if (stepDelta !== 0) return stepDelta
  if (a.ageMs !== b.ageMs) return b.ageMs - a.ageMs
  return a.issue - b.issue
}

function isBlocked(row: DashboardRow): boolean {
  return row.marks.includes('blocked')
}

function isHidden(record: IssueRecord, now: number): boolean {
  return record.step === 'termine' && ageMs(record, now) >= TERMINE_MAX_AGE_MS
}

/** Milliseconds since the start of the last consecutive run of history entries on the current step. */
function ageMs(record: IssueRecord, now: number): number {
  let start = record.updatedAt
  for (let i = record.history.length - 1; i >= 0; i--) {
    if (record.history[i].step !== record.step) break
    start = record.history[i].at
  }
  return now - Date.parse(start)
}

/** The note shown: blocked reason when blocked, else the most recent non-null history note, else a dash. */
function lastNote(record: IssueRecord): string {
  if (record.blockedReason !== null) return record.blockedReason
  for (let i = record.history.length - 1; i >= 0; i--) {
    const note = record.history[i].note
    if (note !== null) return note
  }
  return NO_NOTE
}

function parseWorktreePaths(porcelain: string): Set<string> {
  const prefix = 'worktree '
  const paths = new Set<string>()
  for (const line of porcelain.split('\n')) {
    if (line.startsWith(prefix)) paths.add(line.slice(prefix.length))
  }
  return paths
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  if (max <= 0) return ''
  if (max === 1) return '…'
  return `${text.slice(0, max - 1)}…`
}
