import type { IssueRecord, Step } from 'claude-code'

export const STEPS: Step[] = ['spec', 'tests-ecrits', 'tests-valides', 'vert', 'refacto', 'doc', 'mr', 'ci', 'termine']
export const REQUESTED_STEPS = [...STEPS, 'bloque']
export const NOTE_MAX_LENGTH = 200

/** The refusal for an input the schema forbids, or null when it is valid. */
export function invalidRequest(input: { step?: unknown; note?: unknown; blockedReason?: unknown }): string | null {
  if (!REQUESTED_STEPS.includes(input.step as string)) {
    return `Invalid step \`${input.step}\`. Expected one of: ${REQUESTED_STEPS.map((s) => `\`${s}\``).join(', ')}.`
  }
  if (typeof input.note === 'string' && input.note.length > NOTE_MAX_LENGTH) {
    return `\`note\` must be at most ${NOTE_MAX_LENGTH} characters.`
  }
  if (input.step === 'bloque' && !input.blockedReason) {
    return '`blockedReason` is required when step is `bloque`.'
  }
  return null
}

type StepRequest = { step: Step | 'bloque'; note?: string; title?: string; blockedReason?: string }
type TrackedIssue = { issue: number; branch: string; worktree: string }

/**
 * The record after Claude asks for a step, or the refusal to answer.
 * A missing record stands before `spec`; any step up to one past the current one is accepted.
 * `bloque` keeps the step and sets `blockedReason`; any real step clears it.
 */
export function applyStep(
  current: IssueRecord | null,
  request: StepRequest,
  tracked: TrackedIssue,
  at: string,
): { record: IssueRecord } | { refusal: string } {
  const next = (current ? STEPS.indexOf(current.step) : -1) + 1
  if (STEPS.indexOf(request.step as Step) > next || (request.step === 'bloque' && current === null)) {
    return { refusal: `Missing intermediate step: \`${STEPS[next]}\`. Move to \`${STEPS[next]}\` first.` }
  }
  if (request.step === 'bloque') {
    const blockedReason = request.blockedReason as string
    return {
      record: {
        ...current!,
        blockedReason,
        history: [...current!.history, { step: current!.step, at, source: 'claude', note: blockedReason }],
      },
    }
  }
  const step = request.step
  const base = current ?? { ...tracked, title: null, step, blockedReason: null, history: [], updatedAt: '' }
  const note = !base.blockedReason
    ? request.note ?? null
    : ['unblocked', request.note].filter(Boolean).join('; ')
  return {
    record: {
      ...base,
      step,
      blockedReason: null,
      title: base.title ?? request.title ?? null,
      history: [...base.history, { step, at, source: 'claude', note }],
    },
  }
}
