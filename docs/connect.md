---
title: Connect an agent
description: Set up Claude Code, Codex, OpenCode, Pi or any other coding agent to make App Store screenshots with appShots. One command installs the skill, the CLI and the MCP connection.
---

An agent needs three things to make a set on its own: the **skill** (what to do), the **`appshots` command** (to run your app and capture its screens) and a **connection to the server** (to build and render the set). One command installs all three.

## The one command

1. Open [the Studio](/studio), sign in, and click **Connect an agent** in the sidebar.
2. Pick your agent, then **Do everything for me**.
3. Click **Create token**. The command appears with your token in it.
4. Paste it into Terminal on your Mac.

```bash
curl -fsS {{SERVER}}/install.sh | APPSHOTS_TOKEN=<your token> sh -s <agent>
```

`<agent>` is `claude`, `codex`, `opencode`, `pi` or `other`. Left out, it is `claude`. The command needs [Node.js](https://nodejs.org) 18 or newer and does four things:

1. Checks the token against the server and saves it in `~/.config/appshots/config.json`, readable by you only.
2. Puts the `appshots` command next to the skill and links it into `~/.local/bin`, `~/bin` or the folder Claude Code sits in, whichever is on your `PATH`.
3. Installs the skill where your agent looks for skills.
4. Connects the agent to the server's MCP endpoint for every folder, replacing an older `appshots` entry.

Then open the agent in your app's folder, **in a new session** so that it sees the skill, and start it.

## What goes where

| Agent | The skill is installed in | Start it with | MCP connection |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/skills/appshots` | `/appshots` | `claude mcp add`, for every folder |
| Codex | `~/.agents/skills/appshots` | `$appshots` | `codex mcp add`, token in `~/.codex/config.toml` |
| OpenCode | `~/.agents/skills/appshots` | Ask for the screenshots | `opencode mcp add --global` |
| Pi | `~/.agents/skills/appshots` | `/skill:appshots` | None. Pi has no MCP, so the skill uses the command |
| Another agent | `~/.agents/skills/appshots` | "Read `~/.agents/skills/appshots/SKILL.md` and follow it" | By hand, if the agent has MCP |

Using several agents? Run the command once per agent. A copy that was set up for another agent is brought up to date at the same time.

## Three ways to work

**Connect an agent** offers three, for every agent:

| Way | What you do | What gets set up |
| --- | --- | --- |
| Do everything for me | Paste one command, then start the skill in your app's folder | The skill, the command and the MCP connection |
| Tell it what to do | Paste one command, add your screenshots, describe the set in a sentence | The MCP connection only |
| Make it by hand | Nothing | Nothing. You work in the Studio |

## Only the MCP connection

If you add the screenshots yourself and only want the agent to design the set, the connection is enough.

Claude Code:

```bash
claude mcp add --transport http --scope user appshots {{SERVER}}/mcp --header "Authorization: Bearer <your token>"
```

OpenCode:

```bash
opencode mcp add --global --url {{SERVER}}/mcp --header "Authorization=Bearer <your token>" appshots
```

Codex takes no header on its command line. Use the one command above, or add the server yourself in `~/.codex/config.toml`:

```toml
[mcp_servers.appshots]
url = "{{SERVER}}/mcp"
http_headers = { Authorization = "Bearer <your token>" }
```

Any other client works if it speaks Streamable HTTP and can send a bearer header. The endpoint does not do OAuth. Then ask in plain words:

> Make App Store screenshots for my habit tracker in project "streaks". Six slides, dark purple look. Open with a hero slide, then one slide per feature using the screenshots home, stats and widgets.

[MCP tools](/docs/mcp) lists what the agent can call.

## Without MCP

An agent that can run commands but has no MCP reaches the same tools through the command:

```bash
appshots tools
appshots call create_project '{"name": "Streaks"}'
appshots call render '{"project": "streaks"}'
```

The skill does this by itself when the session has no working `appshots` MCP server. See [The appshots command](/docs/cli).

## Check that it works

```bash
appshots check
```

It reports whether the server answers and accepts your token, whether the skill is current, which Xcode there is, the project in the current folder and what it is made with, the simulators it would use and any plugged-in device. Each line says what to do when something is missing.

## Tokens

An agent cannot sign in with Google, so it uses a token of yours. A token reaches your projects and nothing else: it cannot create more tokens, change your account or see anybody else's work.

- A token is shown once, when it is created. Lost it? Create a new one and run the command again.
- **Settings** in the Studio's sidebar lists your tokens with the day each was last used, and revokes them.
- After revoking or replacing a token, run the one command again with the new one.

## Disconnect

1. Revoke the token under **Settings**. Nothing on your Mac can reach your projects after that.
2. Remove the agent's entry: `claude mcp remove appshots --scope user`, `codex mcp remove appshots`, or the `appshots` entry in your agent's MCP settings.
3. Delete the skill folder from the table above, the link named `appshots` on your `PATH`, and the folder `~/.config/appshots`.
