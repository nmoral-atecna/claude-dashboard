declare module 'claude-code' {
  type Step =
    | 'spec'
    | 'tests-ecrits'
    | 'tests-valides'
    | 'vert'
    | 'refacto'
    | 'doc'
    | 'mr'
    | 'ci'
    | 'termine'

  type HistorySource = 'claude' | 'auto' | 'manuel'

  type HistoryEntry = {
    step: Step
    /** ISO 8601 */
    at: string
    source: HistorySource
    note: string | null
  }

  /** An issue is blocked when blockedReason is not null; step is kept. */
  type IssueRecord = {
    issue: number
    title: string | null
    step: Step
    blockedReason: string | null
    branch: string
    /** Absolute path */
    worktree: string
    history: HistoryEntry[]
    /** ISO 8601 UTC, set by the store */
    updatedAt: string
  }

  interface PluginState {
    'control-tower': {
      issues: StateFamily<IssueRecord>
      /** Issue numbers of the session project's records, sorted ascending */
      issueIds: number[]
    }
  }
}
