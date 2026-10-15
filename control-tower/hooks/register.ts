import type { Register } from 'claude-code'
import { autoStep, type AutoSignals } from './auto-step'
import { declareDashCommand, registerDashboard, resumeDashboard } from './dashboard-pane'
import { resolveIssue } from './issue-resolver'
import { loadIssue, reloadIssues, saveIssue } from './issue-store'
import { applyStep, invalidRequest, NOTE_MAX_LENGTH, REQUESTED_STEPS, STEPS } from './issue-step'
const NO_ISSUE = 'No issue tracked on this branch. Do not retry; ask the user to switch to an issue branch.'
// Matches a PR/MR creation run as a command (start, or after `&&`/`;`/`|`), even if `gh`/`glab` is a shell function.
const PR_PATTERN = /(^|[;&|]\s*)(gh pr create|glab mr create)\b/

// $ cannot cross an import, so the store helpers get closures limited to the calls they make.
function closures($: any) {
  return {
    process: { run: (argv: string[], init: any) => $.process.run(argv, init) },
    ui: { log: (text: string, init: any) => $.ui.log(text, init) },
    fs: {
      exists: (path: string) => $.fs.exists(path),
      list: (path: string) => $.fs.list(path),
      read: (path: string) => $.fs.read(path),
      write: (path: string, text: string) => $.fs.write(path, text),
    },
    // $.env.get needs a literal name; HOME is the only variable the store reads.
    env: { get: () => $.env.get('HOME') },
    clock: { now: () => $.clock.now() },
    // $.state needs a literal plugin and key; the store only reads issueIds and writes it and issues.
    state: {
      get: () => $.state.get({ plugin: 'control-tower', key: 'issueIds' }),
      set: (ref: any, value: any, init?: any) => ref.key === 'issueIds'
        ? $.state.set({ plugin: 'control-tower', key: 'issueIds' }, value, init)
        : $.state.set({ plugin: 'control-tower', key: 'issues', id: ref.id }, value),
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
  registerDashboard(on)

  on('session.start', async ($, e, next) => {
    await $.tool.register(SET_ISSUE_STEP)
    await declareDashCommand($)
    await resumeDashboard($)
    return next(e)
  })

  // Reloads the project's records on every source (startup, resume, clear, compact, fork); the result is left untouched.
  on('classic.SessionStart', async ($: any, e: any, next: any) => {
    await reloadIssues(closures($), e.cwd)
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
    const command = typeof e.command === 'string' ? e.command : ''
    const removePath = worktreeRemovePath(command)
    // The removed worktree vanishes after next(e); resolve and load its issue while it still exists.
    const removal = removePath !== null ? await loadRemoval($, options, removePath) : null
    const result = await next(e)
    try {
      await observeBash($, command, result, options, removal)
    } catch {
      // An observer must never break the Bash call it watches.
    }
    return result
  })
}

async function observeBash($: any, command: string, result: any, options: any, removal: any): Promise<void> {
  const bash = result?.result
  if (bash?.backgroundTaskId != null || bash?.interrupted === true) return
  if (result?.isError === true && !ranToCompletion(result)) return
  const succeeded = result?.isError !== true

  // Worktree removal was pre-resolved before next(e): the worktree no longer exists.
  if (removal !== null) {
    const target = autoStep(removal.current.step, { worktreeRemoved: succeeded })
    if (target === null) return
    await saveAuto($, closuresRedirect($, removal.worktree, removal.mainWorktree), removal.current, target, command)
    return
  }

  const io = closures($)
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
  await saveAuto($, io, current, target, command)
}

// A command that ran and exited non-zero reads `Exit code N`; a denied or rejected one never ran, and a Bash
// timeout (143) cut it short: neither says anything about the tests.
function ranToCompletion(result: any): boolean {
  const text = String(result.text ?? result.result ?? '')
  return /^(Error: )?Exit code \d+/.test(text) && !text.includes('Command timed out')
}

/** Resolves and loads the issue of `path` before its worktree is removed; null when it is not tracked. */
async function loadRemoval($: any, options: any, path: string): Promise<any> {
  const io = closures($)
  const tracked = await resolveIssue(io, path, String(options.branchPattern))
  if (tracked === null) return null
  const current = await loadIssue(io, tracked.worktree, tracked.issue)
  if (current === null || current === 'unreadable') return null
  const git = await io.process.run(['git', 'worktree', 'list', '--porcelain'],
    { cwd: tracked.worktree, timeoutMs: 1000 })
  if (git.exitCode !== 0) return null
  return { current, worktree: tracked.worktree, mainWorktree: git.stdout.split('\n')[0].slice('worktree '.length) }
}

async function saveAuto($: any, io: any, current: any, target: string, command: string): Promise<void> {
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

// The worktree `git worktree remove` targets (run as a command, like PR_PATTERN), i.e. its first non-flag argument.
// shortcut: <path> has no spaces; upgrade when quoted or escaped paths must be handled.
function worktreeRemovePath(command: string): string | null {
  const match = /(?:^|[;&|]\s*)git worktree remove\b(.*)/.exec(command)
  if (match === null) return null
  const path = match[1].trim().split(/\s+/).find((arg) => arg.length > 0 && !arg.startsWith('-'))
  return path ?? null
}

// The removed worktree is gone, yet the store derives the project by running git there; redirect that
// one call to the main worktree, noted before removal: the session cwd may be the removed worktree itself.
function closuresRedirect($: any, removedWorktree: string, mainWorktree: string) {
  const io = closures($)
  const run = io.process.run
  return {
    ...io,
    process: {
      run: (argv: string[], init: any) =>
        run(argv, init && init.cwd === removedWorktree ? { ...init, cwd: mainWorktree } : init),
    },
  }
}
