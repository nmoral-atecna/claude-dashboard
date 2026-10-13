import type { IssueRecord } from 'claude-code'

/** Writes the record atomically to its JSON file, then mirrors it in $.state. Never rejects. */
export async function saveIssue($: any, record: IssueRecord): Promise<void> {
  let label = `${record.worktree}/${record.issue}`
  try {
    const git = await run($, ['git', 'worktree', 'list', '--porcelain'], { cwd: record.worktree })
    if (git.exitCode !== 0) return logFailure($, label, git.stderr)

    const mainWorktree = git.stdout.split('\n')[0].slice('worktree '.length)
    const project = mainWorktree.slice(mainWorktree.lastIndexOf('/') + 1)
    label = `${project}/${record.issue}`
    const path = `${await $.env.get('HOME')}/.claude/control-tower/${project}/${record.issue}.json`
    const tmp = `${path}.tmp-${crypto.randomUUID()}`
    const saved = { ...record, updatedAt: new Date(await $.clock.now()).toISOString() }

    await $.fs.write(tmp, JSON.stringify(saved, null, 2))
    const mv = await run($, ['mv', tmp, path])
    if (mv.exitCode !== 0) {
      logFailure($, label, mv.stderr)
      await run($, ['rm', '-f', tmp])
      return
    }
    await $.state.set({ plugin: 'control-tower', key: 'issues', id: String(record.issue) }, saved)
  } catch (error: any) {
    logFailure($, label, error.message)
  }
}

// A rejected mv must still trigger the temp cleanup, so process.run rejections become failed exits.
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
