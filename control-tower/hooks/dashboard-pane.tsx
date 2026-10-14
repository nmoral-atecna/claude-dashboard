import type { IssueRecord, Register } from 'claude-code'
import { composeRows, renderDashboard } from './dashboard'

const PANE = 'dash'

/** Declares the `/dash` command; nothing opens the pane on its own (C1.3). Called from the session.start hook. */
export async function declareDashCommand($: any): Promise<void> {
  await $.command.register({
    name: 'dash',
    description: 'Toggle the dashboard pane listing the tracked issues.',
  })
}

/** Registers the `/dash` toggle and the dashboard Pane render; called from the plugin's register. */
export const registerDashboard: Register = (on) => {
  // Toggle: open when closed, close when open.
  on('command.run', { command: 'dash' }, async ($) => {
    const open = (await $.ui.panes()).some((pane) => pane.id === PANE)
    if (open) {
      await $.ui.close({ id: PANE })
      return { text: 'Dashboard closed.' }
    }
    await $.ui.open({ id: PANE, title: 'Dashboard' })
    return { text: 'Dashboard opened.' }
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

/** The lines to draw: issue records read from $.state, composed and rendered by the pure rules. */
async function dashboardLines($: any, bodyColumns: number, now: number): Promise<string[]> {
  const { value: issueIds = [] } = await $.state.get({ plugin: 'control-tower', key: 'issueIds' })
  const issues: Record<number, IssueRecord> = {}
  for (const id of issueIds as number[]) {
    const { value } = await $.state.get({ plugin: 'control-tower', key: 'issues', id: String(id) })
    if (value) issues[id] = value
  }
  // Orphan marks come from the tick's $.state key (J3); until then, no issue is marked orphan.
  const rows = composeRows(issueIds as number[], issues, new Set<number>(), now)
  return renderDashboard(rows, bodyColumns)
}
