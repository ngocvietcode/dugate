# Default Skills Reference

This file documents the default skills that are auto-installed with every GravityKit group.
Agents should use these skills proactively to maintain quality, consistency, and cross-platform compatibility.

> **Lazy-Loading**: See `skills_manifest.json` for a lightweight index of ALL 893+ skills.
> Load full SKILL.md only when needed to save tokens.

## Memory & Context Skills

### brain-manager
- **Purpose**: Export/import decisions, architecture notes, and project context
- **Use when**: Starting a session (load context), ending a session (save context), making architecture decisions
- **Integration**: Reads/writes `project_context.json` and decisions log in `brain/`

### journal-manager
- **Purpose**: 2-tier knowledge journal for capturing lessons, bugs, and insights
- **Use when**: Discovering a bug pattern, learning a project convention, recording a workaround
- **Integration**: Maintains index + entries in `brain/journal/`

### context-manager
- **Purpose**: Minify and control context to save tokens
- **Use when**: Working with large codebases, long sessions, or hitting context limits
- **Integration**: Compresses context before handoff to other agents

### codebase-navigator
- **Purpose**: Index and search code quickly (Token Saver)
- **Use when**: Need to find functions, classes, or patterns without reading entire files
- **Integration**: Builds searchable index of the codebase

## Requirement Analysis & Planning Skills

### gravity-requirement-analysis ⭐
- **Purpose**: Toggleable requirement analysis — clarify requirements, create plans, track tasks
- **Use when**: Starting any non-trivial feature, refactoring, or multi-step work
- **Toggle**: Can be disabled via `project_context.json` → `requirement_analysis.enabled: false`
- **Integration**: Auto-detects complexity (trivial/standard/complex/enterprise), skips trivial tasks to save tokens. Outputs to `brain/requirements/` and `brain/plans/`
- **Inspired by**: BMAD Method's 4-phase agile workflow (Analysis → Planning → Solutioning → Implementation)

### gravity-adversarial-review
- **Purpose**: Cynical quality review + exhaustive edge case hunting
- **Use when**: Reviewing code, specs, PRDs, architecture docs, or any artifact before finalizing
- **Modes**: `--adversarial` (find 10+ issues), `--edge-cases` (JSON path analysis), or both (default)
- **Integration**: Run during Quality Gate phase in lifecycle

### gravity-implementation-readiness
- **Purpose**: Pre-implementation gate that validates planning is complete
- **Use when**: Before starting implementation of complex/enterprise tasks
- **Integration**: Checks requirement completeness, plan coverage, dependency order, no TBDs

### concise-planning
- **Purpose**: Generate clear, actionable, atomic checklists for coding tasks
- **Use when**: Before starting any feature implementation or refactoring
- **Integration**: Creates structured task breakdown with verification criteria

### writing-plans
- **Purpose**: Structured task planning with dependencies and verification
- **Use when**: Multi-step work that requires spec-to-implementation mapping
- **Integration**: Produces implementation plans with clear phase gates

## Quality Skills

### clean-code
- **Purpose**: Enforce clean code principles and best practices
- **Use when**: Writing new code, refactoring, or reviewing PRs
- **Integration**: Applied as a continuous quality check during development

### debugger
- **Purpose**: Debugging specialist for errors, test failures, and unexpected behavior
- **Use when**: Any error, test failure, or unexpected behavior encountered
- **Integration**: Use proactively before proposing fixes

### error-handling-patterns
- **Purpose**: Standard error handling patterns across languages and frameworks
- **Use when**: Implementing try/catch, error boundaries, API error responses, validation
- **Integration**: Ensures consistent error handling in all code

## Version Control Skills

### git-manager
- **Purpose**: Semantic commits and branch strategy
- **Use when**: Creating branches, writing commit messages, managing git workflow
- **Integration**: Enforces conventional commits format

### commit
- **Purpose**: Git commit best practices
- **Use when**: Staging and committing changes
- **Integration**: Validates commit message format and scope

## Cross-Platform Skills

### powershell-windows
- **Purpose**: PowerShell patterns, critical pitfalls, error handling
- **Use when**: Running commands on Windows, writing Windows-compatible scripts
- **Integration**: Prevents common PowerShell mistakes (operator syntax, path handling)

### bash-linux
- **Purpose**: Bash/Linux terminal patterns, piping, scripting
- **Use when**: Running commands on Linux/macOS, writing shell scripts
- **Integration**: Provides defensive scripting patterns

## Workflow Integration Guide

When building or optimizing workflows, agents should reference these default skills to:

1. **Session Start**: Use `brain-manager` to load previous context, check `journal-manager` for recent lessons
2. **Requirement Analysis** (if enabled): Use `gravity-requirement-analysis` to:
   - Auto-detect task complexity
   - Clarify ambiguous requirements via targeted elicitation
   - Create structured plans with atomic, ordered tasks
   - Track progress with `[ ]` / `[/]` / `[x]` markers
3. **Planning Phase**: Use `concise-planning` to break down the task, `writing-plans` for complex multi-step work
4. **Implementation**: Use `clean-code` as a quality gate, `codebase-navigator` to find relevant code quickly
5. **Error Handling**: Apply `error-handling-patterns` for robust error management
6. **Debugging**: Use `debugger` proactively when any issue is encountered
7. **Quality Gate** (optional): Use `gravity-adversarial-review` on significant changes, `gravity-implementation-readiness` before starting complex work
8. **Commit**: Use `git-manager` + `commit` for semantic commits
9. **Platform**: Check `powershell-windows` or `bash-linux` before running platform-specific commands
10. **Session End**: Use `brain-manager` to export context, `journal-manager` to log lessons learned

## Requirement Analysis Toggle

The `gravity-requirement-analysis` skill is designed to save tokens when not needed:

```json
// In project_context.json
{
  "requirement_analysis": {
    "enabled": true,         // Set to false to disable entirely
    "auto_detect": true,     // Auto-skip trivial tasks
    "complexity_threshold": "standard",  // trivial|standard|complex|enterprise
    "output_dir": "brain/requirements"
  }
}
```

**Quick overrides (per-session):**
- `--skip-analysis` or `--sa` → Skip for this task
- `--full-analysis` or `--fa` → Force full analysis
- `--plan-only` → Analyze + plan, but don't implement

## Skills Manifest (Lazy-Loading)

The file `skills_manifest.json` contains a lightweight index of ALL installed skills:
```json
{
  "skill-name": {
    "description": "One-line summary of what the skill does",
    "size_kb": 5.2
  }
}
```

**Usage pattern for agents:**
1. Read `skills_manifest.json` to find relevant skills by description
2. Load only the needed SKILL.md files (saves 40-60% context vs loading all)
3. Default skills (listed above) are always safe to load immediately

## How to Reference in Workflows

Workflow files (.md) can reference default skills using:
```
@skill[brain-manager] - Load project context before starting
@skill[gravity-requirement-analysis] - Clarify requirements and create plan
@skill[concise-planning] - Break down task into atomic checklist
@skill[gravity-adversarial-review] - Review artifact quality
@skill[gravity-implementation-readiness] - Verify plan completeness
@skill[debugger] - Debug any errors encountered
@skill[error-handling-patterns] - Apply standard error handling
```

These skills are always available regardless of which group was installed.

