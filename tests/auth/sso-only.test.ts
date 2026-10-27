/**
 * SSO-only sign-in (lib/auth.ts).
 *
 * OIDC is the single way into the operations UI, so these tests pin the two
 * invariants that keep that gate honest:
 *   - no just-in-time provisioning: an identity the ADMIN has not pre-created is
 *     refused, so directory members cannot walk into the operations UI;
 *   - no account takeover: a row already bound to one OIDC subject is never
 *     re-bound to another, which matters because User.email is not unique.
 * Plus the configuration guard, since an unconfigured deployment has no fallback
 * login and must fail loudly instead of rendering an inert page.
 */
import type { NextAuthOptions } from 'next-auth';

type Row = Record<string, unknown>;

let selectQueue: Row[][] = [];
const updateSet = jest.fn();
const updateReturning = jest.fn();

jest.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(selectQueue.shift() ?? []) }),
      }),
    }),
    update: () => ({
      set: (values: Row) => {
        updateSet(values);
        return {
          where: () => ({
            returning: () => updateReturning(),
            // The "already linked" path awaits the update without .returning().
            then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
              Promise.resolve(undefined).then(onFulfilled, onRejected),
          }),
        };
      },
    }),
  },
}));

const OIDC_ENV = {
  OIDC_ISSUER: 'https://idp.example.com/application/o/dugate',
  OIDC_CLIENT_ID: 'dugate',
  OIDC_CLIENT_SECRET: 'client-secret',
  NEXTAUTH_SECRET: 'test-secret',
};

const originalEnv = process.env;

async function loadAuth(env: Record<string, string | undefined>) {
  jest.resetModules();
  process.env = { ...originalEnv, ...env };
  return import('@/lib/auth');
}

/** Invoke the signIn callback the way NextAuth does for an OIDC response. */
async function signInWithOidc(
  authOptions: NextAuthOptions,
  { sub, email, username, name }: { sub: string; email?: string; username?: string; name?: string },
) {
  const user = { id: sub, name, email, username } as Record<string, unknown>;
  const account = { provider: 'oidc', providerAccountId: sub, type: 'oauth' } as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outcome = await authOptions.callbacks!.signIn!({ user, account } as any);
  return { outcome, user };
}

beforeEach(() => {
  jest.clearAllMocks();
  selectQueue = [];
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  process.env = originalEnv;
});

describe('no just-in-time provisioning', () => {
  it('refuses an identity that no ADMIN has pre-created', async () => {
    const { authOptions } = await loadAuth(OIDC_ENV);
    // No row by providerSub, none by email, none by username.
    selectQueue = [[], [], []];

    const { outcome } = await signInWithOidc(authOptions, {
      sub: 'sub-stranger',
      email: 'stranger@example.com',
      username: 'stranger',
    });

    expect(outcome).toBe(false);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('logs the rejected subject so an operator can provision or link it', async () => {
    const { authOptions } = await loadAuth(OIDC_ENV);
    selectQueue = [[], [], []];

    await signInWithOidc(authOptions, { sub: 'sub-stranger', username: 'stranger' });

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('sub-stranger'));
  });
});

describe('linking an SSO identity to a pre-provisioned account', () => {
  it('links by email, which is how a seeded ADMIN signs in on a fresh database', async () => {
    const { authOptions } = await loadAuth(OIDC_ENV);
    const seeded = { id: 'u1', username: 'vietbn', email: 'vietbn@example.com', role: 'ADMIN', providerSub: null };
    selectQueue = [[], [seeded]];
    updateReturning.mockResolvedValue([{ ...seeded, provider: 'oidc', providerSub: 'sub-1' }]);

    const { outcome, user } = await signInWithOidc(authOptions, {
      sub: 'sub-1',
      email: 'vietbn@example.com',
      username: 'vietbn',
    });

    expect(outcome).toBe(true);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ provider: 'oidc', providerSub: 'sub-1' }));
    // Role comes from the database record, never from an IDP claim.
    expect(user.role).toBe('ADMIN');
    expect(user.id).toBe('u1');
  });

  it('links by username when the IDP sends no email', async () => {
    const { authOptions } = await loadAuth(OIDC_ENV);
    const provisioned = { id: 'u2', username: 'hieupb', email: null, role: 'OPS', providerSub: null };
    // No row by providerSub; the email branch is skipped for a user without one.
    selectQueue = [[], [provisioned]];
    updateReturning.mockResolvedValue([{ ...provisioned, provider: 'oidc', providerSub: 'sub-2' }]);

    const { outcome, user } = await signInWithOidc(authOptions, { sub: 'sub-2', username: 'hieupb' });

    expect(outcome).toBe(true);
    expect(user.role).toBe('OPS');
  });

  it('reuses the row already bound to this subject without relinking', async () => {
    const { authOptions } = await loadAuth(OIDC_ENV);
    selectQueue = [[{ id: 'u3', username: 'hieupb', email: 'hieupb@example.com', role: 'ADMIN', providerSub: 'sub-3' }]];

    const { outcome, user } = await signInWithOidc(authOptions, {
      sub: 'sub-3',
      email: 'hieupb@example.com',
      username: 'hieupb',
    });

    expect(outcome).toBe(true);
    expect(user.role).toBe('ADMIN');
    // Display info is refreshed, but the binding is not rewritten.
    expect(updateSet).toHaveBeenCalledWith(expect.not.objectContaining({ providerSub: expect.anything() }));
  });
});

describe('account takeover protection', () => {
  it('does not hand a second subject an account already linked to another one', async () => {
    const { authOptions } = await loadAuth(OIDC_ENV);
    // User.email carries no unique constraint, so two directory identities can
    // present the same address. The first one owns the account.
    const alreadyLinked = { id: 'u4', username: 'hieupb', email: 'shared@example.com', role: 'ADMIN', providerSub: 'sub-first' };
    selectQueue = [[], [alreadyLinked], [alreadyLinked]];

    const { outcome } = await signInWithOidc(authOptions, {
      sub: 'sub-second',
      email: 'shared@example.com',
      username: 'hieupb',
    });

    expect(outcome).toBe(false);
    expect(updateSet).not.toHaveBeenCalled();
  });
});

describe('configuration guard', () => {
  it.each([
    ['OIDC_ISSUER'],
    ['OIDC_CLIENT_ID'],
    ['OIDC_CLIENT_SECRET'],
  ])('reports SSO as unconfigured and names %s when it is absent', async (variable) => {
    // All three are required together: building a provider from the issuer alone
    // would defer the failure to the token exchange, where it reads as an opaque
    // IDP error rather than a missing setting.
    const { isSsoConfigured, missingSsoEnvVars, ssoConfigurationError } = await loadAuth({
      ...OIDC_ENV,
      [variable]: undefined,
    });

    expect(isSsoConfigured).toBe(false);
    expect(missingSsoEnvVars()).toContain(variable);
    expect(ssoConfigurationError()).toContain('SSO-only');
  });

  it('treats an empty string the same as absent', async () => {
    // Compose substitutes `${OIDC_CLIENT_ID}` with an empty string when the value is
    // not in the env file, so blank must not count as configured.
    const { isSsoConfigured } = await loadAuth({ ...OIDC_ENV, OIDC_CLIENT_ID: '' });

    expect(isSsoConfigured).toBe(false);
  });

  it('registers exactly one provider when fully configured', async () => {
    const { authOptions, isSsoConfigured, missingSsoEnvVars } = await loadAuth(OIDC_ENV);

    expect(isSsoConfigured).toBe(true);
    expect(missingSsoEnvVars()).toEqual([]);
    expect(authOptions.providers).toHaveLength(1);
    expect(authOptions.providers[0].id).toBe('oidc');
  });

  it('needs no on/off switch: credentials alone decide, and OIDC_ENABLED is ignored', async () => {
    // A flag able to disable the only sign-in method is a hazard with no upside, so
    // it was removed. A deployment still passing it must keep working either way.
    const off = await loadAuth({ ...OIDC_ENV, OIDC_ENABLED: 'false' });
    expect(off.isSsoConfigured).toBe(true);

    const legacy = await loadAuth({ ...OIDC_ENV, NEXT_PUBLIC_OIDC_ENABLED: 'false' });
    expect(legacy.isSsoConfigured).toBe(true);
  });
});

describe('local credentials are gone', () => {
  it('exposes no credentials provider', async () => {
    const { authOptions } = await loadAuth(OIDC_ENV);

    expect(authOptions.providers.map((provider) => provider.id)).not.toContain('credentials');
  });

  it('delegates callbackUrl validation to NextAuth instead of overriding redirect', async () => {
    // The removed override accepted any absolute URL, which was an open redirect.
    const { authOptions } = await loadAuth(OIDC_ENV);

    expect(authOptions.callbacks?.redirect).toBeUndefined();
  });

  it('routes sign-in failures to /login so the reason can be explained', async () => {
    // next-auth redirects a denied sign-in to `${pages.error}?error=AccessDenied`
    // (core/index.js). Without pages.error it serves its own generic page and the
    // message in LoginForm would never be reachable.
    const { authOptions } = await loadAuth(OIDC_ENV);

    expect(authOptions.pages?.error).toBe('/login');
    expect(authOptions.pages?.signIn).toBe('/login');
  });
});
