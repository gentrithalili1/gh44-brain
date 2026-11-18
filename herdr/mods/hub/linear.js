// Linear data through the user's own `linear` CLI login (`linear api`).
import { exec } from "herdr";
import { buildIssueFilter } from "./filters.js";

const ISSUE_LIMIT = 100;

const ISSUES_QUERY = `query($filter: IssueFilter, $first: Int) {
  issues(filter: $filter, first: $first, orderBy: updatedAt) {
    nodes {
      id identifier title url branchName priority createdAt updatedAt
      state { name type }
      team { id key }
      project { id name }
      assignee { name isMe }
      labels { nodes { name color } }
      attachments(first: 10) { nodes { url } }
    }
  }
}`;

const META_QUERY = `query {
  teams(first: 100) { nodes { id key name } }
  projects(first: 200, filter: { status: { type: { nin: ["completed", "canceled"] } } }) {
    nodes { id name teams { nodes { id } } }
  }
}`;

const toIssue = (n) => ({
  id: n.id,
  identifier: n.identifier,
  title: n.title,
  url: n.url,
  branch: n.branchName,
  priority: n.priority,
  createdAt: n.createdAt,
  updatedAt: n.updatedAt,
  state: n.state?.name ?? "",
  stateType: n.state?.type ?? "",
  team: n.team?.key ?? "",
  teamId: n.team?.id ?? null,
  project: n.project?.name ?? null,
  assignee: n.assignee?.name ?? null,
  labels: (n.labels?.nodes ?? []).map((l) => l.name),
  labelColors: Object.fromEntries((n.labels?.nodes ?? []).map((l) => [l.name, l.color])),
  // The newest GitHub PR attached to the issue, if any.
  prUrl: (n.attachments?.nodes ?? []).map((a) => a.url).filter((u) => /github\.com\/.+\/pull\/\d+/.test(u)).at(-1) ?? null,
});

async function request({ query, variables }) {
  try {
    const args = ["api", query, "--no-input", ...(variables ? ["--variables-json", JSON.stringify(variables)] : [])];
    const r = await exec("linear", args);
    let body = null;
    try { body = JSON.parse(r.stdout); } catch { body = null; }
    const error = body?.errors?.[0];
    if (error?.extensions?.type === "authentication error" || /auth/i.test(r.stderr)) return { status: "error", reason: "auth" };
    if (error || !body?.data) return { status: "error", reason: "failed", message: error?.message ?? (r.stderr || r.stdout).trim().split("\n")[0] };
    return { status: "success", data: body.data };
  } catch (error) {
    return { status: "error", reason: "failed", message: String(error?.message ?? error) };
  }
}

export async function loadIssues(filters) {
  const r = await request({ query: ISSUES_QUERY, variables: { filter: buildIssueFilter(filters), first: ISSUE_LIMIT } });
  if (r.status !== "success") return r;
  return { status: "success", items: r.data.issues.nodes.map(toIssue), isCapped: r.data.issues.nodes.length >= ISSUE_LIMIT };
}

// Teams and open projects for the filter menus.
export async function loadLinearMeta() {
  const r = await request({ query: META_QUERY });
  if (r.status !== "success") return r;
  return {
    status: "success",
    teams: r.data.teams.nodes.map((t) => ({ value: t.id, label: `${t.name} (${t.key})` })).sort((a, b) => a.label.localeCompare(b.label)),
    projects: r.data.projects.nodes.map((p) => ({ id: p.id, name: p.name, teamIds: p.teams.nodes.map((t) => t.id) })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const STARTED_STATES_QUERY = `query($id: String!) {
  team(id: $id) { states(filter: { type: { eq: "started" } }) { nodes { id name position } } }
}`;

const MOVE_ISSUE_MUTATION = `mutation($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success }
}`;

// Moves an issue to its team's first started status that is not a review one ("In Progress").
export async function moveIssueToInProgress(issue) {
  const r = await request({ query: STARTED_STATES_QUERY, variables: { id: issue.teamId } });
  if (r.status !== "success") return r;
  const state = r.data.team.states.nodes
    .filter((st) => !/review/i.test(st.name))
    .sort((a, b) => a.position - b.position)[0];
  if (!state) return { status: "error", reason: "failed", message: "No started status in the team" };
  const m = await request({ query: MOVE_ISSUE_MUTATION, variables: { id: issue.id, stateId: state.id } });
  if (m.status !== "success") return m;
  return { status: "success", state: state.name };
}
