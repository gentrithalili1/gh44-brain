// Starting a gh44 skill in a new Claude tab: here, in the background, or in the ticket's worktree.
import { run, spaces, agents, appHome, notify, openOverlay, exec } from "herdr";

export const LINEAR_SKILLS = ["gh44-clarify", "gh44-plan", "gh44-implement", "gh44-address-review"];
export const GITHUB_SKILLS = ["gh44-code-review", "gh44-address-review", "gh44-resolve-conflicts"];
const PR_SKILLS = ["gh44-code-review", "gh44-address-review", "gh44-resolve-conflicts"];

// Where a ticket is: backlog, todo, progress or review (a started state named like "In Review").
export function getIssueStage(issue) {
  if (issue.stateType === "started") return /review/i.test(issue.state) ? "review" : "progress";
  if (issue.stateType === "backlog" || issue.stateType === "triage") return "backlog";
  return "todo";
}

const STAGE_SKILL = { backlog: "gh44-plan", todo: "gh44-plan", progress: "gh44-implement", review: "gh44-address-review" };

// The next step for a ticket follows its status.
export const getDefaultLinearSkill = (issue) => STAGE_SKILL[getIssueStage(issue)];

// A space already working on this branch, other than the shown one.
export const findSpaceOnBranch = (branch) => (branch ? spaces().find((s) => !s.active && s.branch === branch) ?? null : null);

// Most urgent first, like Herdr's own space and tab status.
const STATUS_RANK = { blocked: 0, done: 1, working: 2, idle: 3 };

// The agent working on an item: in a tab this panel named after it ("THU-123 plan",
// "#123 code-review"), or anywhere in a space on its branch. The most urgent one wins.
export function findAgentFor({ label, branch }) {
  const branchSpaces = new Set(spaces().filter((s) => branch && s.branch === branch).map((s) => s.id));
  const matches = agents().filter((a) => a.tab_name?.startsWith(`${label} `) || branchSpaces.has(a.space));
  return matches.sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || b.seq - a.seq)[0] ?? null;
}

export function focusAgent(agent) {
  run("space.select", { id: agent.space });
  run("tab.select", { id: agent.tab });
}

export const shortSkill = (skill) => skill.replace(/^gh44-/, "");

// Another author's PR gets a review; mine gets the review comments addressed.
export const getDefaultGithubSkill = ({ pr, login }) => (login && pr.author === login ? "gh44-address-review" : "gh44-code-review");

// target: { ref (what the skill gets), prRef? (for PR skills), label (tab name prefix),
//   branch?, folder?, main? (the repo's main checkout), worktree? (an existing checkout of the branch),
//   space? (a space already open on the branch) }
// isBackground: open the tab without switching to it (reviews). isWorktree: in the ticket's worktree.
export function startSkill({ skill, target, isWorktree = false, isBackground = false }) {
  const ref = PR_SKILLS.includes(skill) && target.prRef ? target.prRef : target.ref;
  const prompt = `/${skill} ${ref}`;
  const name = `${target.label} ${shortSkill(skill)}`;
  const space = spaces().find((s) => s.active);
  if (isWorktree && target.space) {
    run("tab.new", { name, space: target.space, folder: target.worktree, argv: ["claude", prompt], focus: !isBackground });
    return;
  }
  // An existing worktree needs no main checkout; a new one is made from it.
  if (isWorktree && (target.worktree || (target.branch && target.main))) {
    void startInWorktree({ target, name, prompt });
    return;
  }
  run("tab.new", { name, space: space?.id, argv: ["claude", prompt], focus: !isBackground, ...(target.folder ? { folder: target.folder } : {}) });
  if (isBackground) notify({ title: `Started ${name}`, body: "Running in the background. Herdr tells you when it needs you or is done.", level: "info" });
}

// Herdr's own New worktree dialog creates the worktree where Herdr keeps them
// (settings.json worktrees.directory, default ~/.herdr/worktrees/<repo>/<branch>) and opens
// a space in it; its first tab prepares the worktree and starts Claude.
// An existing checkout of the branch is reused as is.
async function startInWorktree({ target, name, prompt }) {
  const script = `${appHome()}/mods/hub/start-worktree.sh`;
  const { main, branch } = target;
  if (target.worktree) {
    run("space.new", { folder: target.worktree, tab: name, argv: ["bash", script, prompt] });
    return;
  }
  // Herdr's dialog branches a new branch from the main checkout's HEAD, which may be behind.
  // Create it from the fresh remote default branch first; the dialog then checks it out.
  try {
    await exec("git", ["fetch", "-q", "origin"], { cwd: main });
    const hasBranch = (await exec("git", ["show-ref", "-q", "--verify", `refs/heads/${branch}`], { cwd: main })).code === 0;
    if (!hasBranch) {
      const base = (await exec("git", ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], { cwd: main })).stdout.trim() || "origin/main";
      await exec("git", ["branch", "--no-track", branch, base], { cwd: main });
    }
  } catch (error) {
    notify({ title: `Could not prepare branch ${branch}`, body: String(error?.message ?? error), level: "warning" });
  }
  openOverlay({
    mod: "worktree", kind: "dialog", width: 440, height: 260,
    props: {
      space: spaces().find((s) => s.active)?.id, folder: target.main, action: "new",
      branch: target.branch, tab: name, argv: ["bash", script, prompt, "--prepare"],
    },
  });
}
