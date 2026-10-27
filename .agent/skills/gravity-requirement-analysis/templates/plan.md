---
task: "{task-name}"
created: "{date}"
requirements_ref: "{path-to-requirements-file}"
status: "planning"
total_tasks: 0
completed_tasks: 0
---

# Implementation Plan: {Task Title}

## Architecture Decisions

{Skip this section for Standard-complexity tasks}

- **Decision**: {what was decided}
  - **Rationale**: {why this approach}
  - **Alternatives considered**: {what was rejected and why}

## Tasks (ordered by dependency)

1. [ ] **{Component/File}**: {Specific action}
   - Files: `path/to/file.ext`
   - Depends on: —
   - Verify: {How to confirm done}

2. [ ] **{Component/File}**: {Specific action}
   - Files: `path/to/file.ext`
   - Depends on: Task 1
   - Verify: {How to confirm done}

## Ready-for-Dev Checklist

- [ ] Every requirement maps to at least one task
- [ ] No circular dependencies
- [ ] All tasks are actionable (specific file + action)
- [ ] Acceptance criteria are testable
- [ ] No TBDs or placeholders remain

## Completion Summary

_Updated automatically during implementation_

- Tasks completed: 0/{total}
- Requirements met: 0/{total}
- Deviations: None
- Known issues: None
- Next steps: —
