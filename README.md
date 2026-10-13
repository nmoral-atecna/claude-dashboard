# control-tower

Claude Code mod providing a control tower dashboard for Claude Code sessions.
The mod lives in `control-tower/`.

## Development

Always develop against the working copy, never against the installed copy:

```sh
claude --plugin-dir ./control-tower
```

## Checks

Run from the repository root:

```sh
claude plugin validate --strict control-tower
scripts/check-calls.sh control-tower
claude plugin test control-tower
```

`scripts/check-calls.sh` fails when the mod calls `$` outside
`fs`, `process`, `clock`, `ui`, `tool` and `state`.
