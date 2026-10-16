---
title: Update
description: How appShots stays current. The Studio and the server's tools update by themselves, and one command, appshots update, refreshes the skill and the CLI on your Mac.
---

appShots has a part that lives on the server and a part that lives on your Mac. Only the second one needs you.

## What updates by itself

Everything on the server: the Studio, the layouts, fonts and badges, the MCP tools, and the design guide an agent reads before it builds a set. A new version is live for everybody as soon as it is deployed.

- If the Studio is open in a tab, reload it to get the new version.
- Your projects, screenshots and renders stay as they are. A project is drawn by the current version each time it is rendered, so **render again** to pick up a fix or a redrawn layout.
- A connected agent needs nothing. It asks the server for its tools and the guide every time.

## What lives on your Mac

Two files, installed by the [setup command](/docs/connect): the skill (`SKILL.md`) and the `appshots` command (`appshots.mjs`). Beside the skill, a `references` folder holds the full text of each of its steps. The server hands out the versions it was deployed with. Bring your copies up to date with:

```bash
appshots update
```

It needs no token and leaves your agent's connection alone. If you set up several agents, all of their copies are updated. It also fetches the reference files a copy from before them lacks, and leaves any the server no longer has where they are.

## How you find out

```bash
appshots check
```

The `Skill:` line says whether the server has a newer one. You rarely have to look:

- The skill starts every job with `appshots check`, and when the server has a newer skill, the agent runs `appshots update` and reads the new instructions before going on: `SKILL.md` from the top when it changed, and otherwise only the reference files the update names.
- The command says so by itself. After a command such as `appshots upload` or `appshots pull` it prints one line when your copies are behind the server's. It asks the server for that at most twice a day, and stays quiet when the server cannot be reached.

A copy from before this notice existed learns it with its next `appshots update`.

## When to run the setup command again

- **You replaced or revoked your token.** Create a new one under **Connect an agent** and paste the new command.
- **You want to add another agent.** Run it with that agent's name at the end.
- **`appshots update` is not a command your copy knows.** It is from before updates existed. Run the setup command once more.
- **The agent says the MCP server answers 401.** The token it was connected with no longer works. The skill carries on through the command, and running the setup command again repairs the connection.

## A new Mac

Nothing moves with you except your account. Sign in, create a token under **Connect an agent** and run the command on the new Mac. Your projects are on the server.
