import { test, expect } from 'claude-code/testing'
import { resolveIssue } from './issue-resolver'

const DEFAULT = '^(?:feat|fix|chore)/(\\d+)-'

// Hand-written $: the testing $ exposes no process.
function fake(options: any = {}): { $: any; calls: any[] } {
  const calls: any[] = []
  const $: any = {
    process: {
      run: async (argv: string[], init: any) => {
        calls.push({ kind: 'run', argv, init })
        if (options.runError) throw options.runError
        if (argv[1] === 'branch') return options.branch
        if (argv[1] === 'rev-parse') return options.toplevel
        throw new Error(`unexpected command: ${argv.join(' ')}`)
      },
    },
    state: {
      set: async (ref: any, value: any) => {
        calls.push({ kind: 'state.set', ref, value })
        return { isSet: true, version: 1 }
      },
    },
    ui: { log: (text: string, opts: any) => calls.push({ kind: 'log', text, opts }) },
  }
  return { $, calls }
}

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })
const gitFails = { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' }
const of = (calls: any[], kind: string) => calls.filter((c) => c.kind === kind)

test('T1 resolve-returns-issue-from-branch', async () => {
  const { $, calls } = fake({ branch: ok('feat/142-tva\n'), toplevel: ok('/src/feat-142\n') })
  expect(await resolveIssue($, '/src/feat-142/sub', DEFAULT))
    .toEqual({ issue: 142, branch: 'feat/142-tva', worktree: '/src/feat-142' })
  expect(of(calls, 'log')).toHaveLength(0)
  expect(of(calls, 'state.set')).toHaveLength(0)
})

test('T1b resolve-converts-leading-zeros', async () => {
  const { $ } = fake({ branch: ok('feat/007-x\n'), toplevel: ok('/src/feat-7\n') })
  expect(await resolveIssue($, '/src/feat-7', DEFAULT))
    .toEqual({ issue: 7, branch: 'feat/007-x', worktree: '/src/feat-7' })
})

test('T2a resolve-returns-null-on-unmatched-branch', async () => {
  const { $, calls } = fake({ branch: ok('main\n'), toplevel: ok('/src/claude-dashboard\n') })
  expect(await resolveIssue($, '/src/claude-dashboard', DEFAULT)).toBeNull()
  expect(of(calls, 'log')).toHaveLength(0)
})

test('T2b resolve-returns-null-on-detached-head', async () => {
  const { $, calls } = fake({ branch: ok('\n'), toplevel: ok('/src/feat-142\n') })
  expect(await resolveIssue($, '/src/feat-142', DEFAULT)).toBeNull()
  expect(of(calls, 'log')).toHaveLength(0)
})

test('T3 every-git-call-runs-in-cwd-with-short-timeout', async () => {
  const { $, calls } = fake({ branch: ok('feat/142-tva\n'), toplevel: ok('/src/feat-142\n') })
  await resolveIssue($, '/src/feat-142/sub', DEFAULT)
  const runs = of(calls, 'run')
  expect(runs).toHaveLength(2)
  expect(runs.map((r) => r.argv.join(' ')).sort())
    .toEqual(['git branch --show-current', 'git rev-parse --show-toplevel'])
  for (const run of runs) {
    expect(run.init.cwd).toBe('/src/feat-142/sub')
    expect(run.init.timeoutMs).toBeDefined()
    expect(run.init.timeoutMs).toBeLessThanOrEqual(1000)
  }
})

test('T4a resolve-returns-null-outside-repo', async () => {
  const { $, calls } = fake({ branch: gitFails, toplevel: gitFails })
  expect(await resolveIssue($, '/tmp/x', DEFAULT)).toBeNull()
  expect(of(calls, 'log')).toHaveLength(0)
})

test('T4b resolve-returns-null-when-toplevel-fails', async () => {
  const { $, calls } = fake({ branch: ok('feat/142-tva\n'), toplevel: gitFails })
  expect(await resolveIssue($, '/tmp/x', DEFAULT)).toBeNull()
  expect(of(calls, 'log')).toHaveLength(0)
})

test('T4c resolve-returns-null-when-process-run-rejects', async () => {
  const { $, calls } = fake({ runError: new Error('timed out') })
  expect(await resolveIssue($, '/tmp/x', DEFAULT)).toBeNull()
  expect(of(calls, 'log')).toHaveLength(0)
})

test('T5 resolve-logs-when-pattern-does-not-compile', async () => {
  const { $, calls } = fake({ branch: ok('feat/142-tva\n'), toplevel: ok('/src/feat-142\n') })
  let message = ''
  try {
    new RegExp('^feat/(\\d+')
  } catch (error: any) {
    message = error.message
  }
  expect(await resolveIssue($, '/src/feat-142', '^feat/(\\d+')).toBeNull()
  const logs = of(calls, 'log')
  expect(logs).toHaveLength(1)
  expect(logs[0].text).toBe(`control-tower: invalid branchPattern ^feat/(\\d+: ${message}`)
  expect(logs[0].opts).toEqual({ to: 'transcript' })
  expect(of(calls, 'run')).toHaveLength(0)
})

test('T6a resolve-logs-when-pattern-has-no-group', async () => {
  const { $, calls } = fake({ branch: ok('feat/142-tva\n'), toplevel: ok('/src/feat-142\n') })
  expect(await resolveIssue($, '/src/feat-142', '^feat/')).toBeNull()
  const logs = of(calls, 'log')
  expect(logs).toHaveLength(1)
  expect(logs[0].text).toBe('control-tower: invalid branchPattern ^feat/: capture group 1 is not an issue number')
  expect(logs[0].opts).toEqual({ to: 'transcript' })
})

test('T6b resolve-logs-when-group-is-not-numeric', async () => {
  const { $, calls } = fake({ branch: ok('feat/142-tva\n'), toplevel: ok('/src/feat-142\n') })
  expect(await resolveIssue($, '/src/feat-142', '^(\\w+)/')).toBeNull()
  const logs = of(calls, 'log')
  expect(logs).toHaveLength(1)
  expect(logs[0].text).toBe('control-tower: invalid branchPattern ^(\\w+)/: capture group 1 is not an issue number')
  expect(logs[0].opts).toEqual({ to: 'transcript' })
})
