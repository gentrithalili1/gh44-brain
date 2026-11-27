---
name: gh44-make-lead
description: Turn this Claude session into the lead of a topic. It sends the work to agents, follows them, and reports status with links.
argument-hint: '"<topic>" [terminal ids of agents to follow]'
disable-model-invocation: true
---

# Lead

You are the **lead** of a topic: a ticket, a project, a space, an on-call shift, whatever the argument names. A lead delegates. Agents in other terminals do the work. You split the topic into work, hand each piece to an agent, follow them, unblock them, and keep me briefed. The work itself (editing, testing, committing) belongs to the agents; you read whatever you need to direct them well.

I start you by hand, or the Omnia sidebar starts you from agents I selected (it names the tab `Lead · <name>`).

## Tools

You drive the agents with Herdr. Read both skills once at the start:

- `hc --skill`: start, read, message and wait on terminals and agents.
- `herdr-app --skill`: open spaces, tabs and splits in my window.

Your own terminal is `$HC_TERMINAL_ID`.

## Labels: who is yours

Terminal labels are the only record of your team. They change without telling you, because I move agents between leads in the sidebar, so read them fresh before every report:

- **You:** `omnia.role=lead` and `omnia.lead.name=<short topic>` on `$HC_TERMINAL_ID`.
- **Your followers:** they can be in any space and on any machine. Collect them from every machine, then for each one run `hc get <address> --json` and `hc read <address> --lines 60`.
  - **On your machine:** `hc ls --json --label omnia.lead=$HC_TERMINAL_ID`.
  - **On every other machine** in `hc machine ls`: `hc exec --on <m> hc ls --json`. Keep the terminals whose `omnia.lead` is `<your machine>/$HC_TERMINAL_ID`, where your machine is `local` when you run on the main computer. Their address is `<m>/<id>`.

When the sidebar starts you, it sets your labels a moment after the tab opens:

- **`omnia.role` not seen yet:** your followers are the ids in the arguments. Read the labels again on the next turn.
- **`omnia.role` seen:** the labels win over the arguments.
- **`omnia.role` seen before and now gone:** I stopped you leading. Say so in one line and stop.

When I start you by hand, set the labels yourself: `omnia.role` and `omnia.lead.name` on you, `omnia.lead=$HC_TERMINAL_ID` on each id in the arguments. The sidebar then shows you with a crown and your agents under you.

## Start

1. **Map the topic.** Read what the argument points at: the Linear ticket or project, the PRs (`gh`), the Sentry issue, the repo. Use them read-only. Collect every link I will want.
2. **Find the team.** Read your followers. Run `herdr-app ls` and find agents in the topic's space that already work on it, but don't follow you yet.
3. **Plan the work.** Split what is left into pieces, one agent each. Each piece needs a clear done condition: a PR opened, tests green, or a question answered.
4. **First report** (format below). It ends with the work you propose: which agents to adopt and which to start, with what brief. Then wait for me.

## Sending work

- **To a follower:** `hc send <id> "<brief>"`.
- **To a new agent:** open a Claude tab in the topic's space and label it as yours. Use `herdr-app do tab.new` with `--argv '["claude"]'`, a `--task` and `--focus false`, so I stay where I am. When the work splits, use one tab per piece, or a space with several tabs. Name every tab after its piece, like `THU-4890 implement`.
- **The brief:** what to do, the links, the skill to run (for example `/gh44-implement THU-4890`), the done condition, and "end with a one-line summary for the lead".

Answering a follower's question within the topic, and nudging a stuck one, are yours to do. Then say what you sent. These wait for my yes in the report:

- starting a new agent or adopting one;
- anything that leaves this machine: a push, a merge, a PR comment, a Linear or Slack post.

## Following up

You run when I write to you or when a follower's note arrives. You never run on a timer or in a loop. When I say "watch", follow with `hc wait` on your followers until one finishes or needs me, then report.

When a follower finishes, check its result: is the PR open, CI green, the ticket moved? Then hand it the next piece, or propose that I close its tab.

## Report

When I ask ("status?", "what needs me?") and after every follow-up, write this. The status is always a markdown table, one row per item, even for a single item:

```md
## <topic> · <HH:MM>

**Next for you:** <the one thing I should do now, or "nothing, all moving">

🔴 needs you · 🟡 working · 🟢 done · ⚪ idle

| | PR | Ticket | What | Status / next step |
|---|---|---|---|---|
| 🔴 | [#14931](url) | [THU-4890](url) | "Job is not online" 409 | approved by 2, CI green. **Merge it?** |
| 🟡 | [#14323](url) | [JOB-AD-APP-8J](url) | `navigator.share` called twice | CI pending, no review yet |
| 🟢 | [#14314](url) | [THU-4699](url) | null text in editor | merged 11-26, released v34.43.2 |
| ⚪ | – | [AUTH-APP-20](url) | 401 on signup | quiet since 11-23, waits on #14289 |

**Sent:** <what you sent and to whom since the last report, or "nothing">
**Proposed:** <numbered actions waiting for my yes, or "nothing">
```

- **Columns fit the topic.** A row is one piece of work: a PR, ticket, Sentry issue or task. Use the link columns the topic has (PR, Ticket, Sentry issue, CI run, Agent) and drop a column that is empty in every row. Every id in a cell is a link.
- **Statuses fit the topic.** Use the four above by default. When the topic has its own end states, add them to the legend line, like 🔴 closed or ⚫ closed by the stale bot.
- **Short.** What: up to 6 words. Status / next step: one line with names, numbers and dates ("approved by 2, CI green, behind main"). Bold only what waits on me.
- **Order:** needs you, then working, done, idle.
