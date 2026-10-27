export interface ProfileParameterSchema {
  hidden?: boolean;
  /**
   * Conditional visibility gate:
   *  - `{ param }`         → gate param must be enabled (boolean true / 'true').
   *  - `{ param, equals }` → gate param's saved value must equal `equals`.
   * The gate is evaluated recursively: a param is only shown when its gate
   * condition holds AND the gate param itself is currently shown. This makes a
   * chain like encryption_fields → encryption_mode → encryption_enabled collapse
   * entirely when the root toggle is turned off.
   */
  showWhen?: { param: string; equals?: string };
}

type ParamEntry = { value?: unknown } | undefined;
type ParamsMap = Record<string, unknown>;
type SchemaMap = Record<string, ProfileParameterSchema | undefined>;

function readEntry(params: ParamsMap, key: string): ParamEntry {
  const entry = params[key];
  return entry && typeof entry === 'object' ? (entry as { value?: unknown }) : undefined;
}

function isTruthy(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * Resolve a param's effective value for gate evaluation: the saved value if the
 * admin set one, otherwise the schema default (so a defaulted `encryption_mode`
 * still gates `encryption_fields` before it is explicitly saved).
 */
function effectiveValue(params: ParamsMap, schemas: SchemaMap | undefined, key: string): unknown {
  const entry = readEntry(params, key);
  if (entry && 'value' in entry) return entry.value;
  const schema = schemas?.[key] as (ProfileParameterSchema & { default?: unknown }) | undefined;
  return schema?.default;
}

/**
 * Decide whether an endpoint parameter should be rendered in the Profile UI.
 *
 * @param schema  the param's schema (may be undefined for ad-hoc params).
 * @param params  the profile's saved params map ({ key: { value, isLocked } }).
 * @param key     the param name being evaluated.
 * @param schemas (optional) full schema map — enables recursive gate chains and
 *                default-aware gate evaluation. When omitted, gates fall back to
 *                saved values only (backward compatible).
 */
export function shouldDisplayProfileParameter(
  schema: ProfileParameterSchema | undefined,
  params: ParamsMap,
  key: string,
  schemas?: SchemaMap,
  seen: Set<string> = new Set(),
): boolean {
  const gate = schema?.showWhen;

  if (gate) {
    // Guard against a malformed circular gate definition.
    if (seen.has(key)) return false;
    seen.add(key);

    // The gate param must itself be visible; if it is hidden, this param is too.
    const gateSchema = schemas?.[gate.param];
    if (schemas && !shouldDisplayProfileParameter(gateSchema, params, gate.param, schemas, seen)) {
      return false;
    }

    const gateValue = effectiveValue(params, schemas, gate.param);
    const gatePasses = gate.equals !== undefined ? gateValue === gate.equals : isTruthy(gateValue);
    if (!gatePasses) return false;

    // Gate is open → the param is shown (its own `hidden` flag is subordinate to
    // the gate, which is the single source of truth for gated params).
    return true;
  }

  // Non-gated advanced params: hidden until explicitly added/saved.
  const hasSavedValue = Object.prototype.hasOwnProperty.call(params, key);
  return !schema?.hidden || hasSavedValue;
}
