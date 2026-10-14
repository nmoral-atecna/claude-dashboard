import { test, expect } from 'claude-code/testing'

const NOW = 1791892800000
const NOW_ISO = '2026-10-13T12:00:00.000Z'
const FILE = '/home/t/.claude/control-tower/repo/142.json'

// Answers every $ call the Bash observer makes; the bottom tool.call returns the Bash result.
function engine(on: any, opts: { branch?: string; files?: Record<string, string>; result?: any; cwd?: string } = {}): any[] {
  const { branch = 'feat/142-tva', files = {}, result = ok(), cwd = '/src/repo' } = opts
  const calls: any[] = []
  on('session.cwd', async () => {
    calls.push({ kind: 'session.cwd' })
    return { value: cwd }
  })
  on('process.run', async ($b: any, e: any) => {
    calls.push({ kind: 'run', e })
    const [cmd, arg, target] = e.argv
    if (cmd === 'mv') {
      files[target] = files[arg]
      delete files[arg]
    }
    if (cmd === 'rm') delete files[target]
    const stdout = arg === 'branch' ? `${branch}\n` : arg === 'worktree' ? 'worktree /src/repo\n' : '/src/repo\n'
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('env.get', async ($b: any, e: any) => ({ value: e.name === 'HOME' ? '/home/t' : undefined }))
  on('clock.now', async () => ({ value: NOW }))
  on('fs.exists', async ($b: any, e: any) => ({ value: e.path in files }))
  on('fs.read', async ($b: any, e: any) => ({ value: files[e.path] }))
  on('fs.write', async ($b: any, e: any) => {
    calls.push({ kind: 'write', e })
    files[e.path] = e.text
    return { value: undefined }
  })
  on('ui.log', async ($b: any, e: any) => {
    calls.push({ kind: 'log', e })
    return { value: undefined }
  })
  on('tool.call', async ($b: any, e: any) => {
    calls.push({ kind: 'core tool.call', e })
    return result
  })
  return calls
}

const ok = (record: any = {}) => ({ result: { stdout: '', stderr: '', interrupted: false, ...record } })
const failed = () => ({ isError: true, result: 'tests failed' })
const of = (calls: any[], kind: string) => calls.filter((c) => c.kind === kind)

function record(step: string, extra: any = {}): any {
  return {
    issue: 142,
    title: null,
    step,
    blockedReason: null,
    branch: 'feat/142-tva',
    worktree: '/src/repo',
    history: [],
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...extra,
  }
}
const disk = (step: string, extra: any = {}) => ({ [FILE]: JSON.stringify(record(step, extra)) })
const bash = ($: any, command: string) => $.tool.call({ tool: 'Bash', command })

test('C1.1 recognized-tests-pass-at-tests-valides-moves-to-vert', async ($: any, on: any) => {
  const files = disk('tests-valides')
  engine(on, { files })
  await bash($, 'vendor/bin/phpunit')
  const saved = JSON.parse(files[FILE])
  expect(saved.step).toBe('vert')
  expect(saved.history).toEqual([{ step: 'vert', at: NOW_ISO, source: 'auto', note: 'vendor/bin/phpunit' }])
  expect(saved.blockedReason).toBeNull()
})

test('C1.4 note-is-truncated-to-200-characters', async ($: any, on: any) => {
  const files = disk('tests-valides')
  engine(on, { files })
  const command = 'phpunit ' + 'x'.repeat(242)
  expect(command.length).toBe(250)
  await bash($, command)
  const saved = JSON.parse(files[FILE])
  expect(saved.step).toBe('vert')
  expect(saved.history[0].note).toBe(command.slice(0, 200))
  expect(saved.history[0].note.length).toBe(200)
})

test('C2.1 recognized-tests-fail-beyond-vert-goes-back', async ($: any, on: any) => {
  const files = disk('refacto')
  engine(on, { files, result: failed() })
  await bash($, 'make test')
  const saved = JSON.parse(files[FILE])
  expect(saved.step).toBe('tests-valides')
  expect(saved.history).toEqual([{ step: 'tests-valides', at: NOW_ISO, source: 'auto', note: 'make test' }])
})

test('C5.1 cd-prefix-resolves-from-that-path', async ($: any, on: any) => {
  const files = disk('tests-valides')
  const calls = engine(on, { files, cwd: '/main/repo' })
  await bash($, 'cd /w/ct-99 && make test')
  expect(JSON.parse(files[FILE]).step).toBe('vert')
  const resolveCwds = of(calls, 'run')
    .filter((c) => ['branch', 'rev-parse'].includes(c.e.argv[1]))
    .map((c) => c.e.init.cwd)
  expect(resolveCwds).toEqual(['/w/ct-99', '/w/ct-99'])
  expect(of(calls, 'session.cwd')).toHaveLength(0)
})

test('C5.2 background-command-is-ignored', async ($: any, on: any) => {
  const files = disk('tests-valides')
  const before = files[FILE]
  const calls = engine(on, { files, result: ok({ backgroundTaskId: 'bg-1' }) })
  await bash($, 'vendor/bin/phpunit')
  expect(files[FILE]).toBe(before)
  expect(of(calls, 'write')).toHaveLength(0)
  expect(of(calls, 'run')).toHaveLength(0)
})

test('C5.3 interrupted-command-is-ignored', async ($: any, on: any) => {
  const files = disk('refacto')
  const before = files[FILE]
  const calls = engine(on, { files, result: ok({ interrupted: true }) })
  await bash($, 'vendor/bin/phpunit')
  expect(files[FILE]).toBe(before)
  expect(of(calls, 'run')).toHaveLength(0)
})

test('C5.4 untracked-branch-changes-nothing', async ($: any, on: any) => {
  const files = disk('vert')
  const before = files[FILE]
  const calls = engine(on, { branch: 'main', files, result: failed() })
  await bash($, 'vendor/bin/phpunit')
  expect(files[FILE]).toBe(before)
  expect(of(calls, 'write')).toHaveLength(0)
  expect(of(calls, 'log')).toHaveLength(0)
})

test('C5.5 missing-issue-file-is-not-created', async ($: any, on: any) => {
  const files: Record<string, string> = {}
  const calls = engine(on, { files })
  await bash($, 'vendor/bin/phpunit')
  expect(files).toEqual({})
  expect(of(calls, 'write')).toHaveLength(0)
  expect(of(calls, 'log')).toHaveLength(0)
})

test('C5.6 unreadable-issue-only-logs-read-failed', async ($: any, on: any) => {
  const files = { [FILE]: '{oops' }
  const calls = engine(on, { files })
  await bash($, 'vendor/bin/phpunit')
  expect(files).toEqual({ [FILE]: '{oops' })
  expect(of(calls, 'write')).toHaveLength(0)
  const logs = of(calls, 'log')
  expect(logs).toHaveLength(1)
  expect(logs[0].e.text.includes('read failed')).toBe(true)
})

test('C5.7 blocked-issue-advances-and-keeps-reason', async ($: any, on: any) => {
  const files = disk('tests-valides', { blockedReason: 'arrondi TVA' })
  engine(on, { files })
  await bash($, 'vendor/bin/phpunit')
  const saved = JSON.parse(files[FILE])
  expect(saved.step).toBe('vert')
  expect(saved.blockedReason).toBe('arrondi TVA')
})

test('C5.8 bash-result-is-returned-unchanged', async ($: any, on: any) => {
  const files = disk('tests-valides')
  const result = ok()
  engine(on, { files, result })
  expect(await bash($, 'vendor/bin/phpunit')).toEqual(result)
})

test('C6.1 docker-compose-exec-phpunit-is-recognized', async ($: any, on: any) => {
  const files = disk('tests-valides')
  engine(on, { files })
  await bash($, 'docker compose exec app vendor/bin/phpunit')
  expect(JSON.parse(files[FILE]).step).toBe('vert')
})

test('C6.2 custom-pattern-matches-only-itself', { options: { testPattern: '\\bnpm test\\b' } }, async ($: any, on: any) => {
  const files = disk('tests-valides')
  engine(on, { files })
  await bash($, 'npm test')
  expect(JSON.parse(files[FILE]).step).toBe('vert')
  await bash($, 'vendor/bin/phpunit')
  expect(JSON.parse(files[FILE]).step).toBe('vert')
})

test('C6.3 invalid-pattern-disables-tests-rule-and-logs', { options: { testPattern: '(' } }, async ($: any, on: any) => {
  const files = disk('tests-valides')
  const before = files[FILE]
  const calls = engine(on, { files })
  await bash($, 'vendor/bin/phpunit')
  expect(files[FILE]).toBe(before)
  expect(of(calls, 'write')).toHaveLength(0)
  expect(of(calls, 'run')).toHaveLength(0)
  const logs = of(calls, 'log')
  expect(logs).toHaveLength(1)
  expect(logs[0].e.text.startsWith('control-tower: invalid testPattern (: ')).toBe(true)
  expect(logs[0].e.to).toBe('transcript')
})

test('C3.1 gh-pr-create-at-doc-moves-to-mr', async ($: any, on: any) => {
  const files = disk('doc')
  engine(on, { files })
  await bash($, 'gh pr create --fill')
  const saved = JSON.parse(files[FILE])
  expect(saved.step).toBe('mr')
  expect(saved.history).toEqual([{ step: 'mr', at: NOW_ISO, source: 'auto', note: 'gh pr create --fill' }])
})

test('C3.2 glab-mr-create-jumps-from-tests-valides-to-mr', async ($: any, on: any) => {
  const files = disk('tests-valides')
  engine(on, { files })
  await bash($, 'glab mr create --yes')
  expect(JSON.parse(files[FILE]).step).toBe('mr')
})

test('C3.3 failed-pr-create-stays', async ($: any, on: any) => {
  const files = disk('doc')
  const before = files[FILE]
  engine(on, { files, result: failed() })
  await bash($, 'gh pr create')
  expect(files[FILE]).toBe(before)
})

test('C3.4 pr-create-at-ci-does-not-go-back', async ($: any, on: any) => {
  const files = disk('ci')
  const before = files[FILE]
  engine(on, { files })
  await bash($, 'gh pr create')
  expect(files[FILE]).toBe(before)
})

test('C3 neutralized-gh-still-matches-the-text', async ($: any, on: any) => {
  const files = disk('doc')
  engine(on, { files })
  await bash($, 'gh() { :; }; gh pr create --fill')
  expect(JSON.parse(files[FILE]).step).toBe('mr')
})

test('C5.9 most-advanced-rule-wins-pr-over-tests', async ($: any, on: any) => {
  const files = disk('doc')
  engine(on, { files })
  await bash($, 'make test && gh pr create')
  const saved = JSON.parse(files[FILE])
  expect(saved.step).toBe('mr')
  expect(saved.history).toEqual([{ step: 'mr', at: NOW_ISO, source: 'auto', note: 'make test && gh pr create' }])
})

test('C7.1 unrecognized-command-touches-nothing', async ($: any, on: any) => {
  const files = disk('tests-valides')
  const before = files[FILE]
  const calls = engine(on, { files })
  await bash($, 'ls -la')
  expect(files[FILE]).toBe(before)
  expect(of(calls, 'run')).toHaveLength(0)
  expect(of(calls, 'write')).toHaveLength(0)
  expect(of(calls, 'log')).toHaveLength(0)
})
