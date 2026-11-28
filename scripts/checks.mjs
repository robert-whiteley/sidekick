#!/usr/bin/env node
// GitHub Actions checks from any session, laptop or cloud, through `gh api` (REST) only: cloud
// sessions reach GitHub through a proxy that refuses GraphQL, so `gh pr checks` and `gh pr view`
// don't work there, but these do.
//
//   node scripts/checks.mjs                         newest run of every workflow on this branch
//                                                   (and on main), plus this commit's checks
//   node scripts/checks.mjs run <workflow> [k=v]    start a workflow on this branch, with inputs
//                                                   (ci, codeql, ios-sim, android-emu, store-status)
//   node scripts/checks.mjs log <run id>            each job's result, and the log of what failed
//
// Store builds (release.yml) are not started from here: `gh workflow run release.yml` asks the
// owner first (scripts/claude-guard.py).
import { execFileSync } from 'node:child_process';

const sh = (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function repo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = sh('git', ['remote', 'get-url', 'origin']);
  const m = /([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
  if (!m) throw new Error(`can't tell the repository from ${url}`);
  return `${m[1]}/${m[2]}`;
}
const REPO = repo();
const api = (path, ...extra) => sh('gh', ['api', ...extra, `repos/${REPO}/${path}`]);
const json = (path) => JSON.parse(api(path));
const branch = () => sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
const age = (t) => {
  const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
  return m < 90
    ? `${m} min ago`
    : m < 2880
      ? `${Math.round(m / 60)} h ago`
      : `${Math.round(m / 1440)} d ago`;
};
const state = (r) => r.conclusion || r.status;

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd) {
  const here = branch();
  const sha = sh('git', ['rev-parse', 'HEAD']);
  const { workflows } = json('actions/workflows?per_page=100');
  for (const b of [...new Set([here, 'main'])]) {
    console.log(`${b}:`);
    for (const w of workflows.filter((x) => x.state === 'active')) {
      const { workflow_runs: runs } = json(
        `actions/workflows/${w.id}/runs?per_page=1&branch=${encodeURIComponent(b)}`,
      );
      const r = runs[0];
      if (r)
        console.log(
          `  ${w.name.padEnd(28)} ${state(r).padEnd(12)} ${String(r.id).padEnd(12)} ${r.head_sha.slice(0, 7)} ${age(r.created_at)}`,
        );
    }
  }
  const { check_runs: checks } = json(`commits/${sha}/check-runs?per_page=100`);
  if (checks.length) {
    console.log(`checks on ${sha.slice(0, 7)}:`);
    for (const c of checks) console.log(`  ${c.name.padEnd(28)} ${state(c)}`);
  }
} else if (cmd === 'run') {
  const [name, ...pairs] = rest;
  if (!name) throw new Error('usage: run <workflow> [key=value ...]');
  const file = /\.ya?ml$/.test(name) ? name : `${name}.yml`;
  if (/^release\.ya?ml$/.test(file))
    throw new Error(
      "Store builds: `gh workflow run release.yml -f track=alpha` (needs the owner's OK).",
    );
  const args = ['-X', 'POST', '-f', `ref=${branch()}`];
  for (const p of pairs) {
    const i = p.indexOf('=');
    if (i < 1) throw new Error(`input ${p}: use key=value`);
    args.push('-f', `inputs[${p.slice(0, i)}]=${p.slice(i + 1)}`);
  }
  api(`actions/workflows/${file}/dispatches`, ...args);
  // The new run shows up a moment later.
  for (let i = 0; i < 10; i++) {
    sh('sleep', ['3']);
    const { workflow_runs: runs } = json(
      `actions/workflows/${file}/runs?per_page=1&event=workflow_dispatch&branch=${encodeURIComponent(branch())}`,
    );
    if (runs[0] && Date.now() - new Date(runs[0].created_at).getTime() < 60000) {
      console.log(`started ${file}: run ${runs[0].id} ${runs[0].html_url}`);
      process.exit(0);
    }
  }
  console.log(`started ${file}; its run id isn't listed yet (node scripts/checks.mjs)`);
} else if (cmd === 'log') {
  const id = rest[0];
  if (!/^\d+$/.test(id ?? '')) throw new Error('usage: log <run id>');
  const run = json(`actions/runs/${id}`);
  console.log(
    `${run.name} ${state(run)} ${run.head_branch} ${run.head_sha.slice(0, 7)} ${run.html_url}`,
  );
  const { jobs } = json(`actions/runs/${id}/jobs?per_page=100`);
  for (const j of jobs) {
    console.log(`  ${j.name}: ${state(j)}`);
    for (const s of j.steps ?? [])
      if (s.conclusion === 'failure') console.log(`    failed: ${s.name}`);
    if (j.conclusion === 'failure') {
      const log = api(`actions/jobs/${j.id}/logs`);
      console.log(log.split('\n').slice(-80).join('\n'));
    }
  }
} else {
  console.error('usage: node scripts/checks.mjs [run <workflow> [k=v ...] | log <run id>]');
  process.exit(2);
}
