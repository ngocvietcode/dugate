import {
  authConfigForTest,
  authConfigPatch,
  createEndpointIntegrationDraft,
  createProfileIntegrationDraft,
  endpointIntegrationPatch,
  initOAuth2Draft,
  integrationDraftSignature,
  profileIntegrationPatch,
  sanitizeAuthDraft,
  selectApiKeyAuthLocation,
  type ProfileIntegrationDraft,
} from '@/lib/profiles/integration-config';

describe('profile integration draft helpers', () => {
  it('uses a secret-safe placeholder draft and does not re-post an unchanged bearer secret', () => {
    const draft = sanitizeAuthDraft({ type: 'bearer', token: 'saved-secret' }, true);
    expect(draft.token).toBeUndefined();
    expect(draft.hasSavedSecret).toBe(true);
    expect(authConfigPatch(draft, draft)).toBeUndefined();
  });

  it('sends non-secret edits without a secret so the server can preserve the stored credential', () => {
    const bearer = sanitizeAuthDraft({ type: 'bearer', token: 'legacy' }, true);
    const header = sanitizeAuthDraft({ type: 'header', header_name: 'X-Api-Key', header_value: 'legacy' }, true);
    const query = sanitizeAuthDraft({ type: 'query', query_key: 'token', query_value: 'legacy' }, true);
    // Unchanged draft still emits nothing.
    expect(authConfigPatch(bearer, bearer)).toBeUndefined();
    // A replacement secret is sent as-is.
    expect(authConfigPatch({ ...bearer, token: 'replacement' }, bearer)).toEqual({ type: 'bearer', token: 'replacement' });
    // A non-secret-only edit now emits the structural config WITHOUT the secret;
    // the server merges the previously stored secret forward.
    expect(authConfigPatch({ ...header, header_name: 'X-New-Key' }, header)).toEqual({ type: 'header', header_name: 'X-New-Key' });
    expect(authConfigPatch({ ...header, header_value: 'replacement' }, header)).toEqual({ type: 'header', header_name: 'X-Api-Key', header_value: 'replacement' });
    expect(authConfigPatch({ ...query, query_key: 'new-token' }, query)).toEqual({ type: 'query', query_key: 'new-token' });
    expect(authConfigPatch({ ...query, query_value: 'replacement' }, query)).toEqual({ type: 'query', query_key: 'token', query_value: 'replacement' });
  });

  it('maps the API Key UI mechanism to the unchanged header and query storage types', () => {
    const header = selectApiKeyAuthLocation({ type: 'none' }, 'header');
    const query = selectApiKeyAuthLocation({ type: 'header', header_name: 'X-Api-Key', header_value: 'secret' }, 'query');
    expect(authConfigPatch({ ...header, header_name: 'X-Api-Key', header_value_secret_ref: 'eda/rpa/dugate/key#value' }, { type: 'none' }))
      .toEqual({ type: 'header', header_name: 'X-Api-Key', header_value_secret_ref: 'eda/rpa/dugate/key#value' });
    expect(authConfigPatch({ ...query, query_key: 'api_key', query_value_secret_ref: 'eda/rpa/dugate/key#value' }, { type: 'none' }))
      .toEqual({ type: 'query', query_key: 'api_key', query_value_secret_ref: 'eda/rpa/dugate/key#value' });
  });

  it('initializes OAuth2 with APIC-friendly defaults and an IBM gateway header', () => {
    const draft = initOAuth2Draft({ type: 'none' });
    expect(draft).toMatchObject({
      type: 'oauth2_client_credentials',
      token_body_format: 'json',
      token_auth_style: 'body',
      gateway_headers: [{ name: 'X-IBM-Client-Id', value: '' }],
    });
    // token_response_path stays empty (UI shows an access_token placeholder instead).
    expect(draft.token_response_path).toBeUndefined();
  });

  it('does not duplicate an existing IBM gateway header when initializing OAuth2', () => {
    const draft = initOAuth2Draft({ type: 'none', gateway_headers: [{ name: 'X-IBM-Client-Id', value: 'existing' }] });
    expect(draft.gateway_headers).toEqual([{ name: 'X-IBM-Client-Id', value: 'existing' }]);
  });

  it('infers separate callback auth only when a callback is configured without file auth', () => {
    expect(createProfileIntegrationDraft({ callbackAuthConfigured: true }).callbackUsesSeparateAuth).toBe(true);
    expect(createProfileIntegrationDraft({ callbackAuthConfigured: true, fileAuthConfigured: true }).callbackUsesSeparateAuth).toBe(false);
    expect(createProfileIntegrationDraft({ fileAuthConfigured: true }).callbackUsesSeparateAuth).toBe(false);
    expect(createProfileIntegrationDraft({}).callbackUsesSeparateAuth).toBe(false);
  });

  it('constructs only changed Profile file/callback auth, payload, and endpoint keys', () => {
    const profile = createProfileIntegrationDraft({ callbackPayload: null });
    const changedProfile = { ...profile, callback: { ...profile.callback, payload: 'WITH_RESULT' as const } };
    expect(profileIntegrationPatch(changedProfile, profile)).toEqual({ callbackPayload: 'WITH_RESULT' });

    const endpoint = createEndpointIntegrationDraft({ fileUrlDefaultChunks: 2 });
    const changedEndpoint = { ...endpoint, inputSource: { ...endpoint.inputSource, defaultChunks: '4' } };
    expect(endpointIntegrationPatch(changedEndpoint, endpoint)).toEqual({ fileUrlDefaultChunks: 4 });
  });

  it('writes the same config to file and callback when the callback shares the system auth', () => {
    const baseline = createProfileIntegrationDraft({});
    const current: ProfileIntegrationDraft = {
      ...baseline,
      inputSource: { auth: { type: 'bearer', token: 'shared-token' }, authConfigured: false },
      callbackUsesSeparateAuth: false,
    };
    expect(profileIntegrationPatch(current, baseline)).toEqual({
      fileAuthConfig: { type: 'bearer', token: 'shared-token' },
      callbackAuthConfig: { type: 'bearer', token: 'shared-token' },
    });
  });

  it('does not propagate a shared Query API key onto the callback', () => {
    const baseline = createProfileIntegrationDraft({});
    const current: ProfileIntegrationDraft = {
      ...baseline,
      inputSource: { auth: { type: 'query', query_key: 'api_key', query_value: 'k' }, authConfigured: false },
      callbackUsesSeparateAuth: false,
    };
    const patch = profileIntegrationPatch(current, baseline);
    expect(patch.fileAuthConfig).toEqual({ type: 'query', query_key: 'api_key', query_value: 'k' });
    expect(patch).not.toHaveProperty('callbackAuthConfig');
  });

  it('patches the callback from its own draft when separated', () => {
    const baseline = createProfileIntegrationDraft({});
    const current: ProfileIntegrationDraft = {
      ...baseline,
      inputSource: { auth: { type: 'bearer', token: 'file-token' }, authConfigured: false },
      callback: { ...baseline.callback, auth: { type: 'header', header_name: 'X-CB', header_value: 'cbval' } },
      callbackUsesSeparateAuth: true,
    };
    expect(profileIntegrationPatch(current, baseline)).toEqual({
      fileAuthConfig: { type: 'bearer', token: 'file-token' },
      callbackAuthConfig: { type: 'header', header_name: 'X-CB', header_value: 'cbval' },
    });
  });

  // The per-endpoint file-auth override was removed: file-download credentials live only
  // on the Profile. The endpoint patch must therefore never carry an auth key again.
  it('never emits an auth key from the endpoint patch', () => {
    const baseline = createEndpointIntegrationDraft({ fileUrlDefaultChunks: null });
    expect(endpointIntegrationPatch({ ...baseline }, baseline)).toEqual({});
  });

  it('keeps cURL preview switches out of the endpoint patch', () => {
    const baseline = createEndpointIntegrationDraft({ fileUrlDefaultChunks: null });
    const current = { ...baseline, inputMode: 'file_url' as const, curlIncludeCallback: true };
    expect(endpointIntegrationPatch(current, baseline)).toEqual({});
  });

  it('still emits the chunk default when it changes', () => {
    const baseline = createEndpointIntegrationDraft({ fileUrlDefaultChunks: null });
    const current = { ...baseline, inputSource: { ...baseline.inputSource, defaultChunks: '4' } };
    expect(endpointIntegrationPatch(current, baseline)).toEqual({ fileUrlDefaultChunks: 4 });
  });

  // stripDraftMetadata drops '' so a blanked field vanishes from the payload, which the
  // server cannot tell apart from "not sent" — and "not sent" means keep the stored value.
  // authConfigPatch must therefore emit an explicit null for a cleared optional field.
  it('emits an explicit null for an optional field the operator blanked', () => {
    const baseline = {
      type: 'oauth2_client_credentials' as const,
      token_url: 'https://idp.example/token',
      client_id: 'cid',
      scope: 'file.read',
      audience: 'dugate',
      hasSavedSecret: true,
    };
    const patch = authConfigPatch({ ...baseline, scope: '', audience: undefined }, baseline) as unknown as Record<string, unknown>;
    expect(patch.scope).toBeNull();
    expect(patch.audience).toBeNull();
    // Untouched fields are still sent as values, never nulled.
    expect(patch.token_url).toBe('https://idp.example/token');
  });

  it('does not null an optional field that was never set', () => {
    const baseline = {
      type: 'oauth2_client_credentials' as const,
      token_url: 'https://idp.example/token',
      client_id: 'cid',
      hasSavedSecret: true,
    };
    const patch = authConfigPatch({ ...baseline, client_id: 'cid-2' }, baseline) as unknown as Record<string, unknown>;
    expect('scope' in patch).toBe(false);
    expect('audience' in patch).toBe(false);
  });

  it('never nulls a required-per-type field, so a blanked one fails validation instead', () => {
    const baseline = {
      type: 'oauth2_client_credentials' as const,
      token_url: 'https://idp.example/token',
      client_id: 'cid',
      hasSavedSecret: true,
    };
    const patch = authConfigPatch({ ...baseline, token_url: '' }, baseline) as unknown as Record<string, unknown>;
    expect(patch.token_url).toBeUndefined();
    expect('token_url' in patch).toBe(false);
  });

  it('has stable signatures regardless of gateway header row order', () => {
    const one = { auth: { type: 'oauth2_client_credentials', gateway_headers: [{ name: 'X-B', value: 'b' }, { name: 'X-A', value: 'a' }] } };
    const two = { auth: { type: 'oauth2_client_credentials', gateway_headers: [{ name: 'X-A', value: 'a' }, { name: 'X-B', value: 'b' }] } };
    expect(integrationDraftSignature(one)).toBe(integrationDraftSignature(two));
  });

  it('uses a replacement credential for a test, but omits a sanitized saved credential', () => {
    const saved = sanitizeAuthDraft({ type: 'bearer', token: 'legacy' }, true);
    expect(authConfigForTest(saved)).toBeUndefined();
    expect(authConfigForTest({ ...saved, token: 'replacement' })).toEqual({ type: 'bearer', token: 'replacement' });
    expect(authConfigForTest({ type: 'header', header_name: 'X-Key' })).toBeUndefined();
  });
});
