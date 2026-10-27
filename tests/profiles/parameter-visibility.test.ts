import { shouldDisplayProfileParameter } from '@/lib/profiles/parameter-visibility';


describe('Profile parameter visibility', () => {
  it('hides an advanced schema parameter until an admin explicitly saves it', () => {
    expect(shouldDisplayProfileParameter({ hidden: true }, {}, 'render_scale')).toBe(false);
    expect(shouldDisplayProfileParameter({ hidden: true }, {
      render_scale: { value: 2.5, isLocked: false },
    }, 'render_scale')).toBe(true);
  });

  it('retains hidden params with intentionally falsy saved values and shows normal params', () => {
    expect(shouldDisplayProfileParameter({ hidden: true }, {
      classify_recheck_unassigned: { value: false, isLocked: false },
    }, 'classify_recheck_unassigned')).toBe(true);
    expect(shouldDisplayProfileParameter({ hidden: false }, {}, 'target_lang')).toBe(true);
    expect(shouldDisplayProfileParameter(undefined, {}, 'custom_param')).toBe(true);
  });

  describe('encryption enable-gated sub-params (showWhen)', () => {
    const gated = { hidden: true, showWhen: { param: 'encryption_enabled' } };

    it('hides a gated sub-param when the gate is absent or disabled', () => {
      expect(shouldDisplayProfileParameter(gated, {}, 'encryption_mode')).toBe(false);
      expect(shouldDisplayProfileParameter(gated, {
        encryption_enabled: { value: false, isLocked: true },
      }, 'encryption_mode')).toBe(false);
    });

    it('reveals a gated sub-param when the gate is enabled (boolean or string true)', () => {
      expect(shouldDisplayProfileParameter(gated, {
        encryption_enabled: { value: true, isLocked: true },
      }, 'encryption_mode')).toBe(true);
      expect(shouldDisplayProfileParameter(gated, {
        encryption_enabled: { value: 'true', isLocked: true },
      }, 'encryption_mode')).toBe(true);
    });

    it('re-hides a gated sub-param when the gate is turned off — even if a value was saved (point 3)', () => {
      // A gated param is governed by its gate: a saved value does NOT keep it
      // visible once the gate is off. This is the fix for point 3.
      expect(shouldDisplayProfileParameter(gated, {
        encryption_enabled: { value: false, isLocked: true },
        encryption_public_key: { value: '-----BEGIN PUBLIC KEY-----', isLocked: false },
      }, 'encryption_public_key')).toBe(false);

      // With the full schema map (recursive gate), the same holds.
      const schemas = {
        encryption_enabled: { hidden: false },
        encryption_public_key: gated,
      };
      expect(shouldDisplayProfileParameter(gated, {
        encryption_enabled: { value: false, isLocked: true },
        encryption_public_key: { value: '-----BEGIN PUBLIC KEY-----', isLocked: false },
      }, 'encryption_public_key', schemas)).toBe(false);

      // And it reappears when the gate is turned back on.
      expect(shouldDisplayProfileParameter(gated, {
        encryption_enabled: { value: true, isLocked: true },
        encryption_public_key: { value: '-----BEGIN PUBLIC KEY-----', isLocked: false },
      }, 'encryption_public_key', schemas)).toBe(true);
    });

    it('always shows the gate toggle itself (no showWhen on encryption_enabled)', () => {
      expect(shouldDisplayProfileParameter({ hidden: false }, {}, 'encryption_enabled')).toBe(true);
    });
  });

  describe('value-conditional gate (showWhen.equals) — encryption_fields ← encryption_mode (point 4)', () => {
    const schemas = {
      encryption_enabled: { hidden: false },
      encryption_mode: { hidden: true, default: 'selective', showWhen: { param: 'encryption_enabled' } },
      encryption_fields: { hidden: true, showWhen: { param: 'encryption_mode', equals: 'selective' } },
    };
    const fieldsSchema = schemas.encryption_fields;

    it('shows encryption_fields only when mode = selective and encryption is on', () => {
      const on = { encryption_enabled: { value: true } };
      // mode defaults to selective → fields shown
      expect(shouldDisplayProfileParameter(fieldsSchema, on, 'encryption_fields', schemas)).toBe(true);
      // mode = full → fields hidden
      expect(shouldDisplayProfileParameter(fieldsSchema, {
        ...on, encryption_mode: { value: 'full' },
      }, 'encryption_fields', schemas)).toBe(false);
    });

    it('hides encryption_fields entirely when encryption is off (chain collapses)', () => {
      expect(shouldDisplayProfileParameter(fieldsSchema, {
        encryption_enabled: { value: false }, encryption_mode: { value: 'selective' },
      }, 'encryption_fields', schemas)).toBe(false);
    });
  });
});
