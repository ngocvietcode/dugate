import { NextAuthOptions, User as NextAuthUser } from "next-auth";
import { OAuthConfig } from "next-auth/providers/oauth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// Build providers list
const providers: NextAuthOptions["providers"] = [
  CredentialsProvider({
    name: "Credentials",
    credentials: {
      username: { label: "Tài khoản", type: "text", placeholder: "admin" },
      password: { label: "Mật khẩu", type: "password" },
    },
    async authorize(credentials) {
      if (!credentials?.username || !credentials?.password) {
        throw new Error("Vui lòng nhập tài khoản và mật khẩu");
      }

      const [user] = await db.select().from(users)
        .where(eq(users.username, credentials.username))
        .limit(1);

      if (!user) {
        throw new Error("Tài khoản không tồn tại");
      }

      if (!user.password) {
        throw new Error("Tài khoản này sử dụng đăng nhập SSO");
      }

      const isPasswordValid = await bcrypt.compare(
        credentials.password,
        user.password
      );

      if (!isPasswordValid) {
        throw new Error("Mật khẩu không chính xác");
      }

      return {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.username,
      };
    },
  }),
];

// Conditionally add OIDC provider
const isOidcEnabled = process.env.OIDC_ENABLED === "true" || process.env.NEXT_PUBLIC_OIDC_ENABLED === "true";
if (isOidcEnabled && process.env.OIDC_ISSUER) {
  const oidcProvider: OAuthConfig<{ sub: string; preferred_username?: string; email?: string; name?: string }> = {
    id: "oidc",
    name: "SSO",
    type: "oauth",
    wellKnown: `${process.env.OIDC_ISSUER}/.well-known/openid-configuration`,
    clientId: process.env.OIDC_CLIENT_ID!,
    clientSecret: process.env.OIDC_CLIENT_SECRET!,
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
          // Check if an existing user matches by email — link instead of duplicate
          // Username match is intentionally skipped: usernames are not globally unique identifiers
          // and could cause unintended account takeover.
          const oidcUsername = (user as NextAuthUser & { username?: string }).username || user.email?.split('@')[0] || sub;
          if (user.email) {
            const [foundEmailUser] = await db.select().from(users).where(eq(users.email, user.email)).limit(1);
            dbUser = foundEmailUser ?? null;
          }

          if (dbUser) {
            // Link existing user to OIDC provider
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
            // JIT provision: create new user with VIEWER role
            let username = oidcUsername;
            let suffix = 1;
            while ((await db.select().from(users).where(eq(users.username, username)).limit(1)).length > 0) {
              username = `${oidcUsername}_${suffix++}`;
            }

            const [newUser] = await db.insert(users).values({
              username,
              password: "",
              role: "VIEWER",
              provider: "oidc",
              providerSub: sub,
              email: user.email || null,
              displayName: user.name || null,
            }).returning();
            dbUser = newUser;
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
    // Fix: NextAuth v4 validate callbackUrl dựa theo NEXTAUTH_URL (baseUrl).
    // Khi chạy sau Nginx trên VPS, NEXTAUTH_URL có thể là localhost nhưng
    // callbackUrl từ client là production domain → NextAuth reject và redirect về localhost.
    // Giải pháp: accept mọi absolute URL hợp lệ, vì callbackUrl được set từ
    // window.location.origin ở phía client nên luôn là domain thực tế của user.
    async redirect({ url, baseUrl }) {
      // Relative URL (e.g. /login) → prepend baseUrl
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      // Absolute URL hợp lệ → pass through trực tiếp
      // (không validate theo NEXTAUTH_URL để tránh redirect về localhost)
      try {
        new URL(url); // validate cú pháp URL
        return url;
      } catch {
        return baseUrl;
      }
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = (user as NextAuthUser & { username: string }).username;
        token.role = (user as NextAuthUser & { role: string }).role;
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
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET!,
};
