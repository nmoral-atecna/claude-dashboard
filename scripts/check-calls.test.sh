#!/usr/bin/env bash
# T2: scripts/check-calls.sh accepts allowed $ calls and names forbidden ones.
# T7: it reports a failing validate on stderr only.
# T9: that stderr report includes validate's error messages.
set -u

root="$(cd "$(dirname "$0")/.." && pwd)"
check="$root/scripts/check-calls.sh"
tmp_dirs=()
failed=0

cleanup() {
    rm -rf "${tmp_dirs[@]}"
}
trap cleanup EXIT

# Sets $mod; not called via $(...) so tmp_dirs reaches the cleanup trap.
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
    mod="$dir"
}

fail() {
    echo "FAIL $1: $2"
    failed=1
}

if ! "$check" "$root/control-tower" > /dev/null 2>&1; then
    fail T2a "control-tower should pass"
fi

make_mod "\$.ui.toast('a'); await \$.fs.read('/tmp/x')"
mod_b="$mod"
if ! "$check" "$mod_b" > /dev/null 2>&1; then
    fail T2b "\$.ui.toast + \$.fs.read should pass"
fi

make_mod "await \$.env.get('HOME')"
mod_env="$mod"
if ! "$check" "$mod_env" > /dev/null 2>&1; then
    fail T2d "\$.env.get should pass"
fi

make_mod "await \$.session.cwd()"
mod_session="$mod"
if ! "$check" "$mod_session" > /dev/null 2>&1; then
    fail T2e "\$.session.cwd should pass"
fi

make_mod "\$.ui.toast('a'); await \$.http.fetch({ url: 'https://x' } as any)"
mod_c="$mod"
if out_c="$("$check" "$mod_c" 2>&1)"; then
    fail T2c "\$.http.fetch should fail"
fi
if ! grep -qF '$.http.fetch' <<< "$out_c"; then
    fail T2c "output should name \$.http.fetch"
fi
if grep -qF '$.ui.toast' <<< "$out_c"; then
    fail T2c "output should not name \$.ui.toast"
fi

expect_validate_failure() {
    local id="$1" dir="$2" message="$3" out err
    err="$(mktemp)"
    tmp_dirs+=("$err")
    if out="$("$check" "$dir" 2> "$err")"; then
        fail "$id" "should fail"
    fi
    if ! grep -F 'validate failed' "$err" | grep -qF "$dir"; then
        fail "$id" "stderr should contain 'validate failed' and $dir"
    fi
    if ! grep -qF "$message" "$err"; then
        fail "$id" "stderr should contain '$message'"
    fi
    if [ -n "$out" ]; then
        fail "$id" "stdout should be empty"
    fi
}

missing="$(mktemp -d)"
rmdir "$missing"
expect_validate_failure T7a "$missing" "File not found"

make_mod "const x = \$"
mod_7b="$mod"
expect_validate_failure T7b "$mod_7b" "\$ itself is bound to a name"

[ "$failed" -eq 0 ] && echo "T2/T7/T9 check-calls: OK"
exit "$failed"
