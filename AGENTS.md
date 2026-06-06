# Roughdraft Agent Instructions

## Testing Principles

Use the repo-local `test-desiderata` skill when planning, adding, changing, or reviewing tests. Keep the core bar visible even when the skill is not loaded: tests should optimize for Kent Beck's Test Desiderata (https://testdesiderata.com/) as context-specific tradeoffs, not as a mechanical checklist.

Before finalizing test work, check that the tests are:

- Isolated: results do not depend on execution order or shared mutable state.
- Composable: tests combine without hidden coupling.
- Deterministic: unchanged code and inputs produce the same result every run.
- Fast: tests are quick enough to run during normal development.
- Writable: tests are cheap to create relative to the behavior protected.
- Readable: tests make their motivation and expected behavior clear.
- Behavioral: tests fail when the behavior under test changes.
- Structure-insensitive: tests survive internal refactors that preserve behavior.
- Automated: tests run without manual intervention.
- Specific: failures point clearly at the broken behavior.
- Predictive: passing tests justify confidence in production behavior.
- Inspiring: the suite increases confidence instead of creating noise or avoidance.

Prefer the fastest test that remains predictive. Escalate to integration or e2e coverage when the boundary itself is the behavior under test, and make any meaningful tradeoff explicit in the final summary.

`docs/solutions/` contains documented solutions to past problems, organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). It is relevant context when implementing, debugging, or choosing tests in documented areas.

## Bug Fix Workflow

When the user asks you to fix something, first have a subagent reproduce the bug with a failing test case before implementing the fix. The subagent should focus on the smallest behavioral test that demonstrates the problem, and should report the failing command, changed test files, and why the failure captures the requested bug.

### Prove It Pattern

For every bug fix:

1. Reproduce the failure before changing production code. Prefer the smallest automated test that exercises the actual buggy path and fails for the reported behavior.
2. If the bug crosses a boundary such as the OS, browser, CLI subprocess, filesystem watcher, network, or a third-party tool, also run a realistic command or flow that exercises that boundary. A mocked unit test can cover branching logic, but it does not prove the external command syntax, output shape, permissions, launch behavior, or integration contract.
3. Implement the fix.
4. Rerun the failing test or realistic reproduction and confirm it now passes.
5. Run the narrow relevant test command first, then the broader check when the change is broad enough to justify it.

If a realistic reproduction is infeasible, document why before proceeding and include the remaining verification gap in the final summary.

### Realistic Verification Before Handoff

Before asking the user to test or review a change, verify the riskiest changed behavior with the most realistic feasible check:

- For CLI behavior, run the actual worktree CLI or the exact subprocess command it will invoke.
- For browser behavior, open the affected route in a real browser automation flow when possible.
- For OS integration, run the target OS command directly and inspect its real output.
- For file-backed behavior, exercise the real file path, watcher, or save/load cycle.
- For external APIs or libraries, verify against official docs or a real local integration point rather than only mocked assumptions.

Mocked tests are still useful, but they are not a substitute when the boundary itself is the product behavior.

In the final response, list the verification commands run, what each proved, and any residual realism gap.

## Slog Default

This repo vendors the `slog` skill at `.codex/skills/slog`.

Treat `slog` as a default self-verification tool in this repo.

- Use `slog` when fixing bugs.
- Use `slog` when building new features.
- Use `slog` during planning when you need to verify your understanding of the current code path before changing it.
- Default pattern: mint a fresh run, add focused logs around the decision points, exercise the path, read the log file, and summarize what the logs prove.
- Prefer `slog` over guesswork when the task depends on how the code actually behaves at runtime.

Basic workflow:

```bash
bun .codex/skills/slog/scripts/slog.ts new <label>
```

- Restart any long-running local services after creating the run so they pick up `.context/slog/current.env`.
- For one-shot commands, source or export `.context/slog/current.env` before running the command.
- Inspect the latest file with:

```bash
bun .codex/skills/slog/scripts/slog.ts latest file
```

## UI Components

Always use shadcn for UI work in this repo. Prefer existing components in `packages/app/src/components/ui/`; when a needed primitive is missing, add it there in the same shadcn style before wiring it into product code.

## UI Screenshot Guide

When changing UI behavior, routes, dialogs, popovers, banners, editor modes, review rail states, or visual error/empty states, update `docs/spec/ui-state-screenshot-guide.md` if the change adds, removes, or materially changes a state that should be captured for visual review.

Keep generated screenshot runs in `.context/ui-state-screenshots/` unless the user explicitly asks to commit visual artifacts.

## Worktree-Specific CLI

This repo installs a worktree-specific Roughdraft CLI wrapper during setup.

- `roughdraft` is the published npm package
- `roughdraft-dev-<worktree-name>` is the local CLI for one specific checkout
- In this checkout, plain `roughdraft` should resolve to the local shim at `~/.local/bin/roughdraft`, which points to `~/.local/bin/roughdraft-dev-roughdraft-markdown`. Prefer that local shim over the published/global install.

In a fresh worktree, `pnpm setup` runs `pnpm dev:install-cli`, which creates a wrapper in `~/.local/bin` by default.

To derive the correct command for the current checkout, use the git worktree root, then take its basename:

```bash
worktree_root="$(git rev-parse --show-toplevel)"
worktree_name="$(basename "$worktree_root")"
roughdraft_cmd="roughdraft-dev-$worktree_name"
```

Example in this checkout:

```bash
roughdraft-dev-roughdraft-markdown start
```

Do not use the global published `roughdraft` command for repo-local development in this repo unless the user explicitly asks for the published package. If `command -v roughdraft` does not resolve to `~/.local/bin/roughdraft`, use `roughdraft-dev-roughdraft-markdown` directly.

## Fallback If The Wrapper Is Missing

Setup should install the wrapper automatically, but if the command is missing:

```bash
cd "$(git rev-parse --show-toplevel)"
pnpm dev:install-cli
```

Then recompute `roughdraft_cmd` and use it.

## Pull Request Workflow

Before creating or updating a PR:

1. Run `pnpm check`.
2. Run `pnpm test:smoke`, especially after UI, routing, editor, file-backend, or workflow changes. This mirrors the browser smoke step in CI and is not covered by `pnpm check`.
3. Fix any lint, format, test, smoke, or build failures.
4. Confirm `git status --short` only shows intended changes.
5. Make sure the current branch name is descriptive. If it is random or unclear, rename it before pushing.
6. Rebase the current branch on the latest `origin/main`.
7. Commit and push.
8. Create the PR with `gh pr create --base main`.
9. If the PR resolves GitHub issues, include closing keywords such as `Fixes #123` in the PR body.

## Plan Writing Workflow

When the user asks for a plan, write the plan as a Markdown file in `.context/` so it is easy to review, revise, and keep out of commits.

Before writing the plan:

1. Read every ADR in `docs/adr/` if that directory exists.
2. Read the code, tests, and docs needed to ground the plan in the current implementation.
3. Use `slog` if runtime behavior needs verification before the plan can be accurate.

Plan file guidelines:

- Use a concrete, task-specific filename such as `.context/markdown-smoke-tests-plan.md`.
- Include goals, non-goals, proposed file changes, test strategy, risks, and suggested implementation order.
- Keep product-boundary decisions aligned with the ADRs; if the plan needs to change a recorded decision, call that out explicitly.
- Use CriticMarkup for inline review notes when helpful.

After writing the plan, open it in Roughdraft for review:

```bash
worktree_root="$(git rev-parse --show-toplevel)"
worktree_name="$(basename "$worktree_root")"
roughdraft_cmd="roughdraft-dev-$worktree_name"
"$roughdraft_cmd" start
"$roughdraft_cmd" open "$worktree_root/.context/<plan-file>.md"
```

After the user finishes reviewing in Roughdraft, read the plan file from disk and address any CriticMarkup feedback before implementing.

## Implementation Notes Workflow

When implementing a plan or spec, keep a running implementation notes file in `.context/` by default, such as `.context/implementation-notes.md` or a task-specific filename like `.context/markdown-smoke-tests-implementation-notes.md`.

Use the notes file to record how reality diverged from the plan or what the plan did not cover:

- Decisions you had to make that were not specified.
- Product, design, architecture, or testing tradeoffs you made.
- Parts of the plan or spec that had to change once you read or ran the code.
- Important constraints, follow-up work, or risks the user should know about.

Update the notes as you implement, not only at the end. In the final response, mention the implementation notes file and summarize the most important deviations or decisions.

## Roughdraft Workflow

Use Roughdraft when the user wants to open, review, or comment on a Markdown file.

The user may refer to Roughdraft as `rd` in natural language. Treat `rd` as shorthand for Roughdraft in user requests, but do not create or modify any shell alias, executable, symlink, or command named `rd`.

Preferred flow:

1. Derive `roughdraft_cmd` for the current worktree.
2. Start the local server if needed:

```bash
"$roughdraft_cmd" start
```

3. Open the relevant Markdown file:

```bash
"$roughdraft_cmd" open "/absolute/path/to/file.md"
```

4. After the user finishes reviewing in Roughdraft, read the markdown file from disk and make the requested changes there.

Useful commands:

```bash
"$roughdraft_cmd" status
"$roughdraft_cmd" stop
"$roughdraft_cmd" help
```

## CriticMarkup

Use CriticMarkup when reading or writing inline review feedback in markdown:

- Comment: `{>>comment<<}`
- Insertion: `{++new text++}`
- Deletion: `{--old text--}`
- Substitution: `{~~old~>new~~}`
- Highlight: `{==text==}`

When adding new review feedback, prefer compact inline references plus final YAML endmatter:

```markdown
{==selected text==}{>>Comment text<<}{#c1}
{++new text++}{#s1}

---
comments:
  c1:
    by: AI
    at: "2026-04-28T12:00:00.000Z"
  c2:
    body: I can make that edit.
    by: AI
    at: "2026-04-28T12:05:00.000Z"
    re: c1
suggestions:
  s1:
    by: AI
    at: "2026-04-28T12:10:00.000Z"
```

Older inline attribute blocks such as `{id="c1" by="AI" at="2026-04-28T12:00:00.000Z"}` may appear in existing documents. Preserve them unless you are intentionally rewriting that review item.
