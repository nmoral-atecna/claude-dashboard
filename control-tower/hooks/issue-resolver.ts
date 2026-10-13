/** Reads the issue number from the current branch; null when not tracked. Never rejects. */
export async function resolveIssue(
  $: any,
  cwd: string,
  pattern: string,
): Promise<{ issue: number; branch: string; worktree: string } | null> {
  let regex: RegExp
  try {
    regex = new RegExp(pattern)
  } catch (error: any) {
    logInvalid($, pattern, error.message)
    return null
  }
  try {
    const [branch, worktree] = await Promise.all([
      git($, cwd, ['branch', '--show-current']),
      git($, cwd, ['rev-parse', '--show-toplevel']),
    ])
    if (!branch || worktree === null) return null
    const match = regex.exec(branch)
    if (!match) return null
    if (!/^\d+$/.test(match[1] ?? '')) {
      logInvalid($, pattern, 'capture group 1 is not an issue number')
      return null
    }
    return { issue: Number(match[1]), branch, worktree }
  } catch {
    return null
  }
}

async function git($: any, cwd: string, args: string[]): Promise<string | null> {
  const result = await $.process.run(['git', ...args], { cwd, timeoutMs: 1000 })
  return result.exitCode === 0 ? result.stdout.replace(/\n$/, '') : null
}

function logInvalid($: any, pattern: string, reason: string): void {
  $.ui.log(`control-tower: invalid branchPattern ${pattern}: ${reason}`, { to: 'transcript' })
}
