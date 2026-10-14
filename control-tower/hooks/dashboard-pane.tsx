import type { IssueRecord, Register } from 'claude-code'
import { composeRows, orphanIssues, renderDashboard } from './dashboard'
import { reloadIssues } from './issue-store'

const PANE = 'dash'
const TICK_MS = 60_000

// The dashboard refresh interval while the pane is open: one per session, cancelled on close.
let activeTick: { cancel: () => void } | null = null

/** Declares the `/dash` command; nothing opens the pane on its own (C1.3). Called from the session.start hook. */
export async function declareDashCommand($: any): Promise<void> {
  await $.command.register({
    name: 'dash',
    description: 'Toggle the dashboard pane listing the tracked issues.',
  })
}

/** On session.start, resume the tick when the pane is already open (Q6); never reopen a closed pane. */
export async function resumeDashboard($: any): Promise<void> {
  const open = (await $.ui.panes()).some((pane: any) => pane.id === PANE)
  if (open) startTick($)
}

/** Registers the `/dash` toggle, the close handler and the dashboard Pane render. */
export const registerDashboard: Register = (on) => {
  on('command.run', { command: 'dash' }, async ($) => {
    const open = (await $.ui.panes()).some((pane) => pane.id === PANE)
    if (open) {
      await $.ui.close({ id: PANE })
      return { text: 'Dashboard closed.' }
    }
    await $.ui.open({ id: PANE, title: 'Dashboard' })
    startTick($)
    return { text: 'Dashboard opened.' }
  })

  // Any close of the pane (the person's Escape or the toggle) stops the tick (C6.4, C6.5).
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) stopTick()
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const lines = await dashboardLines($, e.props.bodyColumns, await $.clock.now())
    return (
      <Box flexDirection="column">
        {lines.map((line) => (
          <Text>{line}</Text>
        ))}
      </Box>
    )
  })
}

/** Starts the refresh: one pass at once (C6.1), then every 60 s until the pane closes. */
function startTick($: any): void {
  stopTick()
  void refresh($)
  activeTick = $.clock.every(TICK_MS, () => {
    void refresh($)
  })
}

function stopTick(): void {
  if (activeTick) {
    activeTick.cancel()
    activeTick = null
  }
}

/** One refresh: reload the records from disk, then recompute orphans from git and store them (Q1). */
async function refresh($: any): Promise<void> {
  const cwd = await $.session.cwd()
  await reloadIssues($, cwd)
  const porcelain = await worktreeList($, cwd)
  const { value: issueIds = [] } = await $.state.get({ plugin: 'control-tower', key: 'issueIds' })
  const issues: Record<number, IssueRecord> = {}
  for (const id of issueIds as number[]) {
    const { value } = await $.state.get({ plugin: 'control-tower', key: 'issues', id: String(id) })
    if (value) issues[id] = value
  }
  const orphans = orphanIssues(porcelain, issueIds as number[], issues)
  await $.state.set({ plugin: 'control-tower', key: 'dashboardOrphans' }, [...orphans])
}

/** `git worktree list --porcelain` output, or null when git fails (C5.4: no mark, no log). */
async function worktreeList($: any, cwd: string): Promise<string | null> {
  try {
    const result = await $.process.run(['git', 'worktree', 'list', '--porcelain'], { cwd, timeoutMs: 1000 })
    return result.exitCode === 0 ? result.stdout : null
  } catch {
    return null
  }
}

/** The lines to draw: records and orphans read from $.state, composed and rendered by the pure rules. */
async function dashboardLines($: any, bodyColumns: number, now: number): Promise<string[]> {
  const { value: issueIds = [] } = await $.state.get({ plugin: 'control-tower', key: 'issueIds' })
  const issues: Record<number, IssueRecord> = {}
  for (const id of issueIds as number[]) {
    const { value } = await $.state.get({ plugin: 'control-tower', key: 'issues', id: String(id) })
    if (value) issues[id] = value
  }
  const { value: orphans = [] } = await $.state.get({ plugin: 'control-tower', key: 'dashboardOrphans' })
  const rows = composeRows(issueIds as number[], issues, new Set(orphans as number[]), now)
  return renderDashboard(rows, bodyColumns)
}
