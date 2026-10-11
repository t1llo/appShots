#!/bin/sh
# Sets this Mac up for the appShots server at {{SERVER}} in one go:
#
#   curl -fsS {{SERVER}}/install.sh | APPSHOTS_TOKEN=<token> sh -s <agent>
#
# <agent> is claude, codex, opencode, pi or other; left out, it is claude. The script downloads the appshots
# CLI and hands over to `appshots setup`, which saves the token, installs the appshots skill and the CLI
# where that agent looks for skills, and connects the agent to the server.
set -eu

agent="${1:-${APPSHOTS_AGENT:-claude}}"

if ! command -v node >/dev/null 2>&1; then
  echo "appshots: Node.js 18 or newer is needed. Install it (https://nodejs.org, or 'brew install node') and run this again." >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsS "{{SERVER}}/cli/appshots.mjs" -o "$tmp/appshots.mjs"

# Piped into sh, stdin is this script. Give setup the terminal back so it can ask for the token.
if (exec </dev/tty) 2>/dev/null; then
  node "$tmp/appshots.mjs" setup "{{SERVER}}" --agent "$agent" </dev/tty
else
  node "$tmp/appshots.mjs" setup "{{SERVER}}" --agent "$agent"
fi
