import { test, expect } from 'claude-code/testing'

test('session.start passes the event through unchanged', async ($: any, on: any) => {
  let seen: any
  on('session.start', ($b: any, e: any) => {
    seen = e
    return { cwd: e.cwd }
  })
  const result = await $.session.start({ cwd: '/work/project' })
  expect(seen).toEqual({ cwd: '/work/project' })
  expect(result).toEqual({ cwd: '/work/project' })
})
