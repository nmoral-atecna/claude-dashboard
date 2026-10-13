import { test, expect } from 'claude-code/testing'
import { loadIssue, saveIssue } from './issue-store'

const NOW = 1791892800000
const NOW_ISO = '2026-10-13T12:00:00.000Z'
const DIR = '/home/t/.claude/control-tower/claude-dashboard'

function record(issue = 2, worktree = '/src/feat-2'): any {
  return {
    issue,
    title: null,
    step: 'spec',
    blockedReason: null,
    branch: 'feat/2-store',
    worktree,
    history: [],
    updatedAt: '',
  }
}

// Hand-written $: the testing $ exposes neither fs, process, env, state nor clock.
function fake(options: any = {}): { $: any; calls: any[] } {
  const calls: any[] = []
  const ok = { exitCode: 0, stdout: '', stderr: '' }
  const $: any = {
    env: {
      get: async (name: string) => {
        if (options.envError) throw options.envError
        if (name !== 'HOME') return undefined
        return 'home' in options ? options.home : '/home/t'
      },
    },
    clock: { now: async () => NOW },
    fs: {
      exists: async (path: string) => {
        calls.push({ kind: 'exists', path })
        return path in (options.files ?? {})
      },
      read: async (path: string) => {
        calls.push({ kind: 'read', path })
        if (!(path in (options.files ?? {}))) {
          throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' })
        }
        return options.files[path]
      },
      write: async (path: string, text: string) => {
        calls.push({ kind: 'write', path, text })
        if (options.yieldOnWrite) await Promise.resolve()
        if (options.writeError) throw options.writeError
      },
    },
    process: {
      run: async (argv: string[], init: any) => {
        calls.push({ kind: 'run', argv, init })
        if (argv[0] === 'git') {
          if (options.gitError) throw options.gitError
          return options.git ?? {
            ...ok,
            stdout: 'worktree /src/claude-dashboard\nHEAD abc\nbranch refs/heads/main\n\n'
              + 'worktree /src/feat-2\nHEAD def\nbranch refs/heads/feat/2-store\n',
          }
        }
        if (argv[0] === 'mv') return options.mv ?? ok
        return ok
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

const of = (calls: any[], kind: string) => calls.filter((c) => c.kind === kind)
const runs = (calls: any[], cmd: string) => of(calls, 'run').filter((c) => c.argv[0] === cmd)
const gitFails = { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository\n' }
const mvFails = { exitCode: 1, stdout: '', stderr: 'mv: cannot move\n' }

test('T1 save-writes-temp-then-moves', async () => {
  const { $, calls } = fake()
  await saveIssue($, record())
  const writes = of(calls, 'write')
  expect(writes).toHaveLength(1)
  const tmp = writes[0].path
  expect(tmp.startsWith(`${DIR}/2.json.tmp-`)).toBe(true)
  expect(JSON.parse(writes[0].text)).toEqual({ ...record(), updatedAt: NOW_ISO })
  const mv = runs(calls, 'mv')
  expect(mv).toHaveLength(1)
  expect(mv[0].argv).toEqual(['mv', tmp, `${DIR}/2.json`])
  expect(calls.indexOf(writes[0])).toBeLessThan(calls.indexOf(mv[0]))
})

test('T2 save-derives-project-from-main-worktree', async () => {
  const { $, calls } = fake({
    git: {
      exitCode: 0,
      stderr: '',
      stdout: 'worktree /elsewhere/my-repo\nHEAD abc\nbranch refs/heads/main\n\n'
        + 'worktree /src/feat-2\nHEAD def\nbranch refs/heads/feat/2-store\n',
    },
  })
  await saveIssue($, record())
  const git = runs(calls, 'git')
  expect(git).toHaveLength(1)
  expect(git[0].argv).toEqual(['git', 'worktree', 'list', '--porcelain'])
  expect(git[0].init.cwd).toBe('/src/feat-2')
  expect(runs(calls, 'mv')[0].argv[2]).toBe('/home/t/.claude/control-tower/my-repo/2.json')
})

test('T3 save-mirrors-record-in-state', async () => {
  const { $, calls } = fake()
  await saveIssue($, record())
  const sets = of(calls, 'state.set')
  expect(sets).toHaveLength(1)
  expect(sets[0].ref).toEqual({ plugin: 'control-tower', key: 'issues', id: '2' })
  expect(sets[0].value).toEqual({ ...record(), updatedAt: NOW_ISO })
  expect(sets[0].value).toEqual(JSON.parse(of(calls, 'write')[0].text))
  expect(calls.indexOf(runs(calls, 'mv')[0])).toBeLessThan(calls.indexOf(sets[0]))
})

test('T4a save-logs-when-git-fails', async () => {
  const { $, calls } = fake({ git: gitFails })
  await saveIssue($, record())
  const logs = of(calls, 'log')
  expect(logs).toHaveLength(1)
  expect(logs[0].text).toBe('control-tower: save failed /src/feat-2/2: fatal: not a git repository')
  expect(logs[0].opts).toEqual({ to: 'transcript' })
  expect(of(calls, 'write')).toHaveLength(0)
  expect(runs(calls, 'mv')).toHaveLength(0)
  expect(of(calls, 'state.set')).toHaveLength(0)
})

test('T4b save-logs-when-write-fails', async () => {
  const { $, calls } = fake({ writeError: new Error('EACCES: permission denied') })
  await saveIssue($, record())
  const logs = of(calls, 'log')
  expect(logs).toHaveLength(1)
  expect(logs[0].text).toBe('control-tower: save failed claude-dashboard/2: EACCES: permission denied')
  expect(logs[0].opts).toEqual({ to: 'transcript' })
  expect(runs(calls, 'mv')).toHaveLength(0)
  expect(of(calls, 'state.set')).toHaveLength(0)
})

test('T4c save-logs-and-removes-temp-when-mv-fails', async () => {
  const { $, calls } = fake({ mv: mvFails })
  await saveIssue($, record())
  const logs = of(calls, 'log')
  expect(logs).toHaveLength(1)
  expect(logs[0].text).toBe('control-tower: save failed claude-dashboard/2: mv: cannot move')
  expect(logs[0].opts).toEqual({ to: 'transcript' })
  const rm = runs(calls, 'rm')
  expect(rm).toHaveLength(1)
  expect(rm[0].argv).toEqual(['rm', '-f', of(calls, 'write')[0].path])
  expect(of(calls, 'state.set')).toHaveLength(0)
})

test('T4d save-logs-when-process-run-rejects', async () => {
  const { $, calls } = fake({ gitError: new Error('timed out') })
  await saveIssue($, record())
  const logs = of(calls, 'log')
  expect(logs).toHaveLength(1)
  expect(logs[0].text).toBe('control-tower: save failed /src/feat-2/2: timed out')
  expect(logs[0].opts).toEqual({ to: 'transcript' })
  expect(of(calls, 'write')).toHaveLength(0)
  expect(of(calls, 'state.set')).toHaveLength(0)
})

test('T4e save-logs-when-env-get-rejects', async () => {
  const { $, calls } = fake({ envError: new Error('env unavailable') })
  await saveIssue($, record())
  const logs = of(calls, 'log')
  expect(logs).toHaveLength(1)
  expect(logs[0].text).toBe('control-tower: save failed claude-dashboard/2: env unavailable')
  expect(logs[0].opts).toEqual({ to: 'transcript' })
  expect(of(calls, 'write')).toHaveLength(0)
  expect(of(calls, 'state.set')).toHaveLength(0)
})

test('T4f save-logs-when-home-unset', async () => {
  const { $, calls } = fake({ home: undefined })
  await saveIssue($, record())
  const logs = of(calls, 'log')
  expect(logs).toHaveLength(1)
  expect(logs[0].text).toBe('control-tower: save failed claude-dashboard/2: HOME is not set')
  expect(logs[0].opts).toEqual({ to: 'transcript' })
  expect(of(calls, 'write')).toHaveLength(0)
  expect(runs(calls, 'mv')).toHaveLength(0)
  expect(of(calls, 'state.set')).toHaveLength(0)
})

test('T4g save-logs-when-home-empty', async () => {
  const { $, calls } = fake({ home: '' })
  await saveIssue($, record())
  const logs = of(calls, 'log')
  expect(logs).toHaveLength(1)
  expect(logs[0].text).toBe('control-tower: save failed claude-dashboard/2: HOME is not set')
  expect(logs[0].opts).toEqual({ to: 'transcript' })
  expect(of(calls, 'write')).toHaveLength(0)
  expect(runs(calls, 'mv')).toHaveLength(0)
  expect(of(calls, 'state.set')).toHaveLength(0)
})

test('T5 parallel-saves-use-distinct-files', async () => {
  const { $, calls } = fake({ yieldOnWrite: true })
  await Promise.all([saveIssue($, record(2, '/src/feat-2')), saveIssue($, record(3, '/src/feat-3'))])
  const writes = of(calls, 'write')
  expect(writes).toHaveLength(2)
  expect(writes[0].path === writes[1].path).toBe(false)
  for (const issue of [2, 3]) {
    const mv = runs(calls, 'mv').find((c) => c.argv[2] === `${DIR}/${issue}.json`)
    expect(mv).toBeDefined()
    const moved = writes.find((w) => w.path === mv.argv[1])
    expect(JSON.parse(moved.text).issue).toBe(issue)
  }
})

test('T6 every-process-run-has-short-timeout', async () => {
  const scenarios = [
    [{}, ['git', 'mv'], saveIssue],
    [{ mv: mvFails }, ['git', 'mv', 'rm'], saveIssue],
    [{}, ['git'], loadIssue],
  ] as const
  for (const [options, expected, action] of scenarios) {
    const { $, calls } = fake(options)
    if (action === loadIssue) await loadIssue($, '/src/feat-2', 2)
    else await saveIssue($, record())
    expect(of(calls, 'run').map((c) => c.argv[0])).toEqual(expected)
    for (const run of of(calls, 'run')) {
      expect(run.init.timeoutMs).toBeDefined()
      expect(run.init.timeoutMs).toBeLessThanOrEqual(1000)
    }
  }
})

test('T7a load-returns-record', async () => {
  const { $, calls } = fake({ files: { [`${DIR}/2.json`]: JSON.stringify(record()) } })
  expect(await loadIssue($, '/src/feat-2', 2)).toEqual(record())
  expect(of(calls, 'log')).toHaveLength(0)
  expect(of(calls, 'state.set')).toHaveLength(0)
})

test('T7b load-returns-null-when-missing', async () => {
  const { $, calls } = fake()
  expect(await loadIssue($, '/src/feat-2', 2)).toBeNull()
  expect(of(calls, 'log')).toHaveLength(0)
  expect(of(calls, 'state.set')).toHaveLength(0)
})

test('T7c load-logs-when-json-invalid', async () => {
  const { $, calls } = fake({ files: { [`${DIR}/2.json`]: '{not json' } })
  let parseMessage = ''
  try {
    JSON.parse('{not json')
  } catch (error: any) {
    parseMessage = error.message
  }
  expect(await loadIssue($, '/src/feat-2', 2)).toBeNull()
  const logs = of(calls, 'log')
  expect(logs).toHaveLength(1)
  expect(logs[0].text.startsWith('control-tower: read failed claude-dashboard/2: ')).toBe(true)
  expect(logs[0].text).toContain(parseMessage)
  expect(logs[0].opts).toEqual({ to: 'transcript' })
  expect(of(calls, 'state.set')).toHaveLength(0)
})

test('T7d load-logs-when-git-fails', async () => {
  const { $, calls } = fake({ git: gitFails })
  expect(await loadIssue($, '/src/feat-2', 2)).toBeNull()
  const logs = of(calls, 'log')
  expect(logs).toHaveLength(1)
  expect(logs[0].text).toBe('control-tower: read failed /src/feat-2/2: fatal: not a git repository')
  expect(logs[0].opts).toEqual({ to: 'transcript' })
  expect(of(calls, 'read')).toHaveLength(0)
  expect(of(calls, 'state.set')).toHaveLength(0)
})

test('T7e load-logs-when-home-unset', async () => {
  const { $, calls } = fake({ home: undefined })
  expect(await loadIssue($, '/src/feat-2', 2)).toBeNull()
  const logs = of(calls, 'log')
  expect(logs).toHaveLength(1)
  expect(logs[0].text).toBe('control-tower: read failed claude-dashboard/2: HOME is not set')
  expect(logs[0].opts).toEqual({ to: 'transcript' })
  expect(of(calls, 'exists')).toHaveLength(0)
  expect(of(calls, 'read')).toHaveLength(0)
  expect(of(calls, 'state.set')).toHaveLength(0)
})

test('T7f load-logs-when-home-empty', async () => {
  const { $, calls } = fake({ home: '' })
  expect(await loadIssue($, '/src/feat-2', 2)).toBeNull()
  const logs = of(calls, 'log')
  expect(logs).toHaveLength(1)
  expect(logs[0].text).toBe('control-tower: read failed claude-dashboard/2: HOME is not set')
  expect(logs[0].opts).toEqual({ to: 'transcript' })
  expect(of(calls, 'exists')).toHaveLength(0)
  expect(of(calls, 'read')).toHaveLength(0)
  expect(of(calls, 'state.set')).toHaveLength(0)
})
