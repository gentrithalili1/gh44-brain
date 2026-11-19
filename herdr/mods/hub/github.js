// GitHub data through the user's own `gh` login: one search query per page of PRs.
// Filters run on GitHub's side (see buildPullRequestQuery), so a page is all we load.
import { exec } from "herdr";

export const PAGE_SIZE = 30;
const GH_TIMEOUT_MS = 60_000;

// One CI state per PR (the last commit's rollup) instead of every check: the light part.
const SEARCH_QUERY = `query($q: String!, $first: Int!, $after: String) {
  search(query: $q, type: ISSUE_ADVANCED, first: $first, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title url isDraft createdAt additions deletions reviewDecision headRefName mergeable
        author { login }
        assignees(first: 5) { nodes { login } }
        labels(first: 5) { nodes { name color } }
        reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { name combinedSlug } } } }
        latestReviews(first: 10) { nodes { author { login } } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`;

const CI_BY_ROLLUP = { SUCCESS: "passing", FAILURE: "failing", ERROR: "failing", PENDING: "pending", EXPECTED: "pending" };

const toPullRequest = (pr) => {
  const requested = (pr.reviewRequests?.nodes ?? []).map((r) => r.requestedReviewer).filter(Boolean);
  return {
    id: pr.url,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    author: pr.author?.login ?? "",
    assignees: (pr.assignees?.nodes ?? []).map((a) => a.login),
    branch: pr.headRefName,
    isDraft: pr.isDraft,
    hasConflicts: pr.mergeable === "CONFLICTING",
    labels: (pr.labels?.nodes ?? []).map((l) => l.name),
    // GitHub gives a label's color as hex without the "#".
    labelColors: Object.fromEntries((pr.labels?.nodes ?? []).map((l) => [l.name, `#${l.color}`])),
    ci: CI_BY_ROLLUP[pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state] ?? "none",
    requestedUsers: requested.filter((r) => r.login).map((r) => r.login),
    requestedTeams: requested.filter((r) => r.combinedSlug).map((r) => ({ value: r.combinedSlug, label: r.name })),
    reviewers: (pr.latestReviews?.nodes ?? []).map((r) => r.author?.login).filter(Boolean),
    decision: pr.reviewDecision || null,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    createdAt: pr.createdAt,
  };
};

const toFailure = (stderr) => {
  if (/gh auth login|authentication|401/i.test(stderr)) return { status: "error", reason: "auth" };
  return { status: "error", reason: "failed", message: stderr.trim().split("\n")[0] };
};

// The repo a folder belongs to: its shared git dir, the same for the main checkout and
// every worktree, so they all share one cache entry.
export async function loadRepoId({ folder, machine }) {
  if (!folder) return null;
  try {
    const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on: machine });
    return r.code === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

// owner/name from a GitHub remote URL: git@github.com:o/n.git or https://github.com/o/n.
const GITHUB_REMOTE = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/;

// The origin remote answers locally in ~20ms; `gh repo view` (a network call, ~0.8s) only when it is not GitHub.
export async function loadRepoName({ folder, machine }) {
  try {
    const remote = await exec("git", ["remote", "get-url", "origin"], { cwd: folder, on: machine });
    const match = remote.code === 0 ? remote.stdout.trim().match(GITHUB_REMOTE) : null;
    if (match) return match[1];
    const r = await exec("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { cwd: folder, on: machine });
    return r.code === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

// The repo's labels, for the Label filter (PRs on one page carry only a few).
export async function loadRepoLabels({ folder, machine }) {
  try {
    const r = await exec("gh", ["label", "list", "--limit", "200", "--json", "name", "--jq", ".[].name"], { cwd: folder, on: machine });
    return r.code === 0 ? r.stdout.split("\n").map((l) => l.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// People who can be assigned in the repo, for the Author filter: [{ login, name }].
// The PRs on one page carry only a few authors, and only their logins.
const REPO_USERS_QUERY = "query($owner: String!, $name: String!, $endCursor: String) { repository(owner: $owner, name: $name) { assignableUsers(first: 100, after: $endCursor) { pageInfo { hasNextPage endCursor } nodes { login name } } } }";

export async function loadRepoUsers({ repo, machine }) {
  const [owner, name] = repo.split("/");
  try {
    const r = await exec("gh", ["api", "graphql", "--paginate", "-f", `query=${REPO_USERS_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`,
      "--jq", ".data.repository.assignableUsers.nodes[] | [.login, .name // \"\"] | @tsv"], { on: machine, timeout: GH_TIMEOUT_MS });
    if (r.code !== 0) return [];
    return r.stdout.split("\n").filter(Boolean).map((line) => {
      const [login, fullName = ""] = line.split("\t");
      return { login, name: fullName.trim() };
    });
  } catch {
    return [];
  }
}

// The teams I'm in, for the Team filter: [{ value: "org/team", label: "team" }].
export async function loadMyTeams({ org, login }) {
  try {
    const query = "query($org: String!, $login: String!) { organization(login: $org) { teams(first: 100, userLogins: [$login]) { nodes { name combinedSlug } } } }";
    const r = await exec("gh", ["api", "graphql", "-f", `query=${query}`, "-f", `org=${org}`, "-f", `login=${login}`]);
    if (r.code !== 0) return [];
    return (JSON.parse(r.stdout).data?.organization?.teams?.nodes ?? []).map((t) => ({ value: t.combinedSlug, label: t.name }));
  } catch {
    return [];
  }
}

// The repo's linked worktrees with a branch: [{ path, branch }]. Skips the main checkout,
// detached and locked ones (another tool is using those).
export async function loadWorktrees({ main, machine }) {
  try {
    const r = await exec("git", ["worktree", "list", "--porcelain"], { cwd: main, on: machine });
    if (r.code !== 0) return [];
    return r.stdout.split(/\n\n+/).slice(1).map((block) => {
      const lines = block.split("\n");
      return {
        path: lines.find((l) => l.startsWith("worktree "))?.slice(9),
        branch: lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, ""),
        head: lines.find((l) => l.startsWith("HEAD "))?.slice(5),
        isLocked: lines.some((l) => l.startsWith("locked")),
      };
    }).filter((w) => w.path && w.branch && !w.isLocked);
  } catch {
    return [];
  }
}

// Worktrees whose work is merged: the branch's latest merged PR contains the worktree's
// commit (the same commit, or an older one). A reused branch name alone is not enough.
export async function loadMergedWorktrees({ repo, main, worktrees, machine }) {
  if (worktrees.length === 0) return [];
  const [owner, name] = repo.split("/");
  try {
    const fields = worktrees.map((w, i) => `b${i}: pullRequests(headRefName: ${JSON.stringify(w.branch)}, states: MERGED, first: 1, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { number headRefOid } }`).join(" ");
    const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`;
    const r = await exec("gh", ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`]);
    if (r.code !== 0) return [];
    const found = JSON.parse(r.stdout).data.repository;
    const merged = [];
    for (const [i, w] of worktrees.entries()) {
      const pr = found[`b${i}`]?.nodes?.[0];
      if (!pr) continue;
      if (w.head !== pr.headRefOid) {
        // The PR's last commit may have been pushed from elsewhere: fetch it to compare.
        const hasCommit = (await exec("git", ["cat-file", "-e", `${pr.headRefOid}^{commit}`], { cwd: main, on: machine })).code === 0;
        if (!hasCommit) await exec("git", ["fetch", "-q", "origin", `pull/${pr.number}/head`], { cwd: main, on: machine });
      }
      const isContained = w.head === pr.headRefOid
        || (await exec("git", ["merge-base", "--is-ancestor", w.head, pr.headRefOid], { cwd: main, on: machine })).code === 0;
      if (isContained) merged.push({ ...w, pr: pr.number });
    }
    return merged;
  } catch {
    return [];
  }
}

// Removes a merged worktree and its local branch. Refuses a worktree with uncommitted changes.
export async function removeWorktree({ main, path, branch, machine }) {
  const removed = await exec("git", ["worktree", "remove", path], { cwd: main, on: machine });
  if (removed.code !== 0) return { status: "failed", reason: "dirty", message: (removed.stderr || removed.stdout).trim().split("\n")[0] };
  await exec("git", ["branch", "-D", branch], { cwd: main, on: machine });
  return { status: "removed" };
}

export async function loadGithubLogin() {
  const r = await exec("gh", ["api", "user", "--jq", ".login"]);
  return r.code === 0 ? r.stdout.trim() : null;
}

// One page of PRs for a search query. `after` is the previous page's cursor.
export async function loadPullRequests({ query, after = null }) {
  try {
    const args = ["api", "graphql", "-f", `query=${SEARCH_QUERY}`, "-f", `q=${query}`, "-F", `first=${PAGE_SIZE}`, ...(after ? ["-f", `after=${after}`] : [])];
    const r = await exec("gh", args, { timeout: GH_TIMEOUT_MS });
    if (r.code !== 0) return toFailure(r.stderr || r.stdout);
    const search = JSON.parse(r.stdout).data.search;
    return {
      status: "success",
      items: search.nodes.filter((n) => n.number).map(toPullRequest),
      total: search.issueCount,
      cursor: search.pageInfo.endCursor,
      hasMore: search.pageInfo.hasNextPage,
    };
  } catch (error) {
    return { status: "error", reason: "failed", message: String(error?.message ?? error) };
  }
}
