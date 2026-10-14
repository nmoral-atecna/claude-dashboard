import { test, expect } from 'claude-code/testing'

const DIR = '/home/t/.claude/control-tower/demo'
const CWD = '/src/demo'

type Disk = { files?: Record<string, string>; noDir?: boolean; listError?: string; outsideRepo?: boolean }

// Answers every $ call the reload makes; `state` is the in-memory $.state, keyed `issues/<n>` or `issueIds`.
function engine(on: any, disk: Disk, state: Record<string, any> = {}, result: any = {}): any[] {
  const calls: any[] = []
  const files = disk.files ?? {}
  on('process.run', async ($b: any, e: any) => {
    calls.push({ kind: 'run', e })
    if (disk.outsideRepo) return { value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository\n' } }
    return { value: { exitCode: 0, stdout: `worktree ${CWD}\nHEAD abc\nbranch refs/heads/main\n`, stderr: '' } }
  })
  on('env.get', async ($b: any, e: any) => ({ value: e.name === 'HOME' ? '/home/t' : undefined }))
  on('fs.exists', async ($b: any, e: any) => ({ value: e.path === DIR ? !disk.noDir : e.path in files }))
  on('fs.list', async ($b: any, e: any) => {
    calls.push({ kind: 'list', e })
    if (disk.listError) return { deny: disk.listError }
    return { value: Object.keys(files).map((path) => ({ name: path.slice(DIR.length + 1), kind: 'file' })) }
  })
  on('fs.read', async ($b: any, e: any) => ({ value: files[e.path] }))
  on('state.set', async ($b: any, e: any) => {
    calls.push({ kind: 'state.set', e })
    state[e.id === undefined ? e.key : `${e.key}/${e.id}`] = e.value
    return { value: { isSet: true, version: 1 } }
  })
  on('ui.log', async ($b: any, e: any) => {
    calls.push({ kind: 'log', e })
    return { value: undefined }
  })
  on('classic.SessionStart', async () => result)
  return calls
}

const of = (calls: any[], kind: string) => calls.filter((c) => c.kind === kind)
const record = (issue: number, step: string) => ({ issue, step, title: null, blockedReason: null, history: [] })
const file = (issue: number, step: string) => ({ [`${DIR}/${issue}.json`]: JSON.stringify(record(issue, step)) })
const start = ($: any, source = 'startup') => $.classic.SessionStart({ source, cwd: CWD })

test('C1.1 startup-loads-every-record-and-sorted-ids', async ($: any, on: any) => {
  const state: Record<string, any> = {}
  const calls = engine(on, { files: { ...file(12, 'spec'), ...file(7, 'vert') } }, state)
  await start($)
  expect(state['issues/7']).toEqual(record(7, 'vert'))
  expect(state['issues/12']).toEqual(record(12, 'spec'))
  expect(state.issueIds).toEqual([7, 12])
  expect(of(calls, 'run')[0].e.init.cwd).toBe(CWD)
  expect(of(calls, 'log')).toHaveLength(0)
})

for (const source of ['resume', 'clear', 'compact', 'fork']) {
  test(`C1.2 ${source}-reloads-like-startup`, async ($: any, on: any) => {
    const state: Record<string, any> = {}
    engine(on, { files: { ...file(7, 'vert'), ...file(12, 'spec') } }, state)
    await start($, source)
    expect(state['issues/7']).toEqual(record(7, 'vert'))
    expect(state['issues/12']).toEqual(record(12, 'spec'))
    expect(state.issueIds).toEqual([7, 12])
  })
}

test('C1.3 reload-refreshes-a-stale-record', async ($: any, on: any) => {
  const state: Record<string, any> = { 'issues/7': record(7, 'spec'), issueIds: [7] }
  engine(on, { files: file(7, 'vert') }, state)
  await start($, 'clear')
  expect(state['issues/7']).toEqual(record(7, 'vert'))
})

test('C2.1 missing-directory-gives-empty-ids-without-log', async ($: any, on: any) => {
  const state: Record<string, any> = {}
  const calls = engine(on, { noDir: true }, state)
  await start($)
  expect(state).toEqual({ issueIds: [] })
  expect(of(calls, 'log')).toHaveLength(0)
})

test('C2.2 outside-git-repo-writes-nothing-without-log', async ($: any, on: any) => {
  const state: Record<string, any> = {}
  const calls = engine(on, { outsideRepo: true, files: file(7, 'vert') }, state)
  await start($)
  expect(of(calls, 'state.set')).toHaveLength(0)
  expect(of(calls, 'log')).toHaveLength(0)
})

test('C2.3 unreadable-record-is-skipped-and-logged-once', async ($: any, on: any) => {
  const state: Record<string, any> = { 'issues/12': record(12, 'spec') }
  const calls = engine(on, { files: { ...file(7, 'vert'), [`${DIR}/12.json`]: '{oops' } }, state)
  await start($)
  expect(state.issueIds).toEqual([7])
  expect(state['issues/7']).toEqual(record(7, 'vert'))
  expect(state['issues/12']).toEqual(record(12, 'spec'))
  const logs = of(calls, 'log')
  expect(logs).toHaveLength(1)
  expect(logs[0].e.text.startsWith('control-tower: read failed demo/12: ')).toBe(true)
  expect(logs[0].e.to).toBe('transcript')
})

test('C2.4 only-integer-json-files-are-records', async ($: any, on: any) => {
  const state: Record<string, any> = {}
  const calls = engine(on, {
    files: {
      ...file(7, 'vert'),
      [`${DIR}/7.json.tmp-1a2b`]: '{}',
      [`${DIR}/notes.txt`]: 'notes',
      [`${DIR}/abc.json`]: '{}',
    },
  }, state)
  await start($)
  expect(state).toEqual({ 'issues/7': record(7, 'vert'), issueIds: [7] })
  expect(of(calls, 'log')).toHaveLength(0)
})

test('C2.5 vanished-record-leaves-ids-but-keeps-state', async ($: any, on: any) => {
  const state: Record<string, any> = { issueIds: [7, 12], 'issues/12': record(12, 'spec') }
  engine(on, { files: file(7, 'vert') }, state)
  await start($)
  expect(state.issueIds).toEqual([7])
  expect(state['issues/12']).toEqual(record(12, 'spec'))
})

test('C4.1 session-start-result-is-untouched', async ($: any, on: any) => {
  const result = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'x' } }
  engine(on, { files: file(7, 'vert') }, {}, result)
  expect(await start($)).toEqual(result)
})

test('C4.2 directory-error-writes-nothing-logs-and-starts', async ($: any, on: any) => {
  const result = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'x' } }
  const calls = engine(on, { files: file(7, 'vert'), listError: 'EACCES: permission denied' }, {}, result)
  expect(await start($)).toEqual(result)
  expect(of(calls, 'state.set')).toHaveLength(0)
  const logs = of(calls, 'log')
  expect(logs).toHaveLength(1)
  // <error> is the message the engine raises for the denied $.fs.list.
  expect(logs[0].e.text).toBe('control-tower: reload failed demo: control-tower: $.fs.list: EACCES: permission denied')
  expect(logs[0].e.to).toBe('transcript')
})
