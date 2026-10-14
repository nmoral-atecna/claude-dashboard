# claude-dashboard

## Git conventions

- Issue branches: `feat/<issue>-<slug>` (or `fix/`, `chore/`), matching the mod's default `branchPattern`.
- Integration: rebase the issue branch onto `origin/main` (no merge of `main` into the branch).
- Pull requests are merged with a merge commit (no squash, no rebase), to keep the TDD commits.

## Checks

See [README.md](README.md#checks); all commands run from the repository root.
