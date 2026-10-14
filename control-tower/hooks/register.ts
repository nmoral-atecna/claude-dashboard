import type { Register } from 'claude-code'
import { autoStep, type AutoSignals } from './auto-step'
import { resolveIssue } from './issue-resolver'
import { loadIssue, saveIssue } from './issue-store'
import { applyStep, invalidRequest, NOTE_MAX_LENGTH, REQUESTED_STEPS, STEPS } from './issue-step'
const NO_ISSUE = 'No issue tracked on this branch. Do not retry; ask the user to switch to an issue branch.'
// Recognizes a PR/MR creation in the command text, even when `gh`/`glab` is neutralized by a shell function.
const PR_PATTERN = /gh pr create|glab mr create/

// $ cannot cross an import, so the store helpers get closures limited to the calls they make.
function closures($: any) {
  return {
    process: { run: (argv: string[], init: any) => $.process.run(argv, init) },
    ui: { log: (text: string, init: any) => $.ui.log(text, init) },
    fs: {
      exists: (path: string) => $.fs.exists(path),
      read: (path: string) => $.fs.read(path),
      write: (path: string, text: string) => $.fs.write(path, text),
    },
    // $.env.get needs a literal name; HOME is the only variable the store reads.
    env: { get: () => $.env.get('HOME') },
    clock: { now: () => $.clock.now() },
    // $.state.set needs a literal plugin and key; the store only writes control-tower.issues.
    state: {
      set: (ref: any, value: any) => $.state.set({ plugin: 'control-tower', key: 'issues', id: ref.id }, value),
    },
  }
}

const SET_ISSUE_STEP = {
  name: 'set_issue_step',
  description: 'Moves the issue tracked on the current branch to a workflow step, one step at a time '
    + `(${STEPS.join(' → ')}); going back or repeating the current step is allowed. `
    + 'Step `bloque` marks the issue blocked with `blockedReason` and keeps its step.',
  isDeferred: false,
  inputSchema: {
    type: 'object',
    properties: {
      step: { type: 'string', enum: REQUESTED_STEPS, description: 'Target step, or `bloque` to block the issue.' },
      note: { type: 'string', maxLength: NOTE_MAX_LENGTH, description: 'Short note recorded in the issue history.' },
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
  on('tool.call', { tool: 'mcp__control-tower__set_issue_step' }, async ($, e: any) => {
    const invalid = invalidRequest(e)
    if (invalid !== null) return { result: invalid }
    const io = closures($)
    const tracked = await resolveIssue(io, await $.session.cwd(), String(options.branchPattern))
    if (tracked === null) return { result: NO_ISSUE }
    const current = await loadIssue(io, tracked.worktree, tracked.issue)
    if (current === 'unreadable') return { result: `Failed to read issue ${tracked.issue}; see the transcript.` }
    const at = new Date(await $.clock.now()).toISOString()
    const outcome = applyStep(current, e, tracked, at)
    if ('refusal' in outcome) return { result: outcome.refusal }
    if (!(await saveIssue(io, outcome.record))) {
      return { result: `Failed to save issue ${tracked.issue}; see the transcript.` }
    }
    if (e.step === 'bloque') return { result: `Issue ${tracked.issue} blocked: ${outcome.record.blockedReason}.` }
    return { result: `Issue ${tracked.issue} moved to \`${outcome.record.step}\`.` }
  })

  // Observes Bash commands and advances the tracked issue on mechanical cases; the result is left untouched.
  on('tool.call', { tool: 'Bash' }, async ($: any, e: any, next: any) => {
    const result = await next(e)
    try {
      await observeBash($, e, result, options)
    } catch {
      // An observer must never break the Bash call it watches.
    }
    return result
  })
}

async function observeBash($: any, e: any, result: any, options: any): Promise<void> {
  const bash = result?.result
  if (bash?.backgroundTaskId != null || bash?.interrupted === true) return

  const command = typeof e.command === 'string' ? e.command : ''
  const io = closures($)
  const succeeded = result?.isError !== true
  const signals: AutoSignals = {}
  const testPattern = compileTestPattern(io, options.testPattern)
  if (testPattern && testPattern.test(command)) signals.testsPassed = succeeded
  if (PR_PATTERN.test(command)) signals.prCreated = succeeded
  if (Object.keys(signals).length === 0) return

  const cwd = commandCwd(command) ?? await $.session.cwd()
  const tracked = await resolveIssue(io, cwd, String(options.branchPattern))
  if (tracked === null) return
  const current = await loadIssue(io, tracked.worktree, tracked.issue)
  if (current === null || current === 'unreadable') return

  const target = autoStep(current.step, signals)
  if (target === null) return

  const at = new Date(await $.clock.now()).toISOString()
  await saveIssue(io, {
    ...current,
    step: target,
    history: [...current.history, { step: target, at, source: 'auto', note: command.slice(0, NOTE_MAX_LENGTH) }],
  })
}

/** Compiles the test-recognition regex; logs and disables the rule when the pattern is invalid. */
function compileTestPattern(io: any, pattern: unknown): RegExp | null {
  try {
    return new RegExp(String(pattern))
  } catch (error: any) {
    io.ui.log(`control-tower: invalid testPattern ${pattern}: ${error.message}`, { to: 'transcript' })
    return null
  }
}

// A leading `cd <path> &&` sets the cwd the issue resolves from.
// shortcut: <path> has no spaces; upgrade when quoted or escaped paths must be handled.
function commandCwd(command: string): string | null {
  const match = /^cd\s+(\S+)\s+&&/.exec(command)
  return match ? match[1] : null
}
