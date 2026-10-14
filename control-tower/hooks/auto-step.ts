import type { Step } from 'claude-code'
import { STEPS } from './issue-step'

// Each signal is set only when the command matches its rule; its boolean is whether the command succeeded.
// A later milestone adds `worktreeRemoved`.
export type AutoSignals = { testsPassed?: boolean; prCreated?: boolean }

/**
 * The step a mechanical rule moves the issue to, or null when none applies.
 * Pure and extensible: each rule contributes a candidate and the most advanced one wins.
 * The target order encodes the rule priority (worktree remove > PR/MR > tests).
 */
export function autoStep(step: Step, signals: AutoSignals): Step | null {
  const candidates: Step[] = []
  if (signals.testsPassed !== undefined) {
    const target = testsTarget(step, signals.testsPassed)
    if (target !== null) candidates.push(target)
  }
  if (signals.prCreated !== undefined) {
    const target = prTarget(step, signals.prCreated)
    if (target !== null) candidates.push(target)
  }
  return candidates.reduce<Step | null>(
    (best, candidate) => (best === null || STEPS.indexOf(candidate) > STEPS.indexOf(best) ? candidate : best),
    null,
  )
}

/** Tests passing move `tests-valides` to `vert`; tests failing pull `vert`..`ci` back to `tests-valides`. */
function testsTarget(step: Step, passed: boolean): Step | null {
  if (passed) {
    return step === 'tests-valides' ? 'vert' : null
  }
  const beyondVert = STEPS.indexOf(step) >= STEPS.indexOf('vert') && step !== 'termine'
  return beyondVert ? 'tests-valides' : null
}

/** A successful PR/MR creation moves any step before `mr` to `mr`; never a step back. */
function prTarget(step: Step, succeeded: boolean): Step | null {
  if (!succeeded) return null
  return STEPS.indexOf(step) < STEPS.indexOf('mr') ? 'mr' : null
}
