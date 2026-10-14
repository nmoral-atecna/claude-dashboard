import type { IssueRecord } from 'claude-code'

/** Writes the record atomically to its JSON file, then mirrors it in $.state. Never rejects; false on failure. */
export async function saveIssue($: any, record: IssueRecord): Promise<boolean> {
  let label = `${record.worktree}/${record.issue}`
  try {
    const project = await projectOf($, record.worktree)
    label = `${project}/${record.issue}`
    const path = await issuePath($, project, record.issue)
    const tmp = `${path}.tmp-${crypto.randomUUID()}`
    const saved = { ...record, updatedAt: new Date(await $.clock.now()).toISOString() }

    // The store dir exists (tmp was just written there), unlike the session cwd, which may be a removed worktree.
    const store = { cwd: path.slice(0, path.lastIndexOf('/')) }

    await $.fs.write(tmp, JSON.stringify(saved, null, 2))
    const mv = await run($, ['mv', tmp, path], store)
    if (mv.exitCode !== 0) {
      logFailure($, 'save', label, mv.stderr)
      await run($, ['rm', '-f', tmp], store)
      return false
    }
    await $.state.set({ plugin: 'control-tower', key: 'issues', id: String(record.issue) }, saved)
    return true
  } catch (error: any) {
    logFailure($, 'save', label, error.message)
    return false
  }
}

/** Reads the record from its JSON file; null when missing, 'unreadable' (logged) otherwise. Never rejects. */
export async function loadIssue(
  $: any,
  worktree: string,
  issue: number,
): Promise<IssueRecord | null | 'unreadable'> {
  let label = `${worktree}/${issue}`
  try {
    const project = await projectOf($, worktree)
    label = `${project}/${issue}`
    const path = await issuePath($, project, issue)
    if (!(await $.fs.exists(path))) return null
    return JSON.parse(await $.fs.read(path))
  } catch (error: any) {
    logFailure($, 'read', label, error.message)
    return 'unreadable'
  }
}

/** Basename of the main worktree, i.e. the first `worktree` line of `git worktree list --porcelain`. */
async function projectOf($: any, worktree: string): Promise<string> {
  const git = await run($, ['git', 'worktree', 'list', '--porcelain'], { cwd: worktree })
  if (git.exitCode !== 0) throw new Error(git.stderr)
  const mainWorktree = git.stdout.split('\n')[0].slice('worktree '.length)
  return mainWorktree.slice(mainWorktree.lastIndexOf('/') + 1)
}

async function issuePath($: any, project: string, issue: number): Promise<string> {
  const home = await $.env.get('HOME')
  if (!home) throw new Error('HOME is not set')
  return `${home}/.claude/control-tower/${project}/${issue}.json`
}

// A rejected mv must still trigger the temp cleanup, so process.run rejections become failed exits.
async function run($: any, argv: string[], init: { cwd?: string } = {}): Promise<any> {
  try {
    return await $.process.run(argv, { ...init, timeoutMs: 1000 })
  } catch (error: any) {
    return { exitCode: 1, stdout: '', stderr: error.message }
  }
}

function logFailure($: any, action: 'save' | 'read', label: string, message: string): void {
  $.ui.log(`control-tower: ${action} failed ${label}: ${message.trimEnd()}`, { to: 'transcript' })
}
