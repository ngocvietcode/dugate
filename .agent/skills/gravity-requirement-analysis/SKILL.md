---
name: gravity-requirement-analysis
description: 'Toggleable requirement analysis inspired by BMAD. Auto-detects task complexity, clarifies requirements, creates structured plans, and tracks task progress. Use when starting any non-trivial feature, refactoring, or multi-step work. Can be disabled via config to save tokens.'
---

# Gravity Requirement Analysis

## Overview

A scale-adaptive requirement analysis skill that adjusts depth based on task complexity. Inspired by BMAD's 4-phase agile methodology, compressed into a lightweight GravityKit-compatible format.

**Design Principle**: The user's time and tokens are precious. Trivial tasks skip all analysis. Complex tasks get full structured planning. The system auto-detects which is which, but the user always has override control.

## Toggle Configuration

Check `{project-root}/.agent/brain/project_context.json` for:

```json
{
  "requirement_analysis": {
    "enabled": true,
    "auto_detect": true,
    "complexity_threshold": "standard",
    "output_dir": "brain/requirements"
  }
}
```

**If `enabled: false`** → Skip all phases, proceed to implementation immediately.
**If config section missing** → Treat as `enabled: true, auto_detect: true, complexity_threshold: "standard"`.

### User Overrides (in-session)

- `--skip-analysis` or `--sa` → Skip requirement analysis for this task
- `--full-analysis` or `--fa` → Force full analysis regardless of complexity
- `--plan-only` → Run analysis + planning, output plan, stop before implementation

---

## Phase 0: Scope Assessment (Always Runs — <100 tokens)

**Goal**: Determine task complexity and whether analysis is needed.

### Complexity Detection Matrix

| Signal | Trivial | Standard | Complex | Enterprise |
|--------|---------|----------|---------|------------|
| Files affected | 1 | 2-5 | 6-15 | 16+ |
| Ambiguity in request | None | Minor | Significant | Fundamental |
| Cross-layer changes | No | Maybe | Yes | Multi-system |
| Breaking changes risk | None | Low | Medium | High |
| Duration estimate | <5 min | 5-30 min | 30 min-2 hr | 2+ hr |

### Decision Logic

```
IF user passed --skip-analysis → SKIP all phases
IF user passed --full-analysis → GOTO Phase 1 (full)
IF requirement_analysis.enabled == false → SKIP all phases
IF auto_detect == true:
  detected = assess_complexity(user_request)
  IF detected < complexity_threshold → SKIP (announce: "Trivial task detected, skipping analysis")
  ELSE → GOTO Phase 1
ELSE:
  → GOTO Phase 1 (always analyze when auto_detect is off)
```

---

## Phase 1: Requirement Clarification (~200-500 tokens)

**Goal**: Transform vague intent into clear, testable requirements.

### Step 1.1: Intent Extraction

From the user's request, identify:
- **What**: The deliverable or change
- **Why**: The motivation or problem being solved
- **Who**: Who benefits (end user, developer, system)
- **Constraints**: Technology, timeline, compatibility requirements

### Step 1.2: Targeted Elicitation

Ask **only** questions that resolve genuine ambiguity. Do NOT ask questions where the answer is obvious from context.

**Question Categories** (pick 2-4 most relevant):
- **Scope**: "Should this handle [edge case X]?"
- **Behavior**: "When [condition], should we [A] or [B]?"
- **Integration**: "Does this need to work with [existing system]?"
- **Quality**: "What level of error handling is needed?"
- **Data**: "What happens to existing data during this change?"

**Anti-Pattern**: Never ask more than 5 questions. If you need more than 5, your scope is too broad — recommend splitting.

### Step 1.3: Requirement Document

Create `{output_dir}/{task-name}-requirements.md`:

```markdown
---
task: {task-name}
created: {date}
complexity: {detected-level}
status: draft
---

# Requirements: {Task Title}

## Context
{1-2 sentence problem statement}

## Requirements
- [ ] REQ-1: {Specific, testable requirement}
- [ ] REQ-2: {Specific, testable requirement}
...

## Acceptance Criteria
- Given {context}, When {action}, Then {expected outcome}
- Given {context}, When {action}, Then {expected outcome}

## Constraints
- {technical/business constraints}

## Out of Scope
- {explicitly excluded items}
```

**HALT**: Present the requirements doc to the user. Ask: "Does this capture your intent? Adjust anything before I plan?"

---

## Phase 2: Plan Creation (~300-800 tokens)

**Goal**: Break requirements into an ordered, dependency-aware task list.

### Step 2.1: Architecture Assessment

**For Standard tasks**: Skip architecture, go to Step 2.2.
**For Complex/Enterprise tasks**:
- Identify affected components/layers
- Note any architecture decisions needed
- Flag breaking changes

### Step 2.2: Task Decomposition

Break requirements into atomic tasks:

```markdown
## Implementation Plan

### Tasks (ordered by dependency)

1. [ ] **{filename/component}**: {specific action}
   - Files: `path/to/file.ts`
   - Depends on: —
   - Verify: {how to confirm this task is done}

2. [ ] **{filename/component}**: {specific action}
   - Files: `path/to/file.ts`, `path/to/other.ts`
   - Depends on: Task 1
   - Verify: {how to confirm this task is done}

...
```

**Rules**:
- Each task must have a specific file path and action
- Tasks ordered by dependency (what must be done first)
- Every task has a verification step
- No placeholders or TBDs — if uncertain, ask the user
- Target 3-12 tasks. Less means the task is trivial (skip analysis next time). More means scope is too broad (recommend splitting).

### Step 2.3: Ready-for-Dev Check

Before proceeding to implementation, verify:
- [ ] Every requirement maps to at least one task
- [ ] No circular dependencies
- [ ] All tasks are actionable (specific file + action)
- [ ] Acceptance criteria are testable
- [ ] No TBDs or placeholders remain

**If any check fails**: Fix it before proceeding. Ask the user only if genuinely ambiguous.

**HALT**: Present the plan. Ask: "Plan ready. Should I proceed with implementation, or adjust something?"

---

## Phase 3: Task Tracking (Continuous — ~100 tokens/update)

**Goal**: Track progress and catch deviations during implementation.

### Status Updates

As each task is completed, update the plan:
- `[ ]` → uncompleted
- `[/]` → in progress
- `[x]` → completed

### Deviation Detection

If during implementation you discover:
- **New requirements** → Add them to the requirement doc, flag for user review
- **Blocked tasks** → Mark with `[!]` and explain blocker
- **Scope creep** → Warn: "This is expanding beyond original scope. Continue or split?"

### Completion Report

When all tasks are done:
```markdown
## Completion Summary
- Tasks completed: X/Y
- Requirements met: X/Y
- Deviations: {list or "None"}
- Known issues: {list or "None"}
- Next steps: {if any}
```

---

## Integration with GravityKit Lifecycle

This skill inserts between the **Init Phase** and **Planning Phase** in the standard lifecycle:

```
Init → [Requirement Analysis] → Planning → Work → Checkpoint → Handoff
```

When enabled, the lifecycle becomes:
1. **Init**: Load context, detect platform
2. **Requirement Analysis**: Assess → Clarify → Plan → Track
3. **Work**: Follow the plan, update tracking
4. **Checkpoint**: Save decisions, commit
5. **Handoff**: Export context, write summary

The requirement analysis artifacts are saved to `brain/requirements/` and are automatically picked up by `brain-manager` for session persistence.
