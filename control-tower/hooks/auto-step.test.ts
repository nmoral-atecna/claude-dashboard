import { test, expect } from 'claude-code/testing'
import { autoStep } from './auto-step'

test('C1.1 tests-pass-at-tests-valides-moves-to-vert', async () => {
  expect(autoStep('tests-valides', { testsPassed: true })).toBe('vert')
})

test('C1.2 tests-pass-too-early-stays', async () => {
  expect(autoStep('tests-ecrits', { testsPassed: true })).toBeNull()
})

test('C1.3 tests-pass-already-beyond-stays', async () => {
  expect(autoStep('refacto', { testsPassed: true })).toBeNull()
})

test('C2.1 tests-fail-beyond-vert-goes-back-to-tests-valides', async () => {
  expect(autoStep('refacto', { testsPassed: false })).toBe('tests-valides')
})

test('C2.2 tests-fail-before-vert-stays', async () => {
  expect(autoStep('tests-ecrits', { testsPassed: false })).toBeNull()
})

test('C2.3 tests-fail-at-vert-goes-back-to-tests-valides', async () => {
  expect(autoStep('vert', { testsPassed: false })).toBe('tests-valides')
})

test('C2.4 tests-fail-when-done-stays', async () => {
  expect(autoStep('termine', { testsPassed: false })).toBeNull()
})

test('no-signal-yields-no-target', async () => {
  expect(autoStep('vert', {})).toBeNull()
})
