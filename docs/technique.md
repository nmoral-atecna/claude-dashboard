# control-tower — technical documentation

Complements [README.md](../README.md), which holds the store, the
`set_issue_step` tool, the automatic transitions and the checks.

## `/dash` dashboard

### Modules

- `control-tower/hooks/dashboard.ts`: pure rules, no `$` call.
  - `toRow(record, orphan, now)`: `DashboardRow` (`issue`, `label` = title or
    branch, `step`, `marks` = `blocked` then `orphan`, `note`, `ageMs`, `age`).
  - `composeRows(issueIds, issues, orphans, now)`: drops ids without an
    `issues` entry and hidden `termine` records (`TERMINE_MAX_AGE_MS`, 168 h),
    then sorts: blocked first, `STEPS` order, oldest first, issue number.
  - `renderDashboard(rows, bodyColumns)`: header `ISSUE TITLE STEP NOTE AGE`
    plus one line per row; each column padded to its widest cell (header
    included), `"  "` separator, AGE not padded. When the total exceeds
    `bodyColumns`, ISSUE/STEP/AGE keep their width and the rest is split
    evenly between TITLE and NOTE (odd column to NOTE), cut with `…`. No rows:
    `[EMPTY_MESSAGE]` (`No tracked issue.`).
  - `orphanIssues(porcelain, issueIds, issues)`: ids not `termine` whose
    `worktree` is absent from the `worktree <path>` lines of
    `git worktree list --porcelain`; empty set when `porcelain` is `null`
    (git failed).
  - `formatAge(ms)`: one floored unit, `m` under 1 h, `h` under 1 d, else `d`.
  - Age: time since the first entry of the last consecutive run of `history`
    entries on the current step (`Date.parse(at)`), `updatedAt` when that run
    is empty.
- `control-tower/hooks/dashboard-pane.tsx`: engine side.
  - `declareDashCommand($)`: `$.command.register({ name: 'dash', … })`.
  - `registerDashboard(on)`: hooks `command.run{command=dash}` (toggle through
    `$.ui.panes` / `$.ui.open` / `$.ui.close`, pane id `dash`), `ui.close`
    (stops the refresh for pane `dash`, whatever the origin, then `next(e)`),
    and `ui.render{component=Pane, requestId=dash}` (Box/Text from
    `$.ui.resolve`, width from `e.props.bodyColumns`, time from
    `$.clock.now()`).
  - `resumeDashboard($)`: restarts the refresh when `$.ui.panes()` lists `dash`.
- `control-tower/hooks/register.ts`: calls `registerDashboard(on)`; its single
  `session.start` hook registers `set_issue_step`, then calls
  `declareDashCommand` and `resumeDashboard`.

### Refresh flow

1. Opening (`/dash`) or resuming (`session.start` with the pane listed) calls
   `startTick`: cancels any previous timer, runs one refresh at once, then
   `$.clock.every(60_000, …)`. One timer per session (module variable).
2. A refresh: `$.session.cwd()`, `reloadIssues($, cwd)` (records from disk into
   `issueIds`/`issues`), `git worktree list --porcelain` through
   `$.process.run` (`timeoutMs: 1000`, non-zero exit or rejection gives
   `null`, nothing logged), `orphanIssues`, then
   `$.state.set` of `control-tower.dashboardOrphans`.
3. The render only reads `$.state` (`issueIds`, `issues`,
   `dashboardOrphans`) and calls `composeRows` + `renderDashboard`.
4. `ui.close` on pane `dash` (toggle or the person's Escape) cancels the timer.

`git worktree list` therefore runs twice per refresh: once inside
`reloadIssues` (project name) and once for the orphans.

### State

`control-tower.dashboardOrphans: number[]`, declared in
`control-tower/types/index.d.ts`, written by the refresh and read by the render.

### Decisions

- Orphans are computed by the refresh and stored in `$.state` because the
  render hook cannot write.
- The refresh reloads the records from disk before computing orphans, so the
  pane reflects other sessions with at most 60 s delay.
- At `session.start` the refresh resumes only for a pane still open; a closed
  pane is never reopened.
- UI texts (header, marks, answers, units) are in English, consistent with the
  rest of the mod.
- `command` was added to the nouns allowed by `scripts/check-calls.sh`:
  serving `/dash` requires `$.command.register`.

### Tests and limits

- `dashboard.test.ts` (pure rules), `dashboard-pane.test.ts` (command and
  render, terminal and desktop surfaces), `dashboard-tick.test.ts` (refresh
  with `mock.clock`).
- The test `$` does not provide `$.ui.close`, so a close with origin `person`
  (Escape) cannot be produced by the engine kit. The C6.5 test goes through
  the `/dash` toggle, which triggers the same origin-agnostic `ui.close` hook;
  closing with Escape is verified manually.
- The rendering in the desktop Code tab is only covered by the test on the
  `desktop` surface, not checked visually.
