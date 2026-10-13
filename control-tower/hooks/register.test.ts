import { test, expect } from 'claude-code/testing'

const TOOL = 'mcp__control-tower__set_issue_step'
const NO_ISSUE = 'No issue tracked on this branch. Do not retry; ask the user to switch to an issue branch.'
const STEPS = ['spec', 'tests-ecrits', 'tests-valides', 'vert', 'refacto', 'doc', 'mr', 'ci', 'termine', 'bloque']

const NOW = 1791892800000
const NOW_ISO = '2026-10-13T12:00:00.000Z'
const FILE = '/home/t/.claude/control-tower/repo/142.json'

// Answers every $ call the plugin makes; the test's hooks are the bottom of the chain.
// `files` is the in-memory disk, mutated by fs.write, mv and rm.
function engine(on: any, branch: string, files: Record<string, string> = {}, mvFails = false): any[] {
  const calls: any[] = []
  on('session.start', async ($b: any, e: any) => {
    calls.push({ kind: 'session.start', e })
    return { cwd: e.cwd }
  })
  on('tool.register', async ($b: any, e: any) => {
    calls.push({ kind: 'tool.register', e })
    return { value: { tool: `mcp__control-tower__${e.name}` } }
  })
  on('session.cwd', async () => ({ value: '/src/repo' }))
  on('process.run', async ($b: any, e: any) => {
    calls.push({ kind: 'run', e })
    const [cmd, arg, target] = e.argv
    if (cmd === 'mv') {
      if (mvFails) return { value: { exitCode: 1, stdout: '', stderr: 'mv: cannot move\n' } }
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
  on('ui.log', async ($b: any, e: any) => {
    calls.push({ kind: 'log', e })
    return { value: undefined }
  })
  on('fs.write', async ($b: any, e: any) => {
    calls.push({ kind: 'write', e })
    files[e.path] = e.text
    return { value: undefined }
  })
  on('tool.check', async ($b: any, e: any) => {
    calls.push({ kind: 'tool.check', e })
    return { decision: 'ask' }
  })
  on('tool.call', async ($b: any, e: any) => {
    calls.push({ kind: 'core tool.call', e })
    return { result: 'core' }
  })
  return calls
}

const of = (calls: any[], kind: string) => calls.filter((c) => c.kind === kind)

test('session.start passes the event through unchanged', async ($: any, on: any) => {
  const calls = engine(on, 'main')
  const result = await $.session.start({ cwd: '/work/project' })
  const starts = of(calls, 'session.start')
  expect(starts).toHaveLength(1)
  expect(starts[0].e).toEqual({ cwd: '/work/project' })
  expect(result).toEqual({ cwd: '/work/project' })
})

test('C1.1 session-start-registers-set-issue-step', async ($: any, on: any) => {
  const calls = engine(on, 'feat/142-tva')
  await $.session.start({ cwd: '/src/repo' })
  const registers = of(calls, 'tool.register')
  expect(registers).toHaveLength(1)
  expect(registers[0].e).toEqual({
    name: 'set_issue_step',
    description: expect.any(String),
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        step: { type: 'string', enum: STEPS, description: expect.any(String) },
        note: { type: 'string', maxLength: 200, description: expect.any(String) },
        title: { type: 'string', description: expect.any(String) },
        blockedReason: { type: 'string', description: expect.any(String) },
      },
      required: ['step'],
    },
  })
})

test('C2.1 untracked-branch-answers-no-issue-and-writes-nothing', async ($: any, on: any) => {
  const calls = engine(on, 'main')
  await $.session.start({ cwd: '/src/repo' })
  const answer = await $.tool.call({ tool: TOOL, step: 'spec' })
  expect(answer.result).toBe(NO_ISSUE)
  expect(of(calls, 'write')).toHaveLength(0)
  expect(of(calls, 'log')).toHaveLength(0)
  expect(of(calls, 'run').map((c) => c.e.init.cwd)).toEqual(['/src/repo', '/src/repo'])
})

test('C2.2 invalid-branch-pattern-answers-no-issue', { options: { branchPattern: '(' } }, async ($: any, on: any) => {
  const calls = engine(on, 'feat/142-tva')
  await $.session.start({ cwd: '/src/repo' })
  const answer = await $.tool.call({ tool: TOOL, step: 'spec' })
  expect(answer.result).toBe(NO_ISSUE)
  expect(of(calls, 'write')).toHaveLength(0)
  const logs = of(calls, 'log')
  expect(logs).toHaveLength(1)
  expect(logs[0].e.text.startsWith('control-tower: invalid branchPattern (: ')).toBe(true)
  expect(logs[0].e.to).toBe('transcript')
})

test('C8.1 call-is-answered-without-permission-check', async ($: any, on: any) => {
  const calls = engine(on, 'main')
  await $.session.start({ cwd: '/src/repo' })
  await $.tool.call({ tool: TOOL, step: 'spec' })
  expect(of(calls, 'tool.check')).toHaveLength(0)
  expect(of(calls, 'core tool.call')).toHaveLength(0)
})

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

const entry = (step: string, note: string | null = null) => ({ step, at: NOW_ISO, source: 'claude', note })
const disk = (step: string, extra: any = {}) => ({ [FILE]: JSON.stringify(record(step, extra)) })

async function call($: any, input: any): Promise<string> {
  await $.session.start({ cwd: '/src/repo' })
  return (await $.tool.call({ tool: TOOL, ...input })).result
}

test('C3.1 spec-creates-issue', async ($: any, on: any) => {
  const files: Record<string, string> = {}
  const calls = engine(on, 'feat/142-tva', files)
  expect(await call($, { step: 'spec', title: 'Calcul TVA' })).toBe('Issue 142 moved to `spec`.')
  expect(JSON.parse(files[FILE])).toEqual(record('spec', {
    title: 'Calcul TVA',
    history: [entry('spec')],
    updatedAt: NOW_ISO,
  }))
  expect(of(calls, 'tool.check')).toHaveLength(0)
  expect(of(calls, 'core tool.call')).toHaveLength(0)
})

test('C3.2 creation-outside-spec-is-refused', async ($: any, on: any) => {
  const files: Record<string, string> = {}
  const calls = engine(on, 'feat/142-tva', files)
  expect(await call($, { step: 'vert' })).toBe('Missing intermediate step: `spec`. Move to `spec` first.')
  expect(files).toEqual({})
  expect(of(calls, 'write')).toHaveLength(0)
})

test('C3.3 one-step-forward-is-accepted', async ($: any, on: any) => {
  const files = disk('tests-ecrits')
  engine(on, 'feat/142-tva', files)
  expect(await call($, { step: 'tests-valides' })).toBe('Issue 142 moved to `tests-valides`.')
  expect(JSON.parse(files[FILE]).step).toBe('tests-valides')
  expect(JSON.parse(files[FILE]).history).toEqual([entry('tests-valides')])
})

test('C3.4 jump-is-refused-naming-first-missing-step', async ($: any, on: any) => {
  const files = disk('tests-ecrits')
  const before = files[FILE]
  const calls = engine(on, 'feat/142-tva', files)
  expect(await call($, { step: 'refacto' }))
    .toBe('Missing intermediate step: `tests-valides`. Move to `tests-valides` first.')
  expect(files).toEqual({ [FILE]: before })
  expect(of(calls, 'write')).toHaveLength(0)
})

test('C3.5 going-back-is-accepted-and-only-recorded-in-history', async ($: any, on: any) => {
  const files = disk('refacto', { history: [entry('refacto')] })
  const calls = engine(on, 'feat/142-tva', files)
  expect(await call($, { step: 'tests-ecrits' })).toBe('Issue 142 moved to `tests-ecrits`.')
  const saved = JSON.parse(files[FILE])
  expect(saved.step).toBe('tests-ecrits')
  expect(saved.history).toEqual([entry('refacto'), entry('tests-ecrits')])
  expect(of(calls, 'log')).toHaveLength(0)
})

test('C3.6 same-step-is-accepted-with-new-entry', async ($: any, on: any) => {
  const files = disk('vert', { history: [entry('vert')] })
  engine(on, 'feat/142-tva', files)
  expect(await call($, { step: 'vert', note: 'rerun' })).toBe('Issue 142 moved to `vert`.')
  const saved = JSON.parse(files[FILE])
  expect(saved.step).toBe('vert')
  expect(saved.history).toEqual([entry('vert'), entry('vert', 'rerun')])
})

test('C4.1 existing-title-is-kept', async ($: any, on: any) => {
  const files = disk('spec', { title: 'A' })
  engine(on, 'feat/142-tva', files)
  expect(await call($, { step: 'tests-ecrits', title: 'B' })).toBe('Issue 142 moved to `tests-ecrits`.')
  expect(JSON.parse(files[FILE]).title).toBe('A')
})

test('C4.2 missing-title-is-set', async ($: any, on: any) => {
  const files = disk('spec')
  engine(on, 'feat/142-tva', files)
  expect(await call($, { step: 'spec', title: 'B' })).toBe('Issue 142 moved to `spec`.')
  expect(JSON.parse(files[FILE]).title).toBe('B')
})

test('C7.1 failed-save-answers-failure', async ($: any, on: any) => {
  const files = disk('spec')
  const before = files[FILE]
  engine(on, 'feat/142-tva', files, true)
  expect(await call($, { step: 'tests-ecrits' })).toBe('Failed to save issue 142; see the transcript.')
  expect(files[FILE]).toBe(before)
})

const INVALID_DONE = 'Invalid step `done`. Expected one of: `spec`, `tests-ecrits`, `tests-valides`, `vert`, '
  + '`refacto`, `doc`, `mr`, `ci`, `termine`, `bloque`.'

test('C6.1 step-outside-enum-is-refused', async ($: any, on: any) => {
  const files = disk('spec')
  const before = files[FILE]
  const calls = engine(on, 'feat/142-tva', files)
  expect(await call($, { step: 'done' })).toBe(INVALID_DONE)
  expect(files).toEqual({ [FILE]: before })
  expect(of(calls, 'write')).toHaveLength(0)
})

test('C6.1 step-outside-enum-is-refused-before-branch-check', async ($: any, on: any) => {
  const calls = engine(on, 'main')
  expect(await call($, { step: 'done' })).toBe(INVALID_DONE)
  expect(of(calls, 'run')).toHaveLength(0)
})

test('C6.2 note-over-200-characters-is-refused', async ($: any, on: any) => {
  const files = disk('spec')
  const before = files[FILE]
  const calls = engine(on, 'feat/142-tva', files)
  expect(await call($, { step: 'tests-ecrits', note: 'x'.repeat(201) })).toBe('`note` must be at most 200 characters.')
  expect(files).toEqual({ [FILE]: before })
  expect(of(calls, 'write')).toHaveLength(0)
})

test('C6.2 note-of-200-characters-is-accepted', async ($: any, on: any) => {
  const files = disk('spec')
  engine(on, 'feat/142-tva', files)
  expect(await call($, { step: 'tests-ecrits', note: 'x'.repeat(200) })).toBe('Issue 142 moved to `tests-ecrits`.')
})

test('C5.1 bloque-sets-blocked-reason-and-keeps-step', async ($: any, on: any) => {
  const files = disk('vert', { history: [entry('vert')] })
  engine(on, 'feat/142-tva', files)
  expect(await call($, { step: 'bloque', blockedReason: 'waiting API', note: 'ignored' }))
    .toBe('Issue 142 blocked: waiting API.')
  const saved = JSON.parse(files[FILE])
  expect(saved.step).toBe('vert')
  expect(saved.blockedReason).toBe('waiting API')
  expect(saved.history).toEqual([entry('vert'), entry('vert', 'waiting API')])
})

test('C5.2 real-step-unblocks', async ($: any, on: any) => {
  const files = disk('vert', { blockedReason: 'waiting API' })
  engine(on, 'feat/142-tva', files)
  expect(await call($, { step: 'refacto' })).toBe('Issue 142 moved to `refacto`.')
  const saved = JSON.parse(files[FILE])
  expect(saved.blockedReason).toBeNull()
  expect(saved.step).toBe('refacto')
  expect(saved.history).toEqual([entry('refacto', 'unblocked')])
})

test('C5.2 real-step-unblocks-with-note', async ($: any, on: any) => {
  const files = disk('vert', { blockedReason: 'waiting API' })
  engine(on, 'feat/142-tva', files)
  expect(await call($, { step: 'refacto', note: 'API ready' })).toBe('Issue 142 moved to `refacto`.')
  const saved = JSON.parse(files[FILE])
  expect(saved.blockedReason).toBeNull()
  expect(saved.history).toEqual([entry('refacto', 'unblocked; API ready')])
})

test('C5.3 bloque-without-file-is-refused', async ($: any, on: any) => {
  const files: Record<string, string> = {}
  const calls = engine(on, 'feat/142-tva', files)
  expect(await call($, { step: 'bloque', blockedReason: 'x' }))
    .toBe('Missing intermediate step: `spec`. Move to `spec` first.')
  expect(files).toEqual({})
  expect(of(calls, 'write')).toHaveLength(0)
})

test('C5.4 blocked-reason-is-ignored-outside-bloque', async ($: any, on: any) => {
  const files = disk('vert')
  engine(on, 'feat/142-tva', files)
  expect(await call($, { step: 'refacto', blockedReason: 'x' })).toBe('Issue 142 moved to `refacto`.')
  const saved = JSON.parse(files[FILE])
  expect(saved.blockedReason).toBeNull()
  expect(saved.step).toBe('refacto')
  expect(saved.history).toEqual([entry('refacto')])
})

test('C6.3 bloque-without-blocked-reason-is-refused', async ($: any, on: any) => {
  const files = disk('spec')
  const before = files[FILE]
  const calls = engine(on, 'feat/142-tva', files)
  expect(await call($, { step: 'bloque' })).toBe('`blockedReason` is required when step is `bloque`.')
  expect(files).toEqual({ [FILE]: before })
  expect(of(calls, 'write')).toHaveLength(0)
})
