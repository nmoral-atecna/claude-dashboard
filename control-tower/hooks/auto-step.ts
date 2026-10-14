import type { Step } from 'claude-code'
import { STEPS } from './issue-step'

/** Signals a watched Bash command raised; later milestones add PR/MR and worktree removal. */
export type AutoSignals = { testsPassed?: boolean }

/**
 * The step a mechanical rule moves the issue to, or null when none applies.
 * Pure and extensible: each rule contributes a candidate and the most advanced one wins.
 */
export function autoStep(step: Step, signals: AutoSignals): Step | null {
  const candidates: Step[] = []
  if (signals.testsPassed !== undefined) {
    const target = testsTarget(step, signals.testsPassed)
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
