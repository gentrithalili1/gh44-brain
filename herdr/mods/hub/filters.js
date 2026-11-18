// Pure filtering and grouping for the hub panel. No herdr or UI imports.

export const GITHUB_DEFAULTS = { scope: "review", authors: [], labels: [], teams: [], reviews: "any", assignees: [], checks: "any", sort: "newest" };
export const LINEAR_DEFAULTS = { mine: true, teams: [], projects: [], statuses: [], priorities: [], labels: [], assignees: [] };

// The same views as GitHub's pull request sidebar.
export const GITHUB_SCOPES = [
  { value: "all", label: "Pull requests" },
  { value: "mine", label: "Authored by me" },
  { value: "assigned", label: "Assigned to me" },
  { value: "involves", label: "Involves me" },
  { value: "review", label: "Review requests" },
];

export const REVIEW_OPTIONS = [
  { value: "any", label: "Any" },
  { value: "none", label: "No reviews" },
  { value: "required", label: "Review required" },
  { value: "approved", label: "Approved" },
  { value: "changes", label: "Changes requested" },
  { value: "byMe", label: "Reviewed by you" },
  { value: "notByMe", label: "Not reviewed by you" },
  { value: "awaitingMe", label: "Awaiting review from you" },
];

export const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "updated", label: "Recently updated" },
  { value: "stale", label: "Least recently updated" },
  { value: "comments", label: "Most commented" },
];

export const NO_ASSIGNEE = "__none__";

export const LINEAR_SCOPES = [
  { value: true, label: "My issues" },
  { value: false, label: "Everyone" },
];

// GitHub search takes one status: qualifier, so CI is a single choice.
export const CI_OPTIONS = [
  { value: "any", label: "Any" },
  { value: "passing", label: "Passing" },
  { value: "failing", label: "Failing" },
  { value: "pending", label: "Pending" },
];

export const PRIORITY_OPTIONS = [
  { value: 1, label: "Urgent" },
  { value: 2, label: "High" },
  { value: 3, label: "Medium" },
  { value: 4, label: "Low" },
  { value: 0, label: "No priority" },
];

export const UNASSIGNED = "Unassigned";

// Open work first: what is in progress, then what is next.
const STATE_TYPE_ORDER = ["started", "unstarted", "backlog", "triage"];
// Linear stores "no priority" as 0; sort it after Low.
const NO_PRIORITY_RANK = 5;

const matchesSearch = ({ search, fields }) => {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = fields.join(" ").toLowerCase();
  return words.every((w) => text.includes(w));
};

const matchesAny = ({ chosen, values }) => chosen.length === 0 || values.some((v) => chosen.includes(v));

export const isReviewScope = (scope) => scope === "review" || scope === "direct";

// "reviewed": I reviewed it and nobody asked me again, so it can wait.
// "rereview": I reviewed it and was asked again, usually after new commits.
export function getMyReviewState({ pr, login }) {
  if (!login || !pr.reviewers.includes(login)) return "none";
  return pr.requestedUsers.includes(login) ? "rereview" : "reviewed";
}

// Whose move a PR is, in list order: mine first, then what others ask of me, drafts last.
export const PULL_REQUEST_GROUPS = [
  { id: "fix", label: "Needs fixing", tone: "danger" },
  { id: "merge", label: "Ready to merge", tone: "success" },
  { id: "rereview", label: "Review again", tone: "warning" },
  { id: "review", label: "To review", tone: "warning" },
  { id: "waiting", label: "Waiting on others", tone: "quiet" },
  { id: "reviewed", label: "Already reviewed", tone: "neutral" },
  { id: "draft", label: "Drafts", tone: "neutral" },
];

const isMyPullRequest = ({ pr, login }) => Boolean(login) && pr.author === login;

export function getPullRequestGroup({ pr, login }) {
  if (pr.isDraft) return "draft";
  if (isMyPullRequest({ pr, login })) {
    if (pr.hasConflicts || pr.ci === "failing" || pr.decision === "CHANGES_REQUESTED") return "fix";
    if (pr.decision !== "REVIEW_REQUIRED" && pr.ci !== "pending") return "merge";
    return "waiting";
  }
  const review = getMyReviewState({ pr, login });
  if (review === "rereview") return "rereview";
  if (review === "reviewed") return "reviewed";
  return "review";
}

// Groups in PULL_REQUEST_GROUPS order, each keeping the search's order; empty groups left out.
export function groupPullRequests({ items, login }) {
  const byGroup = new Map();
  for (const pr of items) {
    const id = getPullRequestGroup({ pr, login });
    byGroup.set(id, [...(byGroup.get(id) ?? []), pr]);
  }
  return PULL_REQUEST_GROUPS.filter((g) => byGroup.has(g.id)).map((g) => ({ ...g, items: byGroup.get(g.id) }));
}

// Only "already reviewed" is filtered here; everything else is in the search query.
export function filterPullRequests({ items, filters, login, isShowingReviewed, search = "" }) {
  const hidesReviewed = isReviewScope(filters.scope) && !isShowingReviewed && !isGithubQuery(search);
  return items.filter((pr) => !(hidesReviewed && getMyReviewState({ pr, login }) === "reviewed"));
}

// Advanced search: a space means AND, so "any of" needs an explicit OR group.
const anyOf = (terms) => (terms.length <= 1 ? terms[0] ?? null : `(${terms.join(" OR ")})`);

// Review requests: me plus every team I'm in, or, with teams picked, me directly OR those teams.
const SCOPE_TERM = { mine: "author:@me", assigned: "assignee:@me", involves: "involves:@me", direct: "user-review-requested:@me" };
const REVIEW_TERM = {
  none: "review:none", required: "review:required", approved: "review:approved", changes: "review:changes_requested",
  byMe: "reviewed-by:@me", notByMe: "-reviewed-by:@me", awaitingMe: "user-review-requested:@me",
};
const SORT_TERM = { newest: "sort:created-desc", oldest: "sort:created-asc", updated: "sort:updated-desc", stale: "sort:updated-asc", comments: "sort:comments-desc" };

function scopeTerm({ scope, teams }) {
  const teamTerms = teams.map((t) => `team-review-requested:${t}`);
  if (scope === "review") return teams.length ? anyOf(["user-review-requested:@me", ...teamTerms]) : "review-requested:@me";
  return [SCOPE_TERM[scope], anyOf(teamTerms)].filter(Boolean).join(" ") || null;
}

const assigneeTerm = (assignees) => anyOf(assignees.map((a) => (a === NO_ASSIGNEE ? "no:assignee" : `assignee:${a}`)));
const CHECKS_QUALIFIER = { passing: "status:success", failing: "status:failure", pending: "status:pending" };
const quote = (value) => `"${String(value).replace(/"/g, "")}"`;

// GitHub advanced search for the filters. Picked authors or teams match any of them,
// label:"a","b" matches either label. Newest first.
// A search with a GitHub qualifier ("is:pr review-requested:me") is a query pasted from GitHub.
const QUALIFIER = /^-?[a-z-]+:\S/i;
export const isGithubQuery = (search) => search.trim().split(/\s+/).some((w) => QUALIFIER.test(w));

// A pasted query runs as GitHub would run it, in the shown repo unless it names one;
// the panel's scope and filters stay out of it.
function buildPastedQuery({ repo, search }) {
  const query = search.trim();
  const has = (pattern) => pattern.test(query);
  return [
    has(/(^|\s)repo:|(^|\s)org:|(^|\s)user:/) ? null : `repo:${repo}`,
    has(/(^|\s)(is|type):(pr|issue)\b/) ? null : "is:pr",
    query,
    has(/(^|\s)sort:/) ? null : SORT_TERM.newest,
  ].filter(Boolean).join(" ");
}

export function buildPullRequestQuery({ repo, filters, search }) {
  if (isGithubQuery(search)) return buildPastedQuery({ repo, search });
  const words = search.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/^#(\d+)$/, "$1").replace(/"/g, ""));
  return [
    `repo:${repo}`, "is:pr", "is:open",
    scopeTerm({ scope: filters.scope, teams: filters.teams }),
    anyOf(filters.authors.map((a) => `author:${a}`)),
    filters.labels.length ? `label:${filters.labels.map(quote).join(",")}` : null,
    REVIEW_TERM[filters.reviews] ?? null,
    assigneeTerm(filters.assignees),
    CHECKS_QUALIFIER[filters.checks] ?? null,
    ...words,
    // in:title keeps text matches to titles, but it would hide a search by PR number.
    words.length && !words.some((w) => /^\d+$/.test(w)) ? "in:title" : null,
    SORT_TERM[filters.sort] ?? SORT_TERM.newest,
  ].filter(Boolean).join(" ");
}

export function filterIssues({ items, filters, search }) {
  return items.filter((issue) =>
    matchesAny({ chosen: filters.statuses, values: [issue.state] })
    && matchesAny({ chosen: filters.priorities, values: [issue.priority] })
    && matchesAny({ chosen: filters.labels, values: issue.labels })
    && (filters.mine || matchesAny({ chosen: filters.assignees, values: [issue.assignee ?? UNASSIGNED] }))
    && matchesSearch({ search, fields: [issue.identifier, issue.title] }));
}

const priorityRank = (p) => (p === 0 ? NO_PRIORITY_RANK : p);
const typeRank = (type) => {
  const i = STATE_TYPE_ORDER.indexOf(type);
  return i === -1 ? STATE_TYPE_ORDER.length : i;
};

// [{ state, type, items }], in-progress groups first, each sorted by priority.
export function groupIssuesByState(items) {
  const groups = new Map();
  for (const issue of items) {
    if (!groups.has(issue.state)) groups.set(issue.state, { state: issue.state, type: issue.stateType, items: [] });
    groups.get(issue.state).items.push(issue);
  }
  const sorted = [...groups.values()].sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.state.localeCompare(b.state));
  for (const g of sorted) g.items.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  return sorted;
}

// Sorted unique values as menu options.
// Author options: the repo's people plus any author or pick not among them. The label holds
// the name too, so the filter search finds "Arrastia" as well as the login.
export function getAuthorOptions({ users, logins }) {
  const names = new Map(users.map((u) => [u.login, u.name]));
  for (const login of logins) if (login && !names.has(login)) names.set(login, "");
  return [...names.entries()]
    .map(([login, name]) => ({ value: login, label: name ? `${name} (${login})` : login }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function toOptions(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
}

// The Linear filter the API applies; the rest is filtered here.
export function buildIssueFilter(filters) {
  const filter = { state: { type: { nin: ["completed", "canceled", "duplicate"] } } };
  if (filters.mine) filter.assignee = { isMe: { eq: true } };
  if (filters.teams.length) filter.team = { id: { in: filters.teams } };
  if (filters.projects.length) filter.project = { id: { in: filters.projects } };
  return filter;
}

// Projects of the chosen teams, or every project when none is chosen.
export function getProjectOptions({ projects, teams }) {
  return projects
    .filter((p) => teams.length === 0 || p.teamIds.some((id) => teams.includes(id)))
    .map((p) => ({ value: p.id, label: p.name }));
}
