import { createClient, type Client } from "@libsql/client";

/**
 * libSQL connection settings.
 *
 * The app talks to Turso through the official libSQL driver. Set
 * TURSO_DATABASE_URL to `libsql://<db>-<org>.turso.io` together with
 * TURSO_AUTH_TOKEN to run against Turso Cloud; the default `file:` URL uses an
 * embedded libSQL (SQLite-compatible) file so the app runs locally with the
 * exact same driver and SQL dialect.
 */
export const databaseUrl = process.env.TURSO_DATABASE_URL ?? "file:./data/app.db";
export const databaseAuthToken = process.env.TURSO_AUTH_TOKEN || undefined;

declare global {
  // Reuse the client across Next.js dev-server hot reloads.
  var __libsqlClient: Client | undefined;
}

function build(): Client {
  return createClient({ url: databaseUrl, authToken: databaseAuthToken });
}

export const db: Client = globalThis.__libsqlClient ?? build();

if (process.env.NODE_ENV !== "production") {
  globalThis.__libsqlClient = db;
}
