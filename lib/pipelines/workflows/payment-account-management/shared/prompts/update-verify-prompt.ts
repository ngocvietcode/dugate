// lib/pipelines/workflows/payment-account-management/update-account/verify-prompt.ts
// lib/pipelines/workflows/payment-account-management/shared/prompts/update-verify-prompt.ts
// Prompt builder for the mode=update reconciliation step. Lives alongside the
// other PAM prompt builders (common-prompts.ts, doc-prompts.ts) so every
// LLM-facing text this workflow emits is in one folder.
//
// Builds the prompt sent to the ext-fact-verifier connector to reconcile an
// MB03 extracted payload against core-bank data. The prompt lists what to
// compare, how to compare it, and the exact JSON shape to return.
//
// All compare rules live IN THIS PROMPT — no rule-based fallback in code. If a
// rule changes, edit the prompt. Keeping rules in one place (and one language
// — Vietnamese, since the reviewers are VN) beats scattering them across
// TypeScript + a prompt fragment.

import { PAM_SYSTEM_PROMPT_HEADER } from './common-prompts';
import type { UpdateAccountBankData } from '../../update-account/types';

/**
 * Build the full prompt: system framing + rules + inputs (bank data + MB03
 * extracted JSON) + strict output shape. Called once per MB03 document.
 */
export function buildVerifyPrompt(
  mb03Extracted: unknown,
  bankData: UpdateAccountBankData,
): string {
  const bankJson = JSON.stringify(bankData ?? {}, null, 2);
  const mb03Json = JSON.stringify(mb03Extracted ?? {}, null, 2);

  return `${PAM_SYSTEM_PROMPT_HEADER}

TASK: reconcile the MB03 (Giấy đề nghị cập nhật thông tin và dịch vụ) extracted
data against the CURRENT account data from the core banking system. Produce
per-field validation entries so a reviewer can see, at a glance, which fields
were compared and whether the bank and MB03 agree.

Return your judgment as ONE JSON object with the shape declared at the bottom.
Do not include any prose, no markdown fences.

### WHAT TO COMPARE

There are exactly 8 checks. Each check reads ONE field on the bank side and one
field on the MB03 side and decides pass / fail / skip. Each emitted entry
anchors on a concrete MB03 field via its \`path\`.

Org identity (3 checks) — each anchored on a Section 2 "new value" MB03 field:
  1. path = "org_name_new_vi"      | bank.org_name_vi       | Tên tổ chức (tiếng Việt)
  2. path = "org_name_new_foreign" | bank.org_name_foreign  | Tên tổ chức (tiếng nước ngoài)
  3. path = "org_name_new_abbr"    | bank.org_short_name    | Tên viết tắt

Each org check is GATED: the check runs only if the array
"requested_services_org_info_changes" on MB03 contains "Thay đổi tên tổ chức".
When the gate is not met, status = "skip" and reason must mention the missing
tick. When the gate is met but one side is empty, status = "skip" with reason
naming which side is missing. Always emit ONE entry per org field (gate met or
not) so the frontend renders a consistent row per field.

People lists (5 checks — one per list) — anchor path is the POSITION field of
the matched MB03 entry:
  4. legal_representatives         (Section 4.I  Đại diện theo pháp luật)
  5. authorized_representatives    (Section 4.II ĐD hợp pháp — Ủy quyền)
  6. authorized_account_users      (Section 4.III Người UQ sử dụng TK)
  7. chief_accountants             (Section 4.IV Kế toán trưởng / PTKT)
  8. authorized_by_chief_accountants (Section 4.V  Ủy quyền KTT / PTKT)

For each of the 5 lists: for EACH person on the bank side, look them up on the
MB03 side by matching (full_name, id_no). Comparison rules:
  - Matching is case- and diacritic-insensitive: "Lê Thị Cẩm" == "LE THI CAM".
  - id_no matching is case-insensitive (some passport numbers carry letters).
  - When MATCHED: emit ONE field validation at
      path = "<listKey>[<mb03 index>].position"
    comparing bank.person.position vs mb03.person.position. Use the same
    case+diacritic normalization. pass if they agree, fail otherwise.
  - When NOT MATCHED (bank person absent from MB03), MB03 has a person the
    bank doesn't, or the bank record is missing full_name / id_no: DO NOT
    emit an entry. The reviewer sees these by visually diffing bank_data
    against the extracted people lists — no anchor on MB03 means we can't
    produce a per-field row.

### HOW TO JUDGE VALUES

- Normalize case + Vietnamese diacritics before comparing text: "CÔNG TY" ==
  "CONG TY".
- Trim whitespace on both sides.
- Common abbreviations count as equal only when unambiguous: "TNHH" ==
  "TNHH" (same); "CTY" vs "CÔNG TY" are equal; "PTKT" vs "Phụ trách kế toán"
  are equal. Never fold structurally different phrases (e.g. "Giám đốc" vs
  "Phó giám đốc" — always fail).
- Every entry carries the RAW bank value (before your normalization) as
  \`bank_value\`. Never write your normalized form back into bank_value.
- reason is Vietnamese, short, includes both raw values when relevant, e.g.
  \`Bank="Kế toán trưởng" ≠ MB03="PHU TRACH KE TOAN".\`. Omit reason on pass
  when the check trivially matches.

### INPUT — bank data (source of truth for CURRENT state)

\`\`\`json
${bankJson}
\`\`\`

### INPUT — MB03 extracted data (already parsed; wrapped leaves are { value, confidence })

\`\`\`json
${mb03Json}
\`\`\`

### OUTPUT SHAPE

Return exactly ONE JSON object with this shape:

\`\`\`json
{
  "field_validations": [
    {
      "path": "<dot-and-index path into the MB03 extracted object>",
      "code": "<stable identifier, see CODE FORMAT below>",
      "status": "pass" | "fail" | "skip",
      "severity": "warning",
      "bank_value": "<raw bank value>" | null,
      "reason": "<Vietnamese short explanation; optional on pass>"
    }
  ]
}
\`\`\`

CODE FORMAT (stable, so the frontend can key off them):
  - Org checks:    "org_name_match:<bankKey>"
                   where bankKey ∈ {org_name_vi, org_name_foreign, org_short_name}
  - Person checks: "position_match:<listKey>"
                   where listKey is the bank list key (e.g. chief_accountants)

Constraints:
  - severity is ALWAYS "warning" today.
  - Every emitted entry has a non-empty \`path\` — no anchor, no entry.
  - Return an EMPTY \`field_validations\` array (not null) when nothing was
    checked at the field level.
  - No markdown, no fences, no commentary. ONLY the JSON object.`;
}
