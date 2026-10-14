import { test, expect, mock } from 'claude-code/testing'
import type { HistoryEntry, IssueRecord, Step } from 'claude-code'

const NOW = Date.parse('2026-10-14T12:00:00Z')
const PANE = 'dash'
const CWD = '/src/repo'
const DIR = '/home/t/.claude/control-tower/repo'

function h(step: Step, at: string, note: string | null = null): HistoryEntry {
  return { step, at, source: 'claude', note }
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

const paneProps = (bodyColumns: number): any => ({
  title: 'Dashboard',
  isFocused: false,
  bodyColumns,
  placement: 'inline',
  scroll: { top: 0, bodyRows: 20, contentRows: 1 },
  view: {},
})

type World = {
  files: Record<string, string>
  worktrees: string[]
  gitFails: boolean
  panes: { id: string; title: string }[]
}

function world(opts: { records?: IssueRecord[]; worktrees?: string[]; gitFails?: boolean; open?: boolean }): World {
  const files: Record<string, string> = {}
  for (const rec of opts.records ?? []) files[`${DIR}/${rec.issue}.json`] = JSON.stringify(rec)
  return {
    files,
    worktrees: opts.worktrees ?? (opts.records ?? []).map((r) => r.worktree),
    gitFails: opts.gitFails ?? false,
    panes: opts.open ? [{ id: PANE, title: 'Dashboard' }] : [],
  }
}

// Answers every $ call the dashboard tick, render and co-loaded register.ts make, over a mocked clock.
function engine(on: any, w: World) {
  const clock = mock.clock(on, { now: NOW })
  const state: Record<string, any> = {}
  const counts = { gitList: 0, fsList: 0, orphanWrites: 0, logs: 0 }
  on('session.start', async ($b: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', async () => ({ value: CWD }))
  on('tool.register', async ($b: any, e: any) => ({ value: { tool: `mcp__control-tower__${e.name}` } }))
  on('command.register', async ($b: any, e: any) => ({ value: { command: e.name } }))
  on('ui.open', async ($b: any, e: any) => {
    if (!w.panes.some((p) => p.id === e.id)) w.panes.push({ id: e.id, title: e.title ?? e.id })
    return { value: { isPlaced: true } }
  })
  on('ui.close', async ($b: any, e: any) => {
    const i = w.panes.findIndex((p) => p.id === e.id)
    if (i >= 0) w.panes.splice(i, 1)
    return { value: undefined }
  })
  on('ui.panes', async () => ({ value: w.panes.map((p) => ({ id: p.id, title: p.title, isPlaced: true })) }))
  on('process.run', async ($b: any, e: any) => {
    const [cmd, sub] = e.argv
    if (cmd === 'git' && sub === 'worktree') {
      counts.gitList++
      if (w.gitFails) return { value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository\n' } }
      const stdout = [CWD, ...w.worktrees].map((p) => `worktree ${p}\nHEAD abc\nbranch refs/heads/x\n`).join('\n')
      return { value: { exitCode: 0, stdout, stderr: '' } }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('env.get', async ($b: any, e: any) => ({ value: e.name === 'HOME' ? '/home/t' : undefined }))
  on('fs.exists', async ($b: any, e: any) => ({ value: e.path === DIR ? true : e.path in w.files }))
  on('fs.list', async () => {
    counts.fsList++
    return { value: Object.keys(w.files).map((p) => ({ name: p.slice(DIR.length + 1), kind: 'file' })) }
  })
  on('fs.read', async ($b: any, e: any) => ({ value: w.files[e.path] }))
  on('state.get', async ($b: any, e: any) => {
    if (e.key === 'issueIds') return { value: { value: state.issueIds ?? [], version: 1 } }
    if (e.key === 'dashboardOrphans') return { value: { value: state.dashboardOrphans ?? [], version: 1 } }
    const rec = state[`issues/${e.id}`]
    return { value: { value: rec, version: rec ? 1 : 0 } }
  })
  on('state.set', async ($b: any, e: any) => {
    if (e.key === 'dashboardOrphans') {
      counts.orphanWrites++
      state.dashboardOrphans = e.value
    } else if (e.key === 'issueIds') {
      state.issueIds = e.value
    } else {
      state[`issues/${e.id}`] = e.value
    }
    return { value: { isSet: true, version: 1 } }
  })
  on('ui.log', async () => {
    counts.logs++
    return { value: undefined }
  })
  on('classic.SessionStart', async () => ({}))
  return { clock, state, counts }
}

const issue = (n: number, step: Step, extra: Partial<IssueRecord> = {}) =>
  record({ issue: n, step, history: [h(step, '2026-10-14T11:00:00Z')], ...extra })

async function lineFor($: any, clock: any, n: number): Promise<string> {
  await clock.settle()
  const ui = await $.ui.mount({
    plugin: 'control-tower',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE,
    props: paneProps(100),
  })
  const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  await ui.unmount()
  return texts.find((t: string) => t.includes(`#${n}`)) ?? ''
}

// C6.1 — immediate pass on open

test('C6.1 opening-runs-one-refresh-at-once', async ($: any, on: any) => {
  const { clock, counts } = engine(on, world({ records: [issue(12, 'vert')] }))
  await $.session.start({ cwd: CWD })
  await $.command.run({ command: 'dash' })
  await clock.settle()
  expect(counts.orphanWrites).toBe(1)
  expect(counts.fsList).toBe(1)
  expect(counts.gitList).toBeGreaterThanOrEqual(1)
})

// C6.2 — orphan visible within 60 s

test('C6.2 removed-worktree-is-marked-orphan-within-60s', async ($: any, on: any) => {
  const w = world({ records: [issue(12, 'vert', { worktree: '/w/12' })], worktrees: ['/w/12'] })
  const { clock } = engine(on, w)
  await $.session.start({ cwd: CWD })
  await $.command.run({ command: 'dash' })
  w.worktrees = [] // the worktree is removed from another shell
  await clock.advance(60_000)
  expect(await lineFor($, clock, 12)).toContain('orphan')
})

// C6.3 — another session's disk change shows up after the tick

test('C6.3 disk-change-shows-after-the-tick', async ($: any, on: any) => {
  const w = world({ records: [issue(12, 'vert')] })
  const { clock } = engine(on, w)
  await $.session.start({ cwd: CWD })
  await $.command.run({ command: 'dash' })
  w.files[`${DIR}/12.json`] = JSON.stringify(issue(12, 'refacto'))
  await clock.advance(60_000)
  expect(await lineFor($, clock, 12)).toContain('refacto')
})

// C6.4 — closed by /dash stops the tick

test('C6.4 closing-with-dash-stops-git-and-disk', async ($: any, on: any) => {
  const { clock, counts } = engine(on, world({ records: [issue(12, 'vert')] }))
  await $.session.start({ cwd: CWD })
  await $.command.run({ command: 'dash' })
  await $.command.run({ command: 'dash' }) // close
  await clock.settle()
  const frozen = { ...counts }
  await clock.advance(120_000)
  expect(counts.orphanWrites).toBe(frozen.orphanWrites)
  expect(counts.gitList).toBe(frozen.gitList)
  expect(counts.fsList).toBe(frozen.fsList)
})

// C6.5 — a ui.close on the pane stops the tick (the person's Escape path)
// The kit exposes no way to raise an engine/person-origin ui.close; the pane's close is driven through the
// toggle, which raises ui.close to the dashboard's origin-agnostic close hook — the same hook the person's
// Escape reaches in a real session. What this asserts over C6.4 is the stop alone, with no command output.

test('C6.5 pane-close-stops-git-and-disk', async ($: any, on: any) => {
  const { clock, counts } = engine(on, world({ records: [issue(12, 'vert')] }))
  await $.session.start({ cwd: CWD })
  await $.command.run({ command: 'dash' })
  await $.command.run({ command: 'dash' }) // closes the pane, raising ui.close to the close hook
  await clock.settle()
  const frozen = { ...counts }
  await clock.advance(120_000)
  expect(counts.orphanWrites).toBe(frozen.orphanWrites)
  expect(counts.gitList).toBe(frozen.gitList)
  expect(counts.fsList).toBe(frozen.fsList)
})

// C6.6 — resume when the pane is already open

test('C6.6 session-start-resumes-the-tick-when-open', async ($: any, on: any) => {
  const { clock, counts } = engine(on, world({ records: [issue(12, 'vert')], open: true }))
  await $.session.start({ cwd: CWD })
  await clock.settle()
  expect(counts.orphanWrites).toBe(1)
  await clock.advance(60_000)
  expect(counts.orphanWrites).toBe(2)
})

// C6.7 — no resume when no pane is listed

test('C6.7 session-start-starts-no-tick-without-a-pane', async ($: any, on: any) => {
  const w = world({ records: [issue(12, 'vert')] })
  const { clock, counts } = engine(on, w)
  await $.session.start({ cwd: CWD })
  await clock.advance(120_000)
  expect(counts.orphanWrites).toBe(0)
  expect(w.panes).toHaveLength(0)
})

// C5.4 — git failure marks nothing and logs nothing

test('C5.4 git-failure-writes-no-orphan-and-no-log', async ($: any, on: any) => {
  const { clock, state, counts } = engine(on, world({ records: [issue(12, 'vert')], gitFails: true }))
  await $.session.start({ cwd: CWD })
  await $.command.run({ command: 'dash' })
  await clock.settle()
  expect(state.dashboardOrphans).toEqual([])
  expect(counts.logs).toBe(0)
})
