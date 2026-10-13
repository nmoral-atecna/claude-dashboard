import type { IssueRecord } from 'claude-code'

/** Writes the record atomically to its JSON file, then mirrors it in $.state. Never rejects. */
export async function saveIssue($: any, record: IssueRecord): Promise<void> {
  const git = await run($, ['git', 'worktree', 'list', '--porcelain'], { cwd: record.worktree })
  if (git.exitCode !== 0) return logFailure($, `${record.worktree}/${record.issue}`, git.stderr)

  const mainWorktree = git.stdout.split('\n')[0].slice('worktree '.length)
  const project = mainWorktree.slice(mainWorktree.lastIndexOf('/') + 1)
  const label = `${project}/${record.issue}`
  const path = `${await $.env.get('HOME')}/.claude/control-tower/${project}/${record.issue}.json`
  const tmp = `${path}.tmp-${crypto.randomUUID()}`
  const saved = { ...record, updatedAt: new Date(await $.clock.now()).toISOString() }

  try {
    await $.fs.write(tmp, JSON.stringify(saved, null, 2))
  } catch (error: any) {
    return logFailure($, label, error.message)
  }
  const mv = await run($, ['mv', tmp, path])
  if (mv.exitCode !== 0) {
    logFailure($, label, mv.stderr)
    await run($, ['rm', '-f', tmp])
    return
  }
  await $.state.set({ plugin: 'control-tower', key: 'issues', id: String(record.issue) }, saved)
}

// process.run rejects on timeout or when the command cannot start: report it as a failed exit.
async function run($: any, argv: string[], init: { cwd?: string } = {}): Promise<any> {
  try {
    return await $.process.run(argv, { ...init, timeoutMs: 1000 })
  } catch (error: any) {
    return { exitCode: 1, stdout: '', stderr: error.message }
  }
}

function logFailure($: any, label: string, message: string): void {
  $.ui.log(`control-tower: save failed ${label}: ${message.trimEnd()}`, { to: 'transcript' })
}
