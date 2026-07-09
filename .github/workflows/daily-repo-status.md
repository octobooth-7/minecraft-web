---
description: |
  This workflow creates daily repo status reports. It gathers recent repository
  activity (issues, PRs, discussions, releases, code changes) and generates
  engaging GitHub issues with productivity insights, community highlights,
  and project recommendations.
source: "githubnext/agentics/workflows/repo-status.md@main"

on:
  schedule: daily
  workflow_dispatch:

permissions:
  contents: read
  issues: read
  pull-requests: read
  copilot-requests: write

network:
  allowed:
    - defaults
    - api.github.com

tools:
  github:
    mode: gh-proxy
    lockdown: false
    min-integrity: none
  bash: ["*"]

steps:
  - name: Fetch repository activity
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    run: |
      mkdir -p /tmp/gh-aw/data
      REPO="${{ github.repository }}"

      gh repo view "$REPO" \
        --json name,description,stargazerCount,forkCount,openIssuesCount,pushedAt \
        > /tmp/gh-aw/data/repo.json

      gh issue list --repo "$REPO" --state all --limit 20 \
        --json number,title,state,createdAt,closedAt,labels,author \
        > /tmp/gh-aw/data/issues.json

      gh pr list --repo "$REPO" --state all --limit 20 \
        --json number,title,state,createdAt,mergedAt,author \
        > /tmp/gh-aw/data/prs.json

      gh release list --repo "$REPO" --limit 5 \
        --json tagName,publishedAt,name \
        > /tmp/gh-aw/data/releases.json

      gh api "repos/$REPO/commits?per_page=10" \
        --jq '[.[] | {sha: .sha[0:7], message: (.commit.message | split("\n")[0]), author: .commit.author.name, date: .commit.author.date}]' \
        > /tmp/gh-aw/data/commits.json

safe-outputs:
  mentions: false
  allowed-github-references: []
  create-issue:
    title-prefix: "[repo-status] "
    close-older-issues: true
---

# Repo Status

Create an upbeat daily status report for the repo as a GitHub issue.

Pre-fetched repository data is available in `/tmp/gh-aw/data/`:
- `repo.json` — repository metadata (name, description, stars, forks, open issues)
- `issues.json` — recent issues (up to 20, all states)
- `prs.json` — recent pull requests (up to 20, all states)
- `releases.json` — recent releases (up to 5)
- `commits.json` — recent commits (up to 10)

## What to include

- Recent repository activity (issues, PRs, discussions, releases, code changes)
- Progress tracking, goal reminders and highlights
- Project status and recommendations
- Actionable next steps for maintainers

## Style

- Be positive, encouraging, and helpful 🌟
- Use emojis moderately for engagement
- Keep it concise - adjust length based on actual activity

## Process

1. Read the pre-fetched data from `/tmp/gh-aw/data/`
2. Synthesize the activity into a concise status report
3. Create a new GitHub issue with your findings and insights
