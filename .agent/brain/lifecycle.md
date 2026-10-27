# Session Lifecycle

> Reference: See `default_skills.md` for the full list of default skills always available.

## Init Phase
- Detect platform (Windows/Linux/macOS) → use `powershell-windows` or `bash-linux`
- Load `project_context.json` via `brain-manager` for project awareness
- Check `journal-manager` for recent decisions, lessons, and known issues
- Build codebase index via `codebase-navigator` if not cached

## Requirement Analysis Phase (Optional — toggle via project_context.json)

> **Toggle**: Set `requirement_analysis.enabled` to `false` in `project_context.json` to skip.
> **Auto-detect**: When `auto_detect: true`, trivial tasks are auto-skipped to save tokens.
> **User override**: Pass `--skip-analysis` to skip, `--full-analysis` to force.

When enabled and task complexity >= threshold:

1. **Scope Assessment**: Auto-detect complexity (trivial/standard/complex/enterprise)
   - Use `gravity-requirement-analysis` complexity matrix
   - If trivial → skip to Planning Phase
2. **Clarify Requirements**: Targeted elicitation via `gravity-requirement-analysis`
   - Extract intent, constraints, acceptance criteria
   - Output: `brain/requirements/{task-name}-requirements.md`
3. **Create Plan**: Atomic task breakdown with dependencies
   - Output: `brain/plans/{task-name}-plan.md`
4. **Readiness Check** (complex/enterprise only): Use `gravity-implementation-readiness`
   - Verify requirements ↔ tasks alignment
   - Ensure no TBDs, no broken dependencies

## Planning Phase
- Use `concise-planning` to break user request into atomic checklist
- For complex multi-step tasks, use `writing-plans` to create implementation plan
- Cross-reference `default_skills.md` to identify which skills to leverage
- Check platform compatibility via `platform_notes.md`

## Work Phase
- Follow the plan from Requirement Analysis (if created) or Planning Phase
- Follow `clean-code` principles throughout all code changes
- Use `codebase-navigator` to find relevant code without reading entire files
- Use `context-manager` to compress context when approaching token limits
- Use `debugger` proactively when encountering any error or unexpected behavior
- Update task tracking: `[ ]` → `[/]` → `[x]` as tasks complete

## Quality Gate (optional, for complex tasks)
- Run `gravity-adversarial-review` on significant code changes
- Check for edge cases, missing error handling, security gaps
- Verify all acceptance criteria from requirements are met

## Checkpoint (after each significant change)
- Save decisions to `brain-manager`
- Log new lessons and insights to `journal-manager`
- Update `project_context.json` if architecture or conventions changed
- Commit with `git-manager` + `commit` (semantic commits)

## Handoff (session end)
- Export full context via `brain-manager`
- Write handoff notes in `journal-manager` with session summary
- Update `project_context.json` current_sprint status
- Create summary: work completed, known issues, next steps

