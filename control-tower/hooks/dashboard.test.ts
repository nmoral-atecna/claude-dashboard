import { test, expect } from 'claude-code/testing'
import type { HistoryEntry, IssueRecord, Step } from 'claude-code'
import {
  EMPTY_MESSAGE,
  composeRows,
  formatAge,
  orphanIssues,
  renderDashboard,
  renderRow,
  toRow,
} from './dashboard'

const NOW = Date.parse('2026-10-14T12:00:00Z')

function at(hm: string): string {
  return `2026-10-14T${hm}:00Z`
}

function hoursAgo(hours: number): string {
  return new Date(NOW - hours * 3600 * 1000).toISOString()
}

function h(step: Step, moment: string, note: string | null = null): HistoryEntry {
  return { step, at: moment, source: 'claude', note }
}

function record(partial: Partial<IssueRecord> & { issue: number; step: Step; history: HistoryEntry[] }): IssueRecord {
  return {
    issue: partial.issue,
    title: partial.title ?? null,
    step: partial.step,
    blockedReason: partial.blockedReason ?? null,
    branch: partial.branch ?? `feat/${partial.issue}-x`,
    worktree: partial.worktree ?? `/w/${partial.issue}`,
    history: partial.history,
    updatedAt: partial.updatedAt ?? partial.history[partial.history.length - 1]?.at ?? '',
  }
}

// C2 — compose one display row

test('C2.1 nominal-row', async () => {
  const row = toRow(record({ issue: 12, title: 'TVA', step: 'vert', history: [h('vert', at('10:15'), 'green')] }), false, NOW)
  expect(row.issue).toBe(12)
  expect(row.label).toBe('TVA')
  expect(row.step).toBe('vert')
  expect(row.marks).toEqual([])
  expect(row.note).toBe('green')
  expect(row.age).toBe('1h')
})

test('C2.2 blocked-row', async () => {
  const row = toRow(
    record({ issue: 12, step: 'vert', blockedReason: 'waiting API', history: [h('vert', at('10:15'))] }),
    false,
    NOW,
  )
  expect(row.step).toBe('vert')
  expect(row.marks).toEqual(['blocked'])
  expect(row.note).toBe('waiting API')
})

test('C2.3 no-note-row', async () => {
  const row = toRow(record({ issue: 12, step: 'vert', history: [h('vert', at('10:00'))] }), false, NOW)
  expect(row.note).toBe('—')
})

test('C2.4 earlier-note-row', async () => {
  const row = toRow(
    record({ issue: 12, step: 'vert', history: [h('vert', at('10:00'), 'x'), h('vert', at('11:00'))] }),
    false,
    NOW,
  )
  expect(row.note).toBe('x')
})

test('C2.5 no-title-shows-branch', async () => {
  const row = toRow(
    record({ issue: 12, title: null, branch: 'feat/12-tva', step: 'vert', history: [h('vert', at('11:00'))] }),
    false,
    NOW,
  )
  expect(row.label).toBe('feat/12-tva')
})

test('C2.6 age-format', async () => {
  expect(formatAge(30 * 1000)).toBe('0m')
  expect(formatAge(45 * 60 * 1000)).toBe('45m')
  expect(formatAge((3 * 60 + 10) * 60 * 1000)).toBe('3h')
  expect(formatAge((2 * 24 + 5) * 3600 * 1000)).toBe('2d')
})

test('C2.7 age-from-last-consecutive-run', async () => {
  const row = toRow(
    record({
      issue: 12,
      step: 'vert',
      history: [
        h('vert', at('08:00')),
        h('tests-valides', at('09:00')),
        h('vert', at('10:00')),
        h('vert', at('11:00'), 'note'),
      ],
    }),
    false,
    NOW,
  )
  expect(row.age).toBe('2h')
})

test('C2.8 no-issue-shows-empty-message', async () => {
  expect(renderDashboard(composeRows([], {}, new Set(), NOW), 100)).toEqual([EMPTY_MESSAGE])
})

test('C2.9 missing-record-is-ignored', async () => {
  const issues = { 12: record({ issue: 12, step: 'vert', history: [h('vert', at('11:00'))] }) }
  const rows = composeRows([12, 7], issues, new Set(), NOW)
  expect(rows.map((r) => r.issue)).toEqual([12])
})

// C3 — sorting

function order(issues: Record<number, IssueRecord>, orphans: Set<number> = new Set()): number[] {
  return composeRows(Object.keys(issues).map(Number), issues, orphans, NOW).map((r) => r.issue)
}

test('C3.1 blocked-then-least-advanced', async () => {
  const issues = {
    1: record({ issue: 1, step: 'refacto', blockedReason: 'x', history: [h('refacto', at('11:00'))] }),
    2: record({ issue: 2, step: 'spec', history: [h('spec', at('11:00'))] }),
    3: record({ issue: 3, step: 'vert', history: [h('vert', at('11:00'))] }),
  }
  expect(order(issues)).toEqual([1, 2, 3])
})

test('C3.2 same-step-oldest-first', async () => {
  const issues = {
    1: record({ issue: 1, step: 'vert', history: [h('vert', hoursAgo(5))] }),
    2: record({ issue: 2, step: 'vert', history: [h('vert', hoursAgo(1))] }),
  }
  expect(order(issues)).toEqual([1, 2])
})

test('C3.3 two-blocked-least-advanced-first', async () => {
  const issues = {
    1: record({ issue: 1, step: 'doc', blockedReason: 'x', history: [h('doc', at('11:00'))] }),
    2: record({ issue: 2, step: 'spec', blockedReason: 'y', history: [h('spec', at('11:00'))] }),
  }
  expect(order(issues)).toEqual([2, 1])
})

test('C3.4 tie-breaks-on-issue-number', async () => {
  const issues = {
    9: record({ issue: 9, step: 'vert', history: [h('vert', at('11:00'))] }),
    4: record({ issue: 4, step: 'vert', history: [h('vert', at('11:00'))] }),
  }
  expect(order(issues)).toEqual([4, 9])
})

// C4 — hiding finished issues

test('C4.1 termine-just-under-threshold-is-shown-last', async () => {
  const issues = {
    1: record({ issue: 1, step: 'vert', history: [h('vert', at('11:00'))] }),
    2: record({ issue: 2, step: 'termine', history: [h('termine', hoursAgo(167))] }),
  }
  expect(order(issues)).toEqual([1, 2])
})

test('C4.2 termine-at-threshold-is-hidden', async () => {
  const issues = {
    2: record({ issue: 2, step: 'termine', history: [h('termine', hoursAgo(168))] }),
  }
  expect(order(issues)).toEqual([])
})

// C5 — orphan detection from `git worktree list --porcelain`

const porcelain = (paths: string[]): string =>
  paths.map((p) => `worktree ${p}\nHEAD abc\nbranch refs/heads/x\n`).join('\n')

test('C5.1 missing-worktree-is-orphan', async () => {
  const issues = { 12: record({ issue: 12, step: 'vert', worktree: '/w/12', history: [h('vert', at('11:00'))] }) }
  expect(orphanIssues(porcelain(['/w/1']), [12], issues).has(12)).toBe(true)
})

test('C5.2 present-worktree-is-not-orphan', async () => {
  const issues = { 12: record({ issue: 12, step: 'vert', worktree: '/w/12', history: [h('vert', at('11:00'))] }) }
  expect(orphanIssues(porcelain(['/w/12']), [12], issues).has(12)).toBe(false)
})

test('C5.3 termine-is-never-orphan', async () => {
  const issues = { 12: record({ issue: 12, step: 'termine', worktree: '/w/12', history: [h('termine', at('11:00'))] }) }
  expect(orphanIssues(porcelain(['/w/1']), [12], issues).has(12)).toBe(false)
})

test('C5.4 git-failure-yields-no-orphan', async () => {
  const issues = { 12: record({ issue: 12, step: 'vert', worktree: '/w/12', history: [h('vert', at('11:00'))] }) }
  expect(orphanIssues(null, [12], issues).size).toBe(0)
})

// C7.1 — truncation to fit the body columns

test('C7.1 row-fits-in-body-columns', async () => {
  const title = 'a'.repeat(80)
  const note = 'b'.repeat(150)
  const row = toRow(
    record({ issue: 12, title, step: 'vert', history: [h('vert', at('11:00'), note)] }),
    false,
    NOW,
  )
  const line = renderRow(row, 100)
  expect(line.length).toBeLessThanOrEqual(100)
  expect(line).toContain('…')
  expect(line).not.toContain(title)
  expect(line).not.toContain(note)
})
