import { test, expect, mock } from 'claude-code/testing'
import type { HistoryEntry, IssueRecord, Step } from 'claude-code'

const NOW = Date.parse('2026-10-14T12:00:00Z')
const PANE = 'dash'

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

// Answers every $ call the dashboard module (and the co-loaded register.ts) makes.
function engine(on: any, opts: { issueIds?: number[]; records?: Record<number, IssueRecord> } = {}) {
  const issueIds = opts.issueIds ?? []
  const records = opts.records ?? {}
  const panes: { id: string; title: string }[] = []
  const registered: any[] = []
  const clock = mock.clock(on, { now: NOW })
  on('session.start', async ($b: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', async () => ({ value: '/src/repo' }))
  on('tool.register', async ($b: any, e: any) => ({ value: { tool: `mcp__control-tower__${e.name}` } }))
  on('command.register', async ($b: any, e: any) => {
    registered.push(e)
    return { value: { command: e.name } }
  })
  on('ui.open', async ($b: any, e: any) => {
    const found = panes.find((p) => p.id === e.id)
    if (found) found.title = e.title ?? found.title
    else panes.push({ id: e.id, title: e.title ?? e.id })
    return { value: { isPlaced: true } }
  })
  on('ui.close', async ($b: any, e: any) => {
    const i = panes.findIndex((p) => p.id === e.id)
    if (i >= 0) panes.splice(i, 1)
    return { value: undefined }
  })
  on('ui.panes', async () => ({ value: panes.map((p) => ({ id: p.id, title: p.title, isPlaced: true })) }))
  on('state.get', async ($b: any, e: any) => {
    if (e.key === 'issueIds') return { value: { value: issueIds, version: 1 } }
    const rec = records[Number(e.id)]
    return { value: { value: rec, version: rec ? 1 : 0 } }
  })
  // reloadIssues (register.ts on classic.SessionStart) touches these; an empty store keeps it quiet.
  on('process.run', async () => ({
    value: { exitCode: 0, stdout: 'worktree /src/repo\nHEAD abc\nbranch refs/heads/main\n', stderr: '' },
  }))
  on('env.get', async ($b: any, e: any) => ({ value: e.name === 'HOME' ? '/home/t' : undefined }))
  on('fs.exists', async () => ({ value: false }))
  on('fs.list', async () => ({ value: [] }))
  on('state.set', async () => ({ value: { isSet: true, version: 1 } }))
  on('classic.SessionStart', async () => ({}))
  on('ui.log', async () => ({ value: undefined }))
  return { panes, registered, clock }
}

const ids = (panes: { id: string }[]) => panes.map((p) => p.id)

// C1 — /dash toggles the pane

test('C1.1 dash-opens-the-closed-pane', async ($: any, on: any) => {
  const { panes, clock } = engine(on)
  await $.session.start({ cwd: '/src/repo' })
  const answer = await $.command.run({ command: 'dash' })
  expect(answer.text).toBe('Dashboard opened.')
  expect(ids(panes)).toContain(PANE)
  await clock.settle() // let the open's immediate refresh finish before teardown
})

test('C1.2 dash-closes-the-open-pane', async ($: any, on: any) => {
  const { panes, clock } = engine(on)
  await $.session.start({ cwd: '/src/repo' })
  await $.command.run({ command: 'dash' })
  await clock.settle() // let the open's immediate refresh finish before closing
  const answer = await $.command.run({ command: 'dash' })
  expect(answer.text).toBe('Dashboard closed.')
  expect(ids(panes)).not.toContain(PANE)
})

test('C1.3 registering-dash-opens-nothing', async ($: any, on: any) => {
  const records = {
    1: record({ issue: 1, step: 'spec', history: [h('spec', '2026-10-14T11:00:00Z')] }),
    2: record({ issue: 2, step: 'vert', history: [h('vert', '2026-10-14T11:00:00Z')] }),
    3: record({ issue: 3, step: 'refacto', history: [h('refacto', '2026-10-14T11:00:00Z')] }),
  }
  const { panes } = engine(on, { issueIds: [1, 2, 3], records })
  await $.session.start({ cwd: '/src/repo' })
  await $.classic.SessionStart({ source: 'startup', cwd: '/src/repo' })
  expect(panes).toHaveLength(0)
})

// C2.1 — the pane renders the issue line end to end

test('C2.1 pane-renders-the-issue-line', async ($: any, on: any) => {
  const records = {
    12: record({ issue: 12, title: 'TVA', step: 'vert', history: [h('vert', '2026-10-14T10:15:00Z', 'green')] }),
  }
  engine(on, { issueIds: [12], records })
  const ui = await $.ui.mount({
    plugin: 'control-tower',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE,
    props: paneProps(100),
  })
  const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  expect(texts).toEqual(['ISSUE  TITLE  STEP  NOTE   AGE', '#12    TVA    vert  green  1h'])
  await ui.unmount()
})

// C7.2 — the same lines on every surface

test('C7.2 same-lines-on-terminal-and-desktop', async ($: any, on: any) => {
  const records = {
    12: record({ issue: 12, title: 'TVA', step: 'vert', history: [h('vert', '2026-10-14T10:15:00Z', 'green')] }),
  }
  engine(on, { issueIds: [12], records })
  const lines: Record<string, string[]> = {}
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'control-tower',
      surface,
      component: 'Pane',
      requestId: PANE,
      props: paneProps(100),
    })
    lines[surface] = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
    await ui.unmount()
  }
  expect(lines.desktop).toEqual(lines.terminal)
})
