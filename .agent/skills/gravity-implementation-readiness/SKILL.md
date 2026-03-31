---
name: gravity-implementation-readiness
description: 'Pre-implementation gate that validates requirements, architecture, and task breakdown are complete and aligned. Use before starting implementation of complex features to catch planning gaps early.'
---

# Gravity Implementation Readiness

## Overview

A quality gate adapted from BMAD's `bmad-check-implementation-readiness`. Validates that all planning artifacts are complete, consistent, and actionable before implementation begins.

**Use when**: Before starting implementation of any `complex` or `enterprise` level task. Optional for `standard` tasks.

**Your Role**: You are an expert Product Manager and Scrum Master, renowned for spotting gaps in planning. Your success is measured by catching failures **before** they become code problems.

## Activation

This skill can be invoked:
1. **Automatically** — by `gravity-requirement-analysis` after Phase 2 (Plan Creation) for complex/enterprise tasks
2. **Manually** — user invokes `check implementation readiness` or `readiness check`
3. **As part of a workflow** — called by leader/planner workflows before delegating to dev agents

## Inputs

- **Requirements document** — `brain/requirements/{task-name}-requirements.md`
- **Implementation plan** — `brain/plans/{task-name}-plan.md` (or equivalent plan artifact)
- **Architecture decisions** — if any were documented
- **Existing codebase context** — project_context.json, relevant source files

## Execution

### Step 1: Document Discovery

Search for planning artifacts in order:
1. `brain/requirements/` — requirement documents
2. `brain/plans/` — implementation plans
3. `brain/` — any planning markdown files
4. Current conversation context — if plans were discussed but not saved

If no planning artifacts found:
- Ask: "I don't see any planning documents. Should I help create them first?"
- Offer to invoke `gravity-requirement-analysis`

### Step 2: Requirements Completeness Check

For each requirement in the requirements doc:

| Check | Pass Criteria |
|-------|---------------|
| **Specificity** | No vague terms like "improve", "optimize", "enhance" without measurable criteria |
| **Testability** | Every requirement has a corresponding acceptance criterion |
| **No Placeholders** | Zero instances of TBD, TODO, "to be determined", or `{placeholder}` |
| **No Conflicts** | Requirements don't contradict each other |
| **Scope Clarity** | "Out of Scope" section exists and is non-empty |

### Step 3: Plan Completeness Check

For each task in the implementation plan:

| Check | Pass Criteria |
|-------|---------------|
| **File Path** | Every task specifies at least one target file |
| **Action Specificity** | Actions are concrete: "add", "create", "modify", "delete" — not "think about", "consider" |
| **Dependency Order** | Tasks are ordered by dependency; no task depends on a later task |
| **Verification** | Every task has a verification step |
| **Coverage** | Every requirement maps to at least one task |
| **No Orphans** | No tasks exist that don't trace back to a requirement |

### Step 4: Architecture Check (Complex/Enterprise only)

| Check | Pass Criteria |
|-------|---------------|
| **Decisions Documented** | Key architecture decisions are recorded with rationale |
| **Alternatives Considered** | At least one alternative was evaluated |
| **Breaking Changes** | Any breaking changes are explicitly identified with migration path |
| **Integration Points** | Interfaces with external systems are defined |

### Step 5: Readiness Report

Generate the readiness assessment:

```markdown
## Implementation Readiness Report

### Status: ✅ READY / ⚠️ READY WITH WARNINGS / ❌ NOT READY

### Requirements Check
- Total requirements: {N}
- Specific & testable: {N}/{total} ✅
- Issues found: {list or "None"}

### Plan Check
- Total tasks: {N}
- Actionable (file + action): {N}/{total} ✅
- Dependency order valid: ✅/❌
- Full coverage: ✅/❌
- Issues found: {list or "None"}

### Architecture Check (if applicable)
- Decisions documented: ✅/❌
- Breaking changes identified: ✅/❌/N/A
- Issues found: {list or "None"}

### Recommendations
1. {Fix this before starting}
2. {Fix this before starting}

### Verdict
{One sentence: "Ready to implement" or "Fix N issues before proceeding"}
```

### Decision Logic

| Condition | Verdict |
|-----------|---------|
| All checks pass | ✅ READY — proceed to implementation |
| Only minor issues (style, non-blocking) | ⚠️ READY WITH WARNINGS — proceed but note the warnings |
| Any critical issue (missing requirements, broken dependencies, TBDs) | ❌ NOT READY — fix issues first |

**HALT on ❌ NOT READY**: Present the issues and ask user how to proceed:
1. Fix the issues now
2. Proceed anyway (user accepts the risk)
3. Run `gravity-requirement-analysis` to redo planning

## Integration

This skill works best when combined with:
- `gravity-requirement-analysis` — produces the artifacts this skill validates
- `gravity-adversarial-review` — provides complementary quality analysis
- `concise-planning` / `writing-plans` — existing GravityKit planning skills
