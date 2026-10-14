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

test('C3.1 pr-created-before-mr-moves-to-mr', async () => {
  expect(autoStep('doc', { prCreated: true })).toBe('mr')
})

test('C3.2 pr-created-jumps-from-tests-valides-to-mr', async () => {
  expect(autoStep('tests-valides', { prCreated: true })).toBe('mr')
})

test('C3.3 pr-create-failed-stays', async () => {
  expect(autoStep('doc', { prCreated: false })).toBeNull()
})

test('C3.4 pr-created-at-ci-does-not-go-back', async () => {
  expect(autoStep('ci', { prCreated: true })).toBeNull()
})

test('pr-created-at-mr-stays', async () => {
  expect(autoStep('mr', { prCreated: true })).toBeNull()
})

test('C5.9 pr-rule-wins-over-tests-rule', async () => {
  expect(autoStep('tests-valides', { testsPassed: true, prCreated: true })).toBe('mr')
})
