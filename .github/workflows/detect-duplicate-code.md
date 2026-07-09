---
description: |
  Daily workflow that uses LSP semantic analysis to detect duplicate code in the
  repository's JavaScript source files and opens a Copilot-assigned issue with
  an agentic prompt to refactor the duplicates.
emoji: 🔍

on:
  schedule: daily
  workflow_dispatch:

permissions:
  contents: read
  issues: read
  pull-requests: read
  copilot-requests: write

imports:
  - uses: shared/mcp/serena.md
    with:
      languages: ["typescript"]

network:
  allowed:
    - defaults
    - node

tools:
  github:
    mode: gh-proxy
    toolsets: [default]
  bash: ["*"]

safe-outputs:
  create-issue:
    title-prefix: "[duplicate-code] "
    labels: [refactor, duplicate-code, agentic]
    assignees: [copilot]
    close-older-issues: true
    deduplicate-by-title: true
---

# Duplicate Code Detector

## Goal

Scan the JavaScript source files in this repository for semantically duplicate or near-duplicate code blocks and open a Copilot-assigned issue with a precise refactoring prompt.

## Files to Analyse

The repository contains these JavaScript source files:
- `main.js` — core game logic
- `multiplayer.js` — multiplayer layer

## Steps

1. **Activate LSP** — call `activate_project` on the repository root before any other LSP tool.

2. **Discover symbols** — use `get_symbols_overview` on each `.js` file to list all top-level functions, classes, and methods.

3. **Identify duplicates** — for each symbol, use `find_referencing_code_snippets` and compare function bodies using semantic analysis. Look for:
   - Functions with identical or near-identical bodies (>70% structural similarity)
   - Repeated inline logic blocks (>10 lines) that appear in two or more places
   - Copy-pasted event-handler patterns with minor variations

4. **Collect evidence** — for each duplicate pair/group found, record:
   - File path and line numbers for each occurrence
   - Symbol name (if named) or a short code excerpt
   - Estimated lines of code that could be eliminated

5. **Evaluate findings** — if no meaningful duplicates are found (all code is unique or differences are intentional), call `noop` with a brief explanation and stop.

6. **Create a Copilot issue** — if duplicates are found, create a GitHub issue using the `create-issue` safe output. The issue must:

   - Have a descriptive title (e.g. `Refactor duplicate render logic in main.js and multiplayer.js`)
   - Begin with a brief summary table of all duplicate groups found
   - Include a section **"Agentic Refactor Prompt"** containing an exact, copy-pasteable prompt that Copilot can act on directly:

     ```
     ## Copilot Task

     The following duplicate code groups were detected by static analysis. Please:
     1. Extract each group into a shared helper function at an appropriate location.
     2. Replace all duplicate occurrences with calls to the new helper.
     3. Ensure existing behaviour is preserved (no logic changes).
     4. Keep changes minimal — only refactor the listed duplicates.

     ### Duplicates to fix
     <list each group with file:line references>
     ```

   - Include file paths and line numbers for every duplicate occurrence
   - Stay within 20–65000 characters

## No-Op Criteria

Call `noop` (with a one-sentence explanation) when:
- No duplicate code groups are found
- All detected similarities are intentional (e.g. mirrored interfaces, intentional repetition)
- LSP startup fails — fall back to text search and if still no duplicates, call `noop`
