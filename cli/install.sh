#!/bin/sh
# Sets this Mac up for the appShots server at {{SERVER}} in one go:
#
#   curl -fsS {{SERVER}}/install.sh | APPSHOTS_TOKEN=<token> sh
#
# It downloads the appshots CLI and hands over to `appshots setup`, which saves the token, installs the
# /appshots skill for Claude Code and connects Claude Code to the server.
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "appshots: Node.js 18 or newer is needed. Install it (https://nodejs.org, or 'brew install node') and run this again." >&2
  exit 1
fi

dir="$HOME/.claude/skills/appshots"
mkdir -p "$dir"
curl -fsS "{{SERVER}}/cli/appshots.mjs" -o "$dir/appshots.mjs"
chmod +x "$dir/appshots.mjs"

# Piped into sh, stdin is this script. Give setup the terminal back so it can ask for the token.
if (exec </dev/tty) 2>/dev/null; then
  exec node "$dir/appshots.mjs" setup "{{SERVER}}" "$@" </dev/tty
fi
exec node "$dir/appshots.mjs" setup "{{SERVER}}" "$@"
