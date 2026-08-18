import { betterAuth } from "better-auth";
import { LibsqlDialect } from "@libsql/kysely-libsql";
import { databaseAuthToken, databaseUrl } from "@/lib/db";

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error(
    "BETTER_AUTH_SECRET is not set. Copy .env.example to .env and fill it in."
  );
}

// Vercel sets this to the exact host of the current deployment (preview or
// production) at build/runtime — unlike a hardcoded BETTER_AUTH_URL, it never
// goes stale across redeploys, and unlike a "*.vercel.app" trustedOrigins
// wildcard it can't be satisfied by an unrelated attacker-owned Vercel app.
const vercelDeploymentURL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : undefined;

export const auth = betterAuth({
  appName: "Kouza",
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL:
    process.env.BETTER_AUTH_URL ?? vercelDeploymentURL ?? "http://localhost:3000",
  database: {
    dialect: new LibsqlDialect({
      url: databaseUrl,
      authToken: databaseAuthToken,
    }),
    type: "sqlite",
  },
  user: {
    additionalFields: {
      // "creator" reaches the admin area; everyone who signs up is a "viewer".
      // `input: false` keeps the field out of the public signup payload so a
      // visitor cannot promote themselves by posting role: "creator".
      role: {
        type: "string",
        required: false,
        defaultValue: "viewer",
        input: false,
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    // No transactional email in scope (see spec.md "スコープ外"), so accounts
    // are usable immediately after signup.
    requireEmailVerification: false,
    minPasswordLength: 8,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    cookiePrefix: "kouza",
  },
});

export type Session = typeof auth.$Infer.Session;
