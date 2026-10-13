#!/usr/bin/env bash
# T2: scripts/check-calls.sh accepts allowed $ calls and names forbidden ones.
set -u

root="$(cd "$(dirname "$0")/.." && pwd)"
check="$root/scripts/check-calls.sh"
tmp_dirs=()
failed=0

cleanup() {
    rm -rf "${tmp_dirs[@]}"
}
trap cleanup EXIT

make_mod() {
    local dir
    dir="$(mktemp -d)"
    tmp_dirs+=("$dir")
    mkdir -p "$dir/.claude-plugin" "$dir/hooks"
    echo '{"name":"tok","version":"0.1.0","description":"t"}' > "$dir/.claude-plugin/plugin.json"
    echo '{"modules":["./register.ts"]}' > "$dir/hooks/hooks.json"
    cat > "$dir/hooks/register.ts" <<TS
import type { Register } from 'claude-code'
export const register: Register = (on) => {
  on('session.start', async (\$, e, next) => { $1; return next(e) })
}
TS
    echo "$dir"
}

fail() {
    echo "FAIL $1: $2"
    failed=1
}

if ! "$check" "$root/control-tower" > /dev/null 2>&1; then
    fail T2a "control-tower should pass"
fi

mod_b="$(make_mod "\$.ui.toast('a'); await \$.fs.read('/tmp/x')")"
if ! "$check" "$mod_b" > /dev/null 2>&1; then
    fail T2b "\$.ui.toast + \$.fs.read should pass"
fi

mod_c="$(make_mod "\$.ui.toast('a'); await \$.http.fetch({ url: 'https://x' } as any)")"
if out_c="$("$check" "$mod_c" 2>&1)"; then
    fail T2c "\$.http.fetch should fail"
fi
if ! grep -qF '$.http.fetch' <<< "$out_c"; then
    fail T2c "output should name \$.http.fetch"
fi
if grep -qF '$.ui.toast' <<< "$out_c"; then
    fail T2c "output should not name \$.ui.toast"
fi

[ "$failed" -eq 0 ] && echo "T2 check-calls: OK"
exit "$failed"
