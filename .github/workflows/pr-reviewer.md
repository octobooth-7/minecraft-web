---
emoji: 🔍
description: Reviews pull requests for code quality, security issues, and logic when marked ready for review or updated with new commits.
on:
  pull_request:
    types: [ready_for_review, synchronize]
permissions:
  contents: read
  pull-requests: read
  copilot-requests: write
tools:
  github:
    mode: gh-proxy
    toolsets:
      - pull_requests
steps:
  - name: Fetch PR diff and file list
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    run: |
      mkdir -p /tmp/gh-aw/data
      gh pr view ${{ github.event.pull_request.number }} \
        --json title,body,headRefName,baseRefName,additions,deletions,changedFiles \
        > /tmp/gh-aw/data/pr-meta.json
      gh pr diff ${{ github.event.pull_request.number }} \
        > /tmp/gh-aw/data/pr-diff.patch
safe-outputs:
  submit-pull-request-review: {}
  add-comment:
    pull-requests: true
network:
  allowed:
    - defaults
---

# 🔍🤖 PR Reviewer

## 📋 Task

A pull request was opened or updated. Review it for code quality, security issues, and logic. 🎯

Read the pre-fetched data:
- 📄 PR metadata: `/tmp/gh-aw/data/pr-meta.json`
- 🔀 Full diff: `/tmp/gh-aw/data/pr-diff.patch`

### 🧪 Review criteria

Evaluate the diff against these criteria:

1. ✨ **Code quality** — naming, readability, duplication, unnecessary complexity.
2. 🔐 **Security** — hardcoded secrets, injection risks, unsafe input handling, exposed sensitive data.
3. 🧠 **Logic** — correctness of algorithms, off-by-one errors, missing edge cases, incorrect conditionals.

### 📝 Output

1. Submit a pull request review (`submit-pull-request-review`) with inline comments 💬 on specific lines where issues are found.
   - Each comment must cite the exact file and line, and explain the problem concisely.
   - Only comment where a genuine issue exists — do not comment on style trivialities.
2. Add a summary comment (`add-comment`) on the PR with:
   - 📊 A brief overall assessment (1–2 sentences).
   - 🔎 A bullet list of the most important findings (max 5).
   - A verdict: **✅ Looks good**, **⚠️ Minor issues**, or **🚫 Needs changes**.

If there are no issues to report, call `noop` with reason `"🎉 No issues found in this PR"` and skip both outputs.

## 🛡️ Safe Outputs

- 💬 Use `submit-pull-request-review` for all inline code-level comments.
- 📣 Use `add-comment` for the overall summary.
- 🙅 Call `noop` with a short reason when no action is needed.
