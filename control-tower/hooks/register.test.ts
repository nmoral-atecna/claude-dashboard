import { test, expect } from 'claude-code/testing'

const TOOL = 'mcp__control-tower__set_issue_step'
const NO_ISSUE = 'No issue tracked on this branch. Do not retry; ask the user to switch to an issue branch.'
const STEPS = ['spec', 'tests-ecrits', 'tests-valides', 'vert', 'refacto', 'doc', 'mr', 'ci', 'termine', 'bloque']

// Answers every $ call the plugin makes; the test's hooks are the bottom of the chain.
function engine(on: any, branch: string): any[] {
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
    const stdout = e.argv[1] === 'branch' ? `${branch}\n` : '/src/repo\n'
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('ui.log', async ($b: any, e: any) => {
    calls.push({ kind: 'log', e })
    return { value: undefined }
  })
  on('fs.write', async ($b: any, e: any) => {
    calls.push({ kind: 'write', e })
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
