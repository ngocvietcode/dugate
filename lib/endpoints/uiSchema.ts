// lib/endpoints/uiSchema.ts
// Derives ServiceTestClient UI props (discriminator options + per-sub-case fields)
// directly from the SERVICE_REGISTRY source of truth. This keeps the sample
// screens (app/docs/*) in lock-step with the documented 5-skill surface — no
// hand-maintained option lists that can drift from the registry / AI_CATALOG.

import { SERVICE_REGISTRY, type ParamSchema } from './registry';

export type UiFieldType = 'select' | 'text' | 'textarea';

export interface FieldDef {
  name: string;
  label: string;
  type: UiFieldType;
  options?: { label: string; value: string }[];
  placeholder?: string;
  defaultValue?: string;
}

export interface DiscriminatorOption {
  label: string;
  value: string;
  description?: string;
}

export interface ServiceUiSchema {
  discriminatorName: string;
  discriminatorLabel: string;
  discriminatorOptions: DiscriminatorOption[];
  /** Fields to render only when the matching discriminator value is selected. */
  subCaseFields: Record<string, FieldDef[]>;
}

// Params whose values are typically multi-line / long — render as textarea.
const TEXTAREA_PARAMS = new Set([
  'schema', 'fields', 'criteria', 'reference_data', 'template', 'focus',
  'query', 'categories', 'questions', 'redact_patterns', 'extract_fields',
  'focus_areas', 'glossary',
]);

// Human-friendly Vietnamese labels for discriminators and known params.
const LABELS: Record<string, string> = {
  // discriminators
  type: 'Loại tài liệu (type)',
  task: 'Tác vụ (task)',
  action: 'Hành động (action)',
  mode: 'Chế độ (mode)',
  process: 'Quy trình (process)',
  // params
  fields: 'Các trường cần trích xuất (fields · phân cách bằng dấu phẩy)',
  schema: 'JSON Schema tuỳ biến (schema · tuỳ chọn)',
  query: 'Câu hỏi tra cứu (query)',
  categories: 'Danh mục phân loại (categories)',
  criteria: 'Bộ tiêu chí đánh giá (criteria)',
  reference_data: 'Dữ liệu tham chiếu để đối soát (reference_data · JSON)',
  focus: 'Vùng trọng tâm cần soi (focus)',
  output_format: 'Định dạng đầu ra (output_format)',
  target_language: 'Ngôn ngữ đích (target_language)',
  tone: 'Ngữ điệu (tone)',
  style: 'Văn phong (style)',
  template: 'Mẫu điền form (template)',
  pages: 'Trang cần xử lý (pages)',
  format: 'Định dạng trình bày (format)',
  language: 'Ngôn ngữ tài liệu (language)',
};

function labelFor(name: string): string {
  return LABELS[name] ?? name;
}

function paramToField(name: string, schema: ParamSchema): FieldDef {
  const label = labelFor(name);

  if (schema.options && schema.options.length > 0) {
    return {
      name,
      label,
      type: 'select',
      options: schema.options.map((o) => ({ label: o, value: o })),
    };
  }

  const type: UiFieldType = TEXTAREA_PARAMS.has(name) ? 'textarea' : 'text';
  return { name, label, type, placeholder: schema.description };
}

/**
 * Build the sample-screen UI schema for a service slug from the registry.
 * Excludes legacy sub-cases (not part of the documented surface) and any
 * admin-locked params (defaultLocked) that clients cannot set.
 */
export function buildServiceUiSchema(slug: string): ServiceUiSchema {
  const svc = SERVICE_REGISTRY[slug];
  if (!svc) {
    throw new Error(`buildServiceUiSchema: unknown service slug "${slug}"`);
  }

  const discriminatorOptions: DiscriminatorOption[] = [];
  const subCaseFields: Record<string, FieldDef[]> = {};

  for (const [key, sub] of Object.entries(svc.subCases)) {
    if (sub.legacy) continue;

    discriminatorOptions.push({
      label: `${sub.displayName} (${key})`,
      value: key,
      description: sub.description,
    });

    subCaseFields[key] = Object.entries(sub.parameters)
      .filter(([, pSchema]) => !pSchema.defaultLocked)
      .map(([pName, pSchema]) => paramToField(pName, pSchema));
  }

  return {
    discriminatorName: svc.discriminatorName,
    discriminatorLabel: labelFor(svc.discriminatorName),
    discriminatorOptions,
    subCaseFields,
  };
}
