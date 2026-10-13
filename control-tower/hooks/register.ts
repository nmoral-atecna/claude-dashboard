import type { Register } from 'claude-code'
import { resolveIssue } from './issue-resolver'

const STEPS = ['spec', 'tests-ecrits', 'tests-valides', 'vert', 'refacto', 'doc', 'mr', 'ci', 'termine']
const NO_ISSUE = 'No issue tracked on this branch. Do not retry; ask the user to switch to an issue branch.'

const SET_ISSUE_STEP = {
  name: 'set_issue_step',
  description: 'Moves the issue tracked on the current branch to a workflow step, one step at a time '
    + `(${STEPS.join(' → ')}); going back or repeating the current step is allowed. `
    + 'Step `bloque` marks the issue blocked with `blockedReason` and keeps its step.',
  isDeferred: false,
  inputSchema: {
    type: 'object',
    properties: {
      step: { type: 'string', enum: [...STEPS, 'bloque'], description: 'Target step, or `bloque` to block the issue.' },
      note: { type: 'string', maxLength: 200, description: 'Short note recorded in the issue history.' },
      title: { type: 'string', description: 'Issue title, kept only when the issue has none.' },
      blockedReason: { type: 'string', description: 'Why the issue is blocked; required when step is `bloque`.' },
    },
    required: ['step'],
  },
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.tool.register(SET_ISSUE_STEP)
    return next(e)
  })

  // Answered here without next(e): the call never reaches core, hence no permission check.
  on('tool.call', { tool: 'mcp__control-tower__set_issue_step' }, async ($, e, next) => {
    // $ cannot cross an import, so the helpers get closures limited to the calls they make.
    const io = {
      process: { run: (argv: string[], init: any) => $.process.run(argv, init) },
      ui: { log: (text: string, init: any) => $.ui.log(text, init) },
    }
    const resolved = await resolveIssue(io, await $.session.cwd(), String(options.branchPattern))
    if (resolved === null) return { result: NO_ISSUE }
    return next(e)
  })
}
