---
title: Connect an agent
description: Set up Claude Code, Codex, OpenCode, Pi or any other coding agent to make App Store screenshots with appShots, or add it to claude.ai, Claude Desktop or ChatGPT as a connector. One command installs the skill, the CLI and the MCP connection.
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

## Add it as a connector

claude.ai, Claude Desktop, ChatGPT and other apps that take a remote MCP server as a connector sign in to appShots by themselves. There is nothing to install and no token to paste.

1. Open the place where the app adds a connector. In claude.ai and Claude Desktop, that is **Settings → Connectors → Add custom connector**. In ChatGPT, it is under **Settings → Apps**, once developer mode is on in the advanced settings there.
2. Give it the address `{{SERVER}}/mcp`. Leave the client ID and secret empty. If it asks how to sign in, pick OAuth.
3. Click **Connect**. A page of appShots opens. Sign in with Google if you are not signed in on this browser already.
4. The page asks whether to let the app use your appShots account, and shows where it sends you back to. Check that this is the app you are adding, then click **Allow**.

The app can then use [the tools](/docs/mcp) as you: see, create, change and delete your projects, and render them, which uses your renders. It cannot change your account, make tokens or see anybody else's work. It renews its access by itself, so you are asked again only after it was disconnected or went unused for 30 days.

**Settings → Connected apps** in the Studio lists the apps you let in, where each one goes back to and when it was last used. **Disconnect** cuts one off at once.

Good to know:

- These apps connect from their maker's servers, not from your computer. The appShots server has to be reachable from the internet over HTTPS; one on `localhost` works with the agents above, but not as a connector.
- Behind a reverse proxy, set `PUBLIC_URL` to the public address. The app is told to sign in there.
- On a server without sign-in there is nothing to sign in to. Add the address and leave the authentication settings empty.
- MCP has no way to send files, so a connector cannot upload your screenshots. Add them in the [Studio](/docs/studio) or with the [command line](/docs/cli), then ask for the set.

## Only the MCP connection

If you add the screenshots yourself and only want the agent to design the set, the connection is enough.

Claude Code:

```bash
claude mcp add --transport http --scope user appshots {{SERVER}}/mcp --header "Authorization: Bearer <your token>"
```

Claude Code can also sign in like a connector, without a token: leave out `--header`, then run `/mcp` in Claude Code, pick `appshots` and sign in.

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

Any other client works if it speaks Streamable HTTP and either signs in with OAuth, as a connector does, or sends a bearer header. Then ask in plain words:

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

## Local models

An agent that runs on a model on your own machine, such as one served by Ollama or LM Studio, can make a set too. What the model needs:

| | |
| --- | --- |
| Tool calling | **Required.** The model has to call the server's tools, or run the `appshots` command, and read what comes back. Pick one whose description says it supports tool calling or function calling. Without it, no set gets made. |
| Context | **32k tokens recommended.** Smaller works for a short set, but the agent then has less room for what it reads along the way and loses track sooner. |
| Vision | **Optional.** With it, the agent looks at the screenshots and at the contact sheet each render returns, and fixes what it sees. Without it, it works from the screenshot names and what the tools say, and you check the set in the [Studio](/docs/studio). |

Connect the agent with the [one command](#the-one-command), as for any other. Which model it runs on makes no difference to the setup:

- **OpenCode:** the command with `opencode` at the end. It adds the MCP server to OpenCode for every model, local ones included. Pick the model in OpenCode's own settings.
- **Pi:** the command with `pi` at the end. Pi has no MCP, so the skill reaches the server through the `appshots` command.
- **Another agent:** the command with `other` at the end installs the skill and the command. If the agent speaks MCP, add `{{SERVER}}/mcp` in its settings as a Streamable HTTP server with the header `Authorization: Bearer <your token>`. Then tell it: "Read `~/.agents/skills/appshots/SKILL.md` and follow it".

What keeps the context small:

- **The skill is short.** `SKILL.md` stays under 12 KB, about three thousand tokens. The full text of each step is in a reference file beside it, which the agent reads only when it gets there. See [The skill](/docs/skill).
- **The design guide has a short topic.** `get_design_guide` with the topic `core` is about two thousand tokens instead of eleven thousand, and says which topic to read for anything else. The topic `fields` lists every field a slide takes. See [MCP tools](/docs/mcp).
- **The tool list is small,** about seven thousand tokens for every tool. Every tool of every MCP server the agent has takes room in each request, so turn off the servers a set does not need. With the least room, leave out MCP altogether: through the `appshots` command, the tool list never enters the context, and `appshots tools <tool>` shows one tool's arguments when the agent needs them.
- **A check costs nothing.** `check_project` says what a render would refuse or warn about, without using one of your renders, so a smaller model can find its mistakes before it spends one.

Start a new session for each set, so that nothing from earlier work takes up the room.

## Check that it works

```bash
appshots check
```

It reports whether the server answers and accepts your token, whether the skill is current, which Xcode there is, the project in the current folder and what it is made with, the simulators it would use and any plugged-in device. Each line says what to do when something is missing.

## Tokens

The `appshots` command cannot sign in with Google, so it and the agents the one command sets up use a token of yours. A token reaches your projects and nothing else: it cannot create more tokens, change your account or see anybody else's work.

- A token is shown once, when it is created. Lost it? Create a new one and run the command again.
- **Settings** in the Studio's sidebar lists your tokens with the day each was last used, and revokes them.
- After revoking or replacing a token, run the one command again with the new one.

## Disconnect

1. Revoke the token under **Settings**. Nothing on your Mac can reach your projects after that. For a connector, click **Disconnect** under **Settings → Connected apps**, then remove it in the app.
2. Remove the agent's entry: `claude mcp remove appshots --scope user`, `codex mcp remove appshots`, or the `appshots` entry in your agent's MCP settings.
3. Delete the skill folder from the table above, the link named `appshots` on your `PATH`, and the folder `~/.config/appshots`.
