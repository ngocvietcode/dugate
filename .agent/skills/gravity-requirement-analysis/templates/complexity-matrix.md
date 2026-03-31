# Complexity Detection Matrix

## Quick Reference

Use this matrix to auto-detect task complexity. Score each signal, then use the highest category.

## Signals

### File Impact
| Score | Indicator |
|-------|-----------|
| Trivial | Single file, localized change (typo, config tweak, comment) |
| Standard | 2-5 files, single component or module |
| Complex | 6-15 files, cross-component, multiple layers (frontend + backend + DB) |
| Enterprise | 16+ files, cross-system, requires migration or breaking changes |

### Ambiguity Level
| Score | Indicator |
|-------|-----------|
| Trivial | Request is crystal clear: "fix typo in README line 42" |
| Standard | Minor clarification needed: "add validation to the form" (which form?) |
| Complex | Significant design decisions: "improve the auth system" |
| Enterprise | Fundamental uncertainty: "redesign the data pipeline" |

### Cross-Layer Impact
| Score | Indicator |
|-------|-----------|
| Trivial | Single layer only (e.g., just CSS, just a config file) |
| Standard | One layer with minor spillover (e.g., component + its test) |
| Complex | Multiple layers (API + DB + UI) |
| Enterprise | Multiple systems, services, or external integrations |

### Breaking Change Risk
| Score | Indicator |
|-------|-----------|
| Trivial | Zero risk — additive or cosmetic only |
| Standard | Low risk — isolated to internal API |
| Complex | Medium risk — public API changes, data migration |
| Enterprise | High risk — protocol changes, schema migration, multi-service coordination |

### Duration Estimate
| Score | Indicator |
|-------|-----------|
| Trivial | < 5 minutes of implementation |
| Standard | 5-30 minutes |
| Complex | 30 minutes to 2 hours |
| Enterprise | 2+ hours, likely multi-session |

## Scoring Algorithm

1. Assess each signal independently
2. Final complexity = **highest** individual score (conservative)
3. Override: User can always force a level via `--skip-analysis` or `--full-analysis`

## Example Classifications

| Request | Classification | Reasoning |
|---------|---------------|-----------|
| "Fix typo in README" | Trivial | 1 file, no ambiguity, no risk |
| "Add email validation to signup form" | Standard | 2-3 files, minor clarification, low risk |
| "Implement user authentication with OAuth" | Complex | 6+ files, significant design, medium risk |
| "Migrate from REST to GraphQL" | Enterprise | 20+ files, fundamental, high risk |
| "Add a new column to the users table" | Standard | 2-5 files (migration + model + maybe API), low risk |
| "Build a real-time notifications system" | Complex | 10+ files, cross-layer, needs architecture decisions |
