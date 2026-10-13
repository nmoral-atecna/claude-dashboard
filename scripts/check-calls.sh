#!/usr/bin/env bash
# Fails when a mod calls a $ noun outside the allowed list (validate does not refuse them).
set -euo pipefail

if [ "$#" -ne 1 ]; then
    echo "usage: $0 <mod-dir>" >&2
    exit 2
fi

forbidden="$(claude plugin validate --json "$1" | jq -r '
    .contents[].notes[]?
    | select(test(" calls: "))
    | sub("^.* calls: "; "")
    | select(. != "nothing on $")
    | split(", ")[]
    | select(split(".")[1] as $noun
        | ["fs", "process", "clock", "ui", "tool", "state"] | index($noun) | not)
')"

if [ -n "$forbidden" ]; then
    echo "forbidden \$ calls (allowed: fs, process, clock, ui, tool, state):"
    echo "$forbidden"
    exit 1
fi
