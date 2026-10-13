import type { IssueRecord, Step } from 'claude-code'

export const STEPS: Step[] = ['spec', 'tests-ecrits', 'tests-valides', 'vert', 'refacto', 'doc', 'mr', 'ci', 'termine']

type StepRequest = { step: Step; note?: string; title?: string }
type TrackedIssue = { issue: number; branch: string; worktree: string }

/**
 * The record after Claude asks for a step, or the refusal to answer.
 * A missing record stands before `spec`; any step up to one past the current one is accepted.
 */
export function applyStep(
  current: IssueRecord | null,
  request: StepRequest,
  tracked: TrackedIssue,
  at: string,
): { record: IssueRecord } | { refusal: string } {
  const next = (current ? STEPS.indexOf(current.step) : -1) + 1
  if (STEPS.indexOf(request.step) > next) {
    return { refusal: `Missing intermediate step: \`${STEPS[next]}\`. Move to \`${STEPS[next]}\` first.` }
  }
  const base = current
    ?? { ...tracked, title: null, step: request.step, blockedReason: null, history: [], updatedAt: '' }
  return {
    record: {
      ...base,
      step: request.step,
      title: base.title ?? request.title ?? null,
      history: [...base.history, { step: request.step, at, source: 'claude', note: request.note ?? null }],
    },
  }
}
