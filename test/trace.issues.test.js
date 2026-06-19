// GitHub/GitLab issues as requirement sources: pure mappers + a mock-API fetch (PR skip, state→done).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  githubIssueToRequirement, gitlabIssueToRequirement, fetchGithubRequirements, fetchGitlabRequirements,
} from '../dist/core/trace/requirements/issues.js';

test('githubIssueToRequirement: key prefix, open→not complete, closed→complete', () => {
  const open = githubIssueToRequirement({ number: 12, title: 'Login', state: 'open', html_url: 'https://gh/12' });
  assert.equal(open.key, 'GH-12');
  assert.equal(open.declaredComplete, false);
  assert.equal(open.source, 'github-issues');
  assert.equal(open.url, 'https://gh/12');
  const closed = githubIssueToRequirement({ number: 13, title: 'X', state: 'closed' }, 'REQ-');
  assert.equal(closed.key, 'REQ-13');
  assert.equal(closed.declaredComplete, true);
});

test('gitlabIssueToRequirement: uses iid, opened/closed', () => {
  assert.equal(gitlabIssueToRequirement({ iid: 5, title: 'A', state: 'opened' }).declaredComplete, false);
  assert.equal(gitlabIssueToRequirement({ iid: 6, title: 'B', state: 'closed' }).key, 'GL-6');
});

test('fetchGithubRequirements: hits the API, skips PRs, maps issues', async () => {
  const server = createServer((req, res) => {
    assert.match(req.url, /\/repos\/acme\/app\/issues/);
    assert.match(req.url, /labels=requirement/);
    const body = req.url.includes('page=1')
      ? [
          { number: 1, title: 'Login', state: 'open', html_url: 'h/1' },
          { number: 2, title: 'Logout', state: 'closed', html_url: 'h/2' },
          { number: 3, title: 'a PR', state: 'open', html_url: 'h/3', pull_request: { url: 'x' } }, // skipped
        ]
      : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const reqs = await fetchGithubRequirements({ repo: 'acme/app', label: 'requirement', baseUrl: base });
    assert.deepEqual(reqs.map((r) => r.key), ['GH-1', 'GH-2']); // PR (#3) skipped
    assert.equal(reqs.find((r) => r.key === 'GH-2').declaredComplete, true);
  } finally {
    await new Promise((ok) => server.close(ok));
  }
});

test('fetchGitlabRequirements: hits the v4 API, maps iid + state', async () => {
  const server = createServer((req, res) => {
    assert.match(req.url, /\/api\/v4\/projects\/group%2Fapp\/issues/);
    const body = req.url.includes('page=1') ? [{ iid: 7, title: 'Reset', state: 'opened', web_url: 'w/7' }] : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const reqs = await fetchGitlabRequirements({ project: 'group/app', baseUrl: base });
    assert.deepEqual(reqs.map((r) => r.key), ['GL-7']);
    assert.equal(reqs[0].declaredComplete, false);
  } finally {
    await new Promise((ok) => server.close(ok));
  }
});
