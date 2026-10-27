# Role: bmad-distillator

## File: SKILL.md

---
name: bmad-distillator
description: Lossless LLM-optimized compression of source documents. Use when the user requests to 'distill documents' or 'create a distillate'.
argument-hint: "[to create provide input paths] [--validate distillate-path to confirm distillate is lossless and optimized]"
---

# Distillator: A Document Distillation Engine

## Overview

This skill produces hyper-compressed, token-efficient documents (distillates) from any set of source documents. A distillate preserves every fact, decision, constraint, and relationship from the sources while stripping all overhead that humans need and LLMs don't. Act as an information extraction and compression specialist. The output is a single dense document (or semantically-split set) that a downstream LLM workflow can consume as sole context input without information loss.

This is a compression task, not a summarization task. Summaries are lossy. Distillates are lossless compression optimized for LLM consumption.

## On Activation

1. **Validate inputs.** The caller must provide:
   - **source_documents** (required) — One or more file paths, folder paths, or glob patterns to distill
   - **downstream_consumer** (optional) — What workflow/agent consumes this distillate (e.g., "PRD creation", "architecture design"). When provided, use it to judge signal vs noise. When omitted, preserve everything.
   - **token_budget** (optional) — Approximate target size. When provided and the distillate would exceed it, trigger semantic splitting.
   - **output_path** (optional) — Where to save. When omitted, save adjacent to the primary source document with `-distillate.md` suffix.
   - **--validate** (flag) — Run round-trip reconstruction test after producing the distillate.

2. **Route** — proceed to Stage 1.

## Stages

| # | Stage | Purpose |
|---|-------|---------|
| 1 | Analyze | Run analysis script, determine routing and splitting |
| 2 | Compress | Spawn compressor agent(s) to produce the distillate |
| 3 | Verify & Output | Completeness check, format check, save output |
| 4 | Round-Trip Validate | (--validate only) Reconstruct and diff against originals |

### Stage 1: Analyze

Run `scripts/analyze_sources.py --help` then run it with the source paths. Use its routing recommendation and grouping output to drive Stage 2. Do NOT read the source documents yourself.

### Stage 2: Compress

**Single mode** (routing = `"single"`, ≤3 files, ≤15K estimated tokens):

Spawn one subagent using `agents/distillate-compressor.md` with all source file paths.

**Fan-out mode** (routing = `"fan-out"`):

1. Spawn one compressor subagent per group from the analysis output. Each compressor receives only its group's file paths and produces an intermediate distillate.

2. After all compressors return, spawn one final **merge compressor** subagent using `agents/distillate-compressor.md`. Pass it the intermediate distillate contents as its input (not the original files). Its job is cross-group deduplication, thematic regrouping, and final compression.

3. Clean up intermediate distillate content (it exists only in memory, not saved to disk).

**Graceful degradation:** If subagent spawning is unavailable, read the source documents and perform the compression work directly using the same instructions from `agents/distillate-compressor.md`. For fan-out, process groups sequentially then merge.

The compressor returns a structured JSON result containing the distillate content, source headings, named entities, and token estimate.

### Stage 3: Verify & Output

After the compressor (or merge compressor) returns:

1. **Completeness check.** Using the headings and named entities list returned by the compressor, verify each appears in the distillate content. If gaps are found, send them back to the compressor for a targeted fix pass — not a full recompression. Limit to 2 fix passes maximum.

2. **Format check.** Verify the output follows distillate format rules:
   - No prose paragraphs (only bullets)
   - No decorative formatting
   - No repeated information
   - Each bullet is self-contained
   - Themes are clearly delineated with `##` headings

3. **Determine output format.** Using the split prediction from Stage 1 and actual distillate size:

   **Single distillate** (≤~5,000 tokens or token_budget not exceeded):

   Save as a single file with frontmatter:

   ```yaml
   ---
   type: bmad-distillate
   sources:
     - "{relative path to source file 1}"
     - "{relative path to source file 2}"
   downstream_consumer: "{consumer or 'general'}"
   created: "{date}"
   token_estimate: {approximate token count}
   parts: 1
   ---
   ```

   **Split distillate** (>~5,000 tokens, or token_budget requires it):

   Create a folder `{base-name}-distillate/` containing:

   ```
   {base-name}-distillate/
   ├── _index.md           # Orientation, cross-cutting items, section manifest
   ├── 01-{topic-slug}.md  # Self-contained section
   ├── 02-{topic-slug}.md
   └── 03-{topic-slug}.md
   ```

   The `_index.md` contains:
   - Frontmatter with sources (relative paths from the distillate folder to the originals)
   - 3-5 bullet orientation (what was distilled, from what)
   - Section manifest: each section's filename + 1-line description
   - Cross-cutting items that span multiple sections

   Each section file is self-contained — loadable independently. Include a 1-line context header: "This section covers [topic]. Part N of M."

   Source paths in frontmatter must be relative to the distillate's location.

4. **Measure distillate.** Run `scripts/analyze_sources.py` on the final distillate file(s) to get accurate token counts for the output. Use the `total_estimated_tokens` from this analysis as `distillate_total_tokens`.

5. **Report results.** Always return structured JSON output:

   ```json
   {
     "status": "complete",
     "distillate": "{path or folder path}",
     "section_distillates": ["{path1}", "{path2}"] or null,
     "source_total_tokens": N,
     "distillate_total_tokens": N,
     "compression_ratio": "X:1",
     "source_documents": ["{path1}", "{path2}"],
     "completeness_check": "pass" or "pass_with_additions"
   }
   ```

   Where `source_total_tokens` is from the Stage 1 analysis and `distillate_total_tokens` is from step 4. The `compression_ratio` is `source_total_tokens / distillate_total_tokens` formatted as "X:1" (e.g., "3.2:1").

6. If `--validate` flag was set, proceed to Stage 4. Otherwise, done.

### Stage 4: Round-Trip Validation (--validate only)

This stage proves the distillate is lossless by reconstructing source documents from the distillate alone. Use for critical documents where information loss is unacceptable, or as a quality gate for high-stakes downstream workflows. Not for routine use — it adds significant token cost.

1. **Spawn the reconstructor agent** using `agents/round-trip-reconstructor.md`. Pass it ONLY the distillate file path (or `_index.md` path for split distillates) — it must NOT have access to the original source documents.

   For split distillates, spawn one reconstructor per section in parallel. Each receives its section file plus the `_index.md` for cross-cutting context.

   **Graceful degradation:** If subagent spawning is unavailable, this stage cannot be performed by the main agent (it has already seen the originals). Report that round-trip validation requires subagent support and skip.

2. **Receive reconstructions.** The reconstructor returns reconstruction file paths saved adjacent to the distillate.

3. **Perform semantic diff.** Read both the original source documents and the reconstructions. For each section of the original, assess:
   - Is the core information present in the reconstruction?
   - Are specific details preserved (numbers, names, decisions)?
   - Are relationships and rationale intact?
   - Did the reconstruction add anything not in the original? (indicates hallucination filling gaps)

4. **Produce validation report** saved adjacent to the distillate as `-validation-report.md`:

   ```markdown
   ---
   type: distillate-validation
   distillate: "{distillate path}"
   sources: ["{source paths}"]
   created: "{date}"
   ---

   ## Validation Summary
   - Status: PASS | PASS_WITH_WARNINGS | FAIL
   - Information preserved: {percentage estimate}
   - Gaps found: {count}
   - Hallucinations detected: {count}

   ## Gaps (information in originals but missing from reconstruction)
   - {gap description} — Source: {which original}, Section: {where}

   ## Hallucinations (information in reconstruction not traceable to originals)
   - {hallucination description} — appears to fill gap in: {section}

   ## Possible Gap Markers (flagged by reconstructor)
   - {marker description}
   ```

5. **If gaps are found**, offer to run a targeted fix pass on the distillate — adding the missing information without full recompression. Limit to 2 fix passes maximum.

6. **Clean up** — delete the temporary reconstruction files after the report is generated.

## File: agents\distillate-compressor.md

# Distillate Compressor Agent

Act as an information extraction and compression specialist. Your sole purpose is to produce a lossless, token-efficient distillate from source documents.

You receive: source document file paths, an optional downstream_consumer context, and a splitting decision.

You must load and apply `../resources/compression-rules.md` before producing output. Reference `../resources/distillate-format-reference.md` for the expected output format.

## Compression Process

### Step 1: Read Sources

Read all source document files. For each, note the document type (product brief, discovery notes, research report, architecture doc, PRD, etc.) based on content and naming.

### Step 2: Extract

Extract every discrete piece of information from all source documents:
- Facts and data points (numbers, dates, versions, percentages)
- Decisions made and their rationale
- Rejected alternatives and why they were rejected
- Requirements and constraints (explicit and implicit)
- Relationships and dependencies between entities
- Named entities (products, companies, people, technologies)
- Open questions and unresolved items
- Scope boundaries (in/out/deferred)
- Success criteria and validation methods
- Risks and opportunities
- User segments and their success definitions

Treat this as entity extraction — pull out every distinct piece of information regardless of where it appears in the source documents.

### Step 3: Deduplicate

Apply the deduplication rules from `../resources/compression-rules.md`.

### Step 4: Filter (only if downstream_consumer is specified)

For each extracted item, ask: "Would the downstream workflow need this?"
- Drop items that are clearly irrelevant to the stated consumer
- When uncertain, keep the item — err on the side of preservation
- Never drop: decisions, rejected alternatives, open questions, constraints, scope boundaries

### Step 5: Group Thematically

Organize items into coherent themes derived from the source content — not from a fixed template. The themes should reflect what the documents are actually about.

Common groupings (use what fits, omit what doesn't, add what's needed):
- Core concept / problem / motivation
- Solution / approach / architecture
- Users / segments
- Technical decisions / constraints
- Scope boundaries (in/out/deferred)
- Competitive context
- Success criteria
- Rejected alternatives
- Open questions
- Risks and opportunities

### Step 6: Compress Language

For each item, apply the compression rules from `../resources/compression-rules.md`:
- Strip prose transitions and connective tissue
- Remove hedging and rhetoric
- Remove explanations of common knowledge
- Preserve specific details (numbers, names, versions, dates)
- Ensure the item is self-contained (understandable without reading the source)
- Make relationships explicit ("X because Y", "X blocks Y", "X replaces Y")

### Step 7: Format Output

Produce the distillate as dense thematically-grouped bullets:
- `##` headings for themes — no deeper heading levels needed
- `- ` bullets for items — every token must carry signal
- No decorative formatting (no bold for emphasis, no horizontal rules)
- No prose paragraphs — only bullets
- Semicolons to join closely related short items within a single bullet
- Each bullet self-contained — understandable without reading other bullets

Do NOT include frontmatter — the calling skill handles that.

## Semantic Splitting

If the splitting decision indicates splitting is needed, load `../resources/splitting-strategy.md` and follow it.

When splitting:

1. Identify natural semantic boundaries in the content — coherent topic clusters, not arbitrary size breaks.

2. Produce a **root distillate** containing:
   - 3-5 bullet orientation (what was distilled, for whom, how many parts)
   - Cross-references to section distillates
   - Items that span multiple sections

3. Produce **section distillates**, each self-sufficient. Include a 1-line context header: "This section covers [topic]. Part N of M from [source document names]."

## Return Format

Return a structured result to the calling skill:

```json
{
  "distillate_content": "{the complete distillate text without frontmatter}",
  "source_headings": ["heading 1", "heading 2"],
  "source_named_entities": ["entity 1", "entity 2"],
  "token_estimate": N,
  "sections": null or [{"topic": "...", "content": "..."}]
}
```

- **distillate_content**: The full distillate text
- **source_headings**: All Level 2+ headings found across source documents (for completeness verification)
- **source_named_entities**: Key named entities (products, companies, people, technologies, decisions) found in sources
- **token_estimate**: Approximate token count of the distillate
- **sections**: null for single distillates; array of section objects if semantically split

Do not include conversational text, status updates, or preamble — return only the structured result.


## File: agents\round-trip-reconstructor.md

# Round-Trip Reconstructor Agent

Act as a document reconstruction specialist. Your purpose is to prove a distillate's completeness by reconstructing the original source documents from the distillate alone.

**Critical constraint:** You receive ONLY the distillate file path. You must NOT have access to the original source documents. If you can see the originals, the test is meaningless.

## Process

### Step 1: Analyze the Distillate

Read the distillate file. Parse the YAML frontmatter to identify:
- The `sources` list — what documents were distilled
- The `downstream_consumer` — what filtering may have been applied
- The `parts` count — whether this is a single or split distillate

### Step 2: Detect Document Types

From the source file names and the distillate's content, infer what type of document each source was:
- Product brief, discovery notes, research report, architecture doc, PRD, etc.
- Use the naming conventions and content themes to determine appropriate document structure

### Step 3: Reconstruct Each Source

For each source listed in the frontmatter, produce a full human-readable document:

- Use appropriate prose, structure, and formatting for the document type
- Include all sections the original document would have had based on the document type
- Expand compressed bullets back into natural language prose
- Restore section transitions and contextual framing
- Do NOT invent information — only use what is in the distillate
- Flag any places where the distillate felt insufficient with `[POSSIBLE GAP]` markers — these are critical quality signals

**Quality signals to watch for:**
- Bullets that feel like they're missing context → `[POSSIBLE GAP: missing context for X]`
- Themes that seem underrepresented given the document type → `[POSSIBLE GAP: expected more on X for a document of this type]`
- Relationships that are mentioned but not fully explained → `[POSSIBLE GAP: relationship between X and Y unclear]`

### Step 4: Save Reconstructions

Save each reconstructed document as a temporary file adjacent to the distillate:
- First source: `{distillate-basename}-reconstruction-1.md`
- Second source: `{distillate-basename}-reconstruction-2.md`
- And so on for each source

Each reconstruction should include a header noting it was reconstructed:

```markdown
---
type: distillate-reconstruction
source_distillate: "{distillate path}"
reconstructed_from: "{original source name}"
reconstruction_number: {N}
---
```

### Step 5: Return

Return a structured result to the calling skill:

```json
{
  "reconstruction_files": ["{path1}", "{path2}"],
  "possible_gaps": ["gap description 1", "gap description 2"],
  "source_count": N
}
```

Do not include conversational text, status updates, or preamble — return only the structured result.


## File: resources\compression-rules.md

# Compression Rules

These rules govern how source text is compressed into distillate format. Apply as a final pass over all output.

## Strip — Remove entirely

- Prose transitions: "As mentioned earlier", "It's worth noting", "In addition to this"
- Rhetoric and persuasion: "This is a game-changer", "The exciting thing is"
- Hedging: "We believe", "It's likely that", "Perhaps", "It seems"
- Self-reference: "This document describes", "As outlined above"
- Common knowledge explanations: "Vercel is a cloud platform company", "MIT is an open-source license", "JSON is a data interchange format"
- Repeated introductions of the same concept
- Section transition paragraphs
- Formatting-only elements (decorative bold/italic for emphasis, horizontal rules for visual breaks)
- Filler phrases: "In order to", "It should be noted that", "The fact that"

## Preserve — Keep always

- Specific numbers, dates, versions, percentages
- Named entities (products, companies, people, technologies)
- Decisions made and their rationale (compressed: "Decision: X. Reason: Y")
- Rejected alternatives and why (compressed: "Rejected: X. Reason: Y")
- Explicit constraints and non-negotiables
- Dependencies and ordering relationships
- Open questions and unresolved items
- Scope boundaries (in/out/deferred)
- Success criteria and how they're validated
- User segments and what success means for each
- Risks with their severity signals
- Conflicts between source documents

## Transform — Change form for efficiency

- Long prose paragraphs → single dense bullet capturing the same information
- "We decided to use X because Y and Z" → "X (rationale: Y, Z)"
- Repeated category labels → group under a single heading, no per-item labels
- "Risk: ... Severity: high" → "HIGH RISK: ..."
- Conditional statements → "If X → Y" form
- Multi-sentence explanations → semicolon-separated compressed form
- Lists of related short items → single bullet with semicolons
- "X is used for Y" → "X: Y" when context is clear
- Verbose enumerations → parenthetical lists: "platforms (Cursor, Claude Code, Windsurf, Copilot)"

## Deduplication Rules

- Same fact in multiple documents → keep the version with most context
- Same concept at different detail levels → keep the detailed version
- Overlapping lists → merge into single list, no duplicates
- When source documents disagree → note the conflict explicitly: "Brief says X; discovery notes say Y — unresolved"
- Executive summary points that are expanded elsewhere → keep only the expanded version
- Introductory framing repeated across sections → capture once under the most relevant theme


## File: resources\distillate-format-reference.md

# Distillate Format Reference

Examples showing the transformation from human-readable source content to distillate format.

## Frontmatter

Every distillate includes YAML frontmatter. Source paths are relative to the distillate's location so the distillate remains portable:

```yaml
---
type: bmad-distillate
sources:
  - "product-brief-example.md"
  - "product-brief-example-discovery-notes.md"
downstream_consumer: "PRD creation"
created: "2026-03-13"
token_estimate: 1200
parts: 1
---
```

## Before/After Examples

### Prose Paragraph to Dense Bullet

**Before** (human-readable brief excerpt):
```
## What Makes This Different

**The anti-fragmentation layer.** The AI tooling space is fracturing across 40+
platforms with no shared methodology layer. BMAD is uniquely positioned to be the
cross-platform constant — the structured approach that works the same in Cursor,
Claude Code, Windsurf, Copilot, and whatever launches next month. Every other
methodology or skill framework maintains its own platform support matrix. By
building on the open-source skills CLI ecosystem, BMAD offloads the highest-churn
maintenance burden and focuses on what actually differentiates it: the methodology
itself.
```

**After** (distillate):
```
## Differentiation
- Anti-fragmentation positioning: BMAD = cross-platform constant across 40+ fragmenting AI tools; no competitor provides shared methodology layer
- Platform complexity delegated to Vercel skills CLI ecosystem (MIT); BMAD maintains methodology, not platform configs
```

### Technical Details to Compressed Facts

**Before** (discovery notes excerpt):
```
## Competitive Landscape

- **Vercel Skills.sh**: 83K+ skills, 18 agents, largest curated leaderboard —
  but dev-only, skills trigger unreliably (20% without explicit prompting)
- **SkillsMP**: 400K+ skills directory, pure aggregator with no curation or CLI
- **ClawHub/OpenClaw**: ~3.2K curated skills with versioning/rollback, small ecosystem
- **Lindy**: No-code AI agent builder for business automation — closed platform,
  no skill sharing
- **Microsoft Copilot Studio**: Enterprise no-code agent builder — vendor-locked
  to Microsoft
- **MindStudio**: No-code AI agent platform — siloed, no interoperability
- **Make/Zapier AI**: Workflow automation adding AI agents — workflow-centric,
  not methodology-centric
- **Key gap**: NO competitor combines structured methodology with plugin
  marketplace — this is BMAD's whitespace
```

**After** (distillate):
```
## Competitive Landscape
- No competitor combines structured methodology + plugin marketplace (whitespace)
- Skills.sh (Vercel): 83K skills, 18 agents, dev-only, 20% trigger reliability
- SkillsMP: 400K skills, aggregator only, no curation/CLI
- ClawHub: 3.2K curated, versioning, small ecosystem
- No-code platforms (Lindy, Copilot Studio, MindStudio, Make/Zapier): closed/siloed, no skill portability, business-only
```

### Deduplication Across Documents

When the same fact appears in both a brief and discovery notes:

**Brief says:**
```
bmad-init must always be included as a base skill in every bundle
```

**Discovery notes say:**
```
bmad-init must always be included as a base skill in every bundle/install
(solves bootstrapping problem)
```

**Distillate keeps the more contextual version:**
```
- bmad-init: always included as base skill in every bundle (solves bootstrapping)
```

### Decision/Rationale Compression

**Before:**
```
We decided not to build our own platform support matrix going forward, instead
delegating to the Vercel skills CLI ecosystem. The rationale is that maintaining
20+ platform configs is the biggest maintenance burden and it's unsustainable
at 40+ platforms.
```

**After:**
```
- Rejected: own platform support matrix. Reason: unsustainable at 40+ platforms; delegate to Vercel CLI ecosystem
```

## Full Example

A complete distillate produced from a product brief and its discovery notes, targeted at PRD creation:

```markdown
---
type: bmad-distillate
sources:
  - "product-brief-bmad-next-gen-installer.md"
  - "product-brief-bmad-next-gen-installer-discovery-notes.md"
downstream_consumer: "PRD creation"
created: "2026-03-13"
token_estimate: 1450
parts: 1
---

## Core Concept
- BMAD Next-Gen Installer: replaces monolithic Node.js CLI with skill-based plugin architecture for distributing BMAD methodology across 40+ AI platforms
- Three layers: self-describing plugins (bmad-manifest.json), cross-platform install via Vercel skills CLI (MIT), runtime registration via bmad-init skill
- Transforms BMAD from dev-only methodology into open platform for any domain (creative, therapeutic, educational, personal)

## Problem
- Current installer maintains ~20 platform configs manually; each platform convention change requires installer update, test, release — largest maintenance burden on team
- Node.js/npm required — blocks non-technical users on UI-based platforms (Claude Co-Work, etc.)
- CSV manifests are static, generated once at install; no runtime scanning/registration
- Unsustainable at 40+ platforms; new tools launching weekly

## Solution Architecture
- Plugins: skill bundles with Anthropic plugin standard as base format + bmad-manifest.json extending for BMAD-specific metadata (installer options, capabilities, help integration, phase ordering, dependencies)
- Existing manifest example: `{"module-code":"bmm","replaces-skill":"bmad-create-product-brief","capabilities":[{"name":"create-brief","menu-code":"CB","supports-headless":true,"phase-name":"1-analysis","after":["brainstorming"],"before":["create-prd"],"is-required":true}]}`
- Vercel skills CLI handles platform translation; integration pattern (wrap/fork/call) is PRD decision
- bmad-init: global skill scanning installed bmad-manifest.json files, registering capabilities, configuring project settings; always included as base skill in every bundle (solves bootstrapping)
- bmad-update: plugin update path without full reinstall; technical approach (diff/replace/preserve customizations) is PRD decision
- Distribution tiers: (1) NPX installer wrapping skills CLI for technical users, (2) zip bundle + platform-specific README for non-technical users, (3) future marketplace
- Non-technical path has honest friction: "copy to right folder" requires knowing where; per-platform README instructions; improves over time as low-code space matures

## Differentiation
- Anti-fragmentation: BMAD = cross-platform constant; no competitor provides shared methodology layer across AI tools
- Curated quality: all submissions gated, human-reviewed by BMad + core team; 13.4% of community skills have critical vulnerabilities (Snyk 2026); quality gate value increases as ecosystem gets noisier
- Domain-agnostic: no competitor builds beyond software dev workflows; same plugin system powers any domain via BMAD Builder (separate initiative)

## Users (ordered by v1 priority)
- Module authors (primary v1): package/test/distribute plugins independently without installer changes
- Developers: single-command install on any of 40+ platforms via NPX
- Non-technical users: install without Node/Git/terminal; emerging segment including PMs, designers, educators
- Future plugin creators: non-dev authors using BMAD Builder; need distribution without building own installer

## Success Criteria
- Zero (or near-zero) custom platform directory code; delegated to skills CLI ecosystem
- Installation verified on top platforms by volume; skills CLI handles long tail
- Non-technical install path validated with non-developer users
- bmad-init discovers/registers all plugins from manifests; clear errors for malformed manifests
- At least one external module author successfully publishes plugin using manifest system
- bmad-update works without full reinstall
- Existing CLI users have documented migration path

## Scope
- In: manifest spec, bmad-init, bmad-update, Vercel CLI integration, NPX installer, zip bundles, migration path
- Out: BMAD Builder, marketplace web platform, skill conversion (prerequisite, separate), one-click install for all platforms, monetization, quality certification process (gated-submission principle is architectural requirement; process defined separately)
- Deferred: CI/CD integration, telemetry for module authors, air-gapped enterprise install, zip bundle integrity verification (checksums/signing), deeper non-technical platform integrations

## Current Installer (migration context)
- Entry: `tools/cli/bmad-cli.js` (Commander.js) → `tools/cli/installers/lib/core/installer.js`
- Platforms: `platform-codes.yaml` (~20 platforms with target dirs, legacy dirs, template types, special flags)
- Manifests: CSV files (skill/workflow/agent-manifest.csv) are current source of truth, not JSON
- External modules: `external-official-modules.yaml` (CIS, GDS, TEA, WDS) from npm with semver
- Dependencies: 4-pass resolver (collect → parse → resolve → transitive); YAML-declared only
- Config: prompts for name, communication language, document output language, output folder
- Skills already use directory-per-skill layout; bmad-manifest.json sidecars exist but are not source of truth
- Key shift: CSV-based static manifests → JSON-based runtime scanning

## Vercel Skills CLI
- `npx skills add <source>` — GitHub, GitLab, local paths, git URLs
- 40+ agents; per-agent path mappings; symlinks (recommended) or copies
- Scopes: project-level or global
- Discovery: `skills/`, `.agents/skills/`, agent-specific paths, `.claude-plugin/marketplace.json`
- Commands: add, list, find, remove, check, update, init
- Non-interactive: `-y`, `--all` flags for CI/CD

## Competitive Landscape
- No competitor combines structured methodology + plugin marketplace (whitespace)
- Skills.sh (Vercel): 83K skills, dev-only, 20% trigger reliability without explicit prompting
- SkillsMP: 400K skills, aggregator only, no curation
- ClawHub: 3.2K curated, versioning, small
- No-code platforms (Lindy, Copilot Studio, MindStudio, Make/Zapier): closed/siloed, no skill portability, business-only
- Market: $7.84B (2025) → $52.62B (2030); Agent Skills spec ~4 months old, 351K+ skills; standards converging under Linux Foundation AAIF (MCP, AGENTS.md, A2A)

## Rejected Alternatives
- Building own platform support matrix: unsustainable at 40+; delegate to Vercel ecosystem
- One-click install for non-technical v1: emerging space; guidance-based, improve over time
- Prior roadmap/brainstorming: clean start, unconstrained by previous planning

## Open Questions
- Vercel CLI integration pattern: wrap/fork/call/peer dependency?
- bmad-update mechanics: diff/replace? Preserve user customizations?
- Migration story: command/manual reinstall/compatibility shim?
- Cross-platform testing: CI matrix for top N? Community testing for rest?
- bmad-manifest.json as open standard submission to Agent Skills governance?
- Platforms NOT supported by Vercel skills CLI?
- Manifest versioning strategy for backward compatibility?
- Plugin author getting-started experience and tooling?

## Opportunities
- Module authors as acquisition channel: each published plugin distributes BMAD to creator's audience
- CI/CD integration: bmad-init as pipeline one-liner increases stickiness
- Educational institutions: structured methodology + non-technical install → university AI curriculum
- Skill composability: mixing BMAD modules with third-party skills for custom methodology stacks

## Risks
- Manifest format evolution creates versioning/compatibility burden once third-party authors publish
- Quality gate needs defined process, not just claim — gated review model addresses
- 40+ platform testing environments even with Vercel handling translation
- Scope creep pressure from marketplace vision (explicitly excluded but primary long-term value)
- Vercel dependency: minor supply-chain risk; MIT license allows fork if deprioritized
```


## File: resources\splitting-strategy.md

# Semantic Splitting Strategy

When the source content is large (exceeds ~15,000 tokens) or a token_budget requires it, split the distillate into semantically coherent sections rather than arbitrary size breaks.

## Why Semantic Over Size-Based

Arbitrary splits (every N tokens) break coherence. A downstream workflow loading "part 2 of 4" gets context fragments. Semantic splits produce self-contained topic clusters that a workflow can load selectively — "give me just the technical decisions section" — which is more useful and more token-efficient for the consumer.

## Splitting Process

### 1. Identify Natural Boundaries

After the initial extraction and deduplication (Steps 1-2 of the compression process), look for natural semantic boundaries:
- Distinct problem domains or functional areas
- Different stakeholder perspectives (users, technical, business)
- Temporal boundaries (current state vs future vision)
- Scope boundaries (in-scope vs out-of-scope vs deferred)
- Phase boundaries (analysis, design, implementation)

Choose boundaries that produce sections a downstream workflow might load independently.

### 2. Assign Items to Sections

For each extracted item, assign it to the most relevant section. Items that span multiple sections go in the root distillate.

Cross-cutting items (items relevant to multiple sections):
- Constraints that affect all areas → root distillate
- Decisions with broad impact → root distillate
- Section-specific decisions → section distillate

### 3. Produce Root Distillate

The root distillate contains:
- **Orientation** (3-5 bullets): what was distilled, from what sources, for what consumer, how many sections
- **Cross-references**: list of section distillates with 1-line descriptions
- **Cross-cutting items**: facts, decisions, and constraints that span multiple sections
- **Scope summary**: high-level in/out/deferred if applicable

### 4. Produce Section Distillates

Each section distillate must be self-sufficient — a reader loading only one section should understand it without the others.

Each section includes:
- **Context header** (1 line): "This section covers [topic]. Part N of M from [source document names]."
- **Section content**: thematically-grouped bullets following the same compression rules as a single distillate
- **Cross-references** (if needed): pointers to other sections for related content

### 5. Output Structure

Create a folder `{base-name}-distillate/` containing:

```
{base-name}-distillate/
├── _index.md           # Root distillate: orientation, cross-cutting items, section manifest
├── 01-{topic-slug}.md  # Self-contained section
├── 02-{topic-slug}.md
└── 03-{topic-slug}.md
```

Example:
```
product-brief-distillate/
├── _index.md
├── 01-problem-solution.md
├── 02-technical-decisions.md
└── 03-users-market.md
```

## Size Targets

When a token_budget is specified:
- Root distillate: ~20% of budget (orientation + cross-cutting items)
- Remaining budget split proportionally across sections based on content density
- If a section exceeds its proportional share, compress more aggressively or sub-split

When no token_budget but splitting is needed:
- Aim for sections of 3,000-5,000 tokens each
- Root distillate as small as possible while remaining useful standalone


