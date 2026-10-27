import { NextAuthOptions, User as NextAuthUser } from "next-auth";
import { OAuthConfig } from "next-auth/providers/oauth";
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// SSO-only. Local username/password sign-in has been removed: OIDC is the single
// entry point to the operations UI, so `providers` starts empty and the OIDC
// provider below is the only member it can ever gain.
const providers: NextAuthOptions["providers"] = [];

// Add the OIDC provider when it is fully configured.
//
// There is deliberately no on/off switch. A flag able to disable the only way in
// is a hazard with no upside: turning SSO "off" locks everyone out rather than
// falling back to anything. Presence of the credentials is the configuration.
//
// All three values are required together. Checking only the issuer would build a
// provider with an undefined client secret, which fails later and less clearly,
// during the token exchange.
const oidcIssuer = process.env.OIDC_ISSUER;
const oidcClientId = process.env.OIDC_CLIENT_ID;
const oidcClientSecret = process.env.OIDC_CLIENT_SECRET;
if (oidcIssuer && oidcClientId && oidcClientSecret) {
  const oidcProvider: OAuthConfig<{ sub: string; preferred_username?: string; email?: string; name?: string }> = {
    id: "oidc",
    name: "SSO",
    type: "oauth",
    wellKnown: `${oidcIssuer}/.well-known/openid-configuration`,
    clientId: oidcClientId,
    clientSecret: oidcClientSecret,
    authorization: { params: { scope: "openid email profile" } },
    idToken: true,
    checks: ["pkce", "state"],
    profile(profile) {
      return {
        id: profile.sub,
        username: profile.preferred_username || profile.email || profile.sub,
        role: "",
        name: profile.name || profile.preferred_username || profile.sub,
        email: profile.email,
      };
    },
  };
  providers.push(oidcProvider);
}

// ─── SSO configuration guard ─────────────────────────────────────────────────
// Being SSO-only, an empty `providers` list means nobody can sign in at all.
// That must surface as an explicit configuration error rather than a sign-in
// page with no button on it.
//
// The check is deliberately NOT a module-level throw: this module is imported by
// pages and route handlers that Next.js loads during `next build`, where OIDC
// variables are not (and should not be) present. Callers assert at request time
// instead — see app/api/auth/[...nextauth]/route.ts and app/login/page.tsx.

/** True when an authentication provider is available, i.e. sign-in is possible. */
export const isSsoConfigured = providers.length > 0;

/** Environment variables that must be set for SSO sign-in to work. */
export function missingSsoEnvVars(): string[] {
  return [
    process.env.OIDC_ISSUER ? null : "OIDC_ISSUER",
    process.env.OIDC_CLIENT_ID ? null : "OIDC_CLIENT_ID",
    process.env.OIDC_CLIENT_SECRET ? null : "OIDC_CLIENT_SECRET",
  ].filter((name): name is string => name !== null);
}

/** Human-readable reason to log and return when sign-in cannot be served. */
export function ssoConfigurationError(): string {
  return (
    "No authentication provider is configured. This application is SSO-only: " +
    `set the following environment variable(s) and restart — ${missingSsoEnvVars().join(", ")}.`
  );
}

export const authOptions: NextAuthOptions = {
  providers,
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "oidc") {
        const sub = account.providerAccountId;

        let [dbUser] = await db.select().from(users)
          .where(eq(users.providerSub, sub))
          .limit(1);

        if (!dbUser) {
          // First sign-in for this subject: link it to the account an ADMIN
          // pre-created at /settings/users, matching on email or username.
          //
          // `profile()` above always resolves a username (preferred_username, then
          // email, then sub), so this reads whatever it decided. Note that when the
          // IDP omits preferred_username this is the FULL email address, not its
          // local part — which is why matching on the stored email matters below.
          const oidcUsername = (user as NextAuthUser & { username?: string }).username || sub;

          // 1. Match by email (if IDP provides one and local user has it stored).
          //    Only link when the row is not already bound to another OIDC sub.
          //    The email column is intentionally NOT unique (schema.ts), so a
          //    second directory identity sharing an address could otherwise
          //    overwrite providerSub below and take over the linked account.
          //    This branch is what lets a seeded admin (username + email, no
          //    providerSub) sign in on a fresh deployment.
          if (user.email) {
            const [foundEmailUser] = await db.select().from(users).where(eq(users.email, user.email)).limit(1);
            if (foundEmailUser && !foundEmailUser.providerSub) dbUser = foundEmailUser;
          }

          // 2. Match by username (primary identifier in this app since email is optional).
          //    Only link if the existing user has NOT already been linked to another OIDC sub
          //    (providerSub is null) to prevent account takeover.
          if (!dbUser) {
            const [foundUsernameUser] = await db.select().from(users)
              .where(eq(users.username, oidcUsername))
              .limit(1);
            if (foundUsernameUser && !foundUsernameUser.providerSub) {
              dbUser = foundUsernameUser;
            }
          }

          if (dbUser) {
            // Link existing (admin-provisioned) account to OIDC provider.
            const [updated] = await db.update(users)
              .set({
                provider: 'oidc',
                providerSub: sub,
                email: user.email || dbUser.email,
                displayName: user.name || dbUser.displayName,
              })
              .where(eq(users.id, dbUser.id))
              .returning();
            dbUser = updated;
          } else {
            // No JIT provisioning. The UI is restricted to admin-provisioned
            // operations/admin accounts only. An SSO identity that has no
            // pre-created, matching account is denied sign-in — the system must
            // never auto-grant access to arbitrary directory users (SEC/audit
            // requirement: no "other users" can enter the operations UI).
            console.warn(`[auth] Denied OIDC sign-in for unprovisioned identity sub=${sub} username=${oidcUsername}`);
            return false;
          }
        } else {
          // Update display info from IDP on each login
          await db.update(users)
            .set({
              email: user.email || dbUser.email,
              displayName: user.name || dbUser.displayName,
            })
            .where(eq(users.id, dbUser.id));
        }

        // Attach DB identity so jwt callback picks it up
        user.id = dbUser.id;
        (user as NextAuthUser & { username: string }).username = dbUser.username;
        (user as NextAuthUser & { role: string }).role = dbUser.role;
      }
      return true;
    },
    // No `redirect` callback on purpose. NextAuth's default already restricts
    // absolute callbackUrls to the deployment origin; a previous override
    // accepted ANY syntactically valid absolute URL (an open redirect) to work
    // around NEXTAUTH_URL being set to localhost behind Nginx. Deployments set
    // NEXTAUTH_URL to the real domain, so the default behaviour is correct and
    // the override is not needed.
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = (user as NextAuthUser & { username: string }).username;
        token.role = (user as NextAuthUser & { role: string }).role;
      } else {
        // JWT sessions outlive role changes. Refresh browser identity from the
        // authoritative User record whenever NextAuth resolves the session.
        const userId = token.id as string | undefined;
        if (!userId) {
          throw new Error("Invalid session token: missing user ID");
        }

        const [currentUser] = await db.select({
          username: users.username,
          role: users.role,
        }).from(users)
          .where(eq(users.id, userId))
          .limit(1);

        if (!currentUser) {
          // Never retain stale privileges for a deleted/disabled identity.
          throw new Error("Session user no longer exists");
        }

        token.username = currentUser.username;
        token.role = currentUser.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user = {
          ...session.user,
          id: token.id as string,
          username: token.username as string,
          role: token.role as string,
        };
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    // Send failures back to the sign-in page instead of NextAuth's built-in error
    // page. Without this, a denied sign-in redirects to /api/auth/error and the
    // operator sees a generic page with no idea what to do — and denial is the
    // expected outcome for anyone an ADMIN has not provisioned yet.
    // `/login` bypasses the middleware, so it does not require authentication
    // (a requirement NextAuth enforces for the error page).
    error: "/login",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET!,
};
