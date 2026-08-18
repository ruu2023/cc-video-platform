#!/usr/bin/env node
/**
 * Schema + seed runner for the libSQL/Turso database.
 *
 *   node --env-file=.env scripts/db.mjs migrate
 *   node --env-file=.env scripts/db.mjs seed
 *   node --env-file=.env scripts/db.mjs reset            (migrate + re-seed)
 *   node --env-file=.env scripts/db.mjs role <email> creator|viewer
 *
 * Seeding is idempotent: courses are upserted by id and each course's chapters
 * are replaced wholesale, so re-running never produces duplicates.
 */

import { createClient } from "@libsql/client";
import { hashPassword } from "@better-auth/utils/password";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { courses, instructor, accounts } from "./seed-data.mjs";
import { VIDEO_ASSETS } from "./make-videos.mjs";
import { makeResources } from "./make-resources.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const url = process.env.TURSO_DATABASE_URL ?? "file:./data/app.db";
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

const db = createClient({ url, authToken });

const ROLES = ["creator", "viewer"];

async function tableExists(name) {
  const result = await db.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    args: [name],
  });
  return result.rows.length > 0;
}

/** ALTER TABLE ... ADD COLUMN, but only when the column is really missing. */
async function ensureColumn(table, column, definition) {
  if (!(await tableExists(table))) return false;
  const info = await db.execute(`PRAGMA table_info(${table})`);
  if (info.rows.some((row) => row.name === column)) return false;
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

async function migrate() {
  const sql = await readFile(resolve(here, "schema.sql"), "utf8");
  const statements = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await db.execute(statement);
  }

  // Incremental changes for databases created before Sprint 2. SQLite cannot
  // express "ADD COLUMN IF NOT EXISTS", hence the explicit probe.
  const added = [];
  if (await ensureColumn("chapter", "bunny_video_id", "TEXT NOT NULL DEFAULT ''")) {
    added.push("chapter.bunny_video_id");
  }
  if (await ensureColumn("chapter", "video_url", "TEXT NOT NULL DEFAULT ''")) {
    added.push("chapter.video_url");
  }
  // Sprint 4: local placeholder clip + its length, used until bunny.net is live.
  if (await ensureColumn("chapter", "video_asset", "TEXT NOT NULL DEFAULT ''")) {
    added.push("chapter.video_asset");
  }
  if (await ensureColumn("chapter", "duration_seconds", "REAL NOT NULL DEFAULT 0")) {
    added.push("chapter.duration_seconds");
  }
  // The `user` table belongs to better-auth; the app only adds the role column
  // that separates the creator from ordinary viewers.
  if (await tableExists("user")) {
    if (await ensureColumn("user", "role", "TEXT NOT NULL DEFAULT 'viewer'")) {
      added.push("user.role");
    }
  } else {
    console.warn(
      "migrate: `user` table not found — run `npm run auth:migrate`, then re-run migrate to add user.role."
    );
  }

  console.log(
    `migrate: applied ${statements.length} statement(s) to ${url}` +
      (added.length ? ` (+ added ${added.join(", ")})` : "")
  );
}

/** Deterministic, GUID-shaped bunny.net video id for the demo catalogue. */
function demoVideoId(courseId, index) {
  const hex = createHash("sha1").update(`${courseId}:${index}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

const BUNNY_LIBRARY_ID = process.env.BUNNY_LIBRARY_ID ?? "301842";

async function seedCourses() {
  let chapterCount = 0;

  for (const course of courses) {
    await db.execute({
      sql: `INSERT INTO course
              (id, title, subtitle, description, thumbnail_url, price_jpy,
               instructor_name, instructor_title, level, published, sort_order,
               updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT (id) DO UPDATE SET
              title            = excluded.title,
              subtitle         = excluded.subtitle,
              description      = excluded.description,
              thumbnail_url    = excluded.thumbnail_url,
              price_jpy        = excluded.price_jpy,
              instructor_name  = excluded.instructor_name,
              instructor_title = excluded.instructor_title,
              level            = excluded.level,
              published        = excluded.published,
              sort_order       = excluded.sort_order,
              updated_at       = datetime('now')`,
      args: [
        course.id,
        course.title,
        course.subtitle,
        course.description,
        course.thumbnailUrl,
        course.priceJpy,
        instructor.name,
        instructor.title,
        course.level,
        course.published,
        course.sortOrder,
      ],
    });

    // Chapters are replaced wholesale, so any progress pointing at the old
    // chapter ids goes with them. SQLite does not enforce ON DELETE CASCADE
    // unless PRAGMA foreign_keys is on, hence the explicit cleanup.
    if (await tableExists("chapter_progress")) {
      await db.execute({
        sql: "DELETE FROM chapter_progress WHERE course_id = ?",
        args: [course.id],
      });
    }

    await db.execute({
      sql: "DELETE FROM chapter WHERE course_id = ?",
      args: [course.id],
    });

    for (const [index, title] of course.chapters.entries()) {
      const videoId = demoVideoId(course.id, index);
      // Sprint 4: every chapter also points at one of the locally generated
      // placeholder clips (data/videos/), cycled so a course's chapters have
      // visibly different lengths. Replaced by the real bunny.net asset later.
      const asset = VIDEO_ASSETS[index % VIDEO_ASSETS.length];
      await db.execute({
        sql: `INSERT INTO chapter
                (id, course_id, position, title, bunny_video_id, video_url,
                 video_asset, duration_seconds)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          `${course.id}-${index + 1}`,
          course.id,
          index + 1,
          title,
          videoId,
          `https://iframe.mediadelivery.net/embed/${BUNNY_LIBRARY_ID}/${videoId}`,
          asset.name,
          asset.seconds,
        ],
      });
      chapterCount += 1;
    }
  }

  const published = courses.filter((c) => c.published === 1).length;
  console.log(
    `seed: ${courses.length} course(s) (${published} published, ` +
      `${courses.length - published} draft) and ${chapterCount} chapter(s) written`
  );
}

/**
 * Sprint 5: the demo course attachments.
 *
 * Runs after `seedCourses`, which replaces chapters wholesale — so this both
 * sweeps up `chapter_resource` rows whose chapter no longer exists and re-links
 * the generated files to the fresh chapter ids. Upsert-by-id keeps it
 * idempotent; only seeded ids are ever touched, so anything a creator uploaded
 * through the admin screens survives a re-seed untouched.
 */
async function seedResources() {
  if (!(await tableExists("upload")) || !(await tableExists("chapter_resource"))) {
    console.warn(
      "seed: upload/chapter_resource tables are missing — skipping attachments."
    );
    return;
  }

  // Orphans: chapters were just deleted and re-inserted with the same ids, but
  // an earlier catalogue edit may have left rows pointing at ids that are gone.
  const orphans = await db.execute(
    `DELETE FROM chapter_resource
      WHERE chapter_id NOT IN (SELECT id FROM chapter)`
  );

  const files = await makeResources({ quiet: true });
  let linked = 0;

  for (const file of files) {
    const chapter = await db.execute({
      sql: "SELECT id FROM chapter WHERE id = ? LIMIT 1",
      args: [file.chapter],
    });
    if (!chapter.rows[0]) {
      console.warn(`seed: chapter ${file.chapter} not found — skipping ${file.fileName}`);
      continue;
    }

    await db.execute({
      sql: `INSERT INTO upload
              (id, original_name, stored_name, mime_type, size_bytes, kind)
            VALUES (?, ?, ?, ?, ?, 'resource')
            ON CONFLICT (id) DO UPDATE SET
              original_name = excluded.original_name,
              stored_name   = excluded.stored_name,
              mime_type     = excluded.mime_type,
              size_bytes    = excluded.size_bytes,
              kind          = 'resource'`,
      args: [
        file.id,
        file.fileName,
        file.storedName,
        file.mimeType,
        file.sizeBytes,
      ],
    });

    // The link row is keyed off the upload id so re-seeding updates in place
    // instead of stacking duplicates on the chapter.
    await db.execute({
      sql: "DELETE FROM chapter_resource WHERE upload_id = ?",
      args: [file.id],
    });

    const next = await db.execute({
      sql: `SELECT COALESCE(MAX(position), 0) + 1 AS next
            FROM chapter_resource WHERE chapter_id = ?`,
      args: [file.chapter],
    });

    await db.execute({
      sql: `INSERT INTO chapter_resource
              (id, chapter_id, upload_id, label, position)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        `res-seed-${file.id}`,
        file.chapter,
        file.id,
        file.label,
        Number(next.rows[0]?.next ?? 1),
      ],
    });
    linked += 1;
  }

  console.log(
    `seed: ${linked} attachment(s) linked` +
      (orphans.rowsAffected ? ` (${orphans.rowsAffected} orphan row(s) removed)` : "")
  );
}

async function seedAccounts() {
  if (!(await tableExists("user"))) {
    console.warn(
      "seed: `user` table not found — skipping demo accounts. Run `npm run auth:migrate` then `npm run db:reset`."
    );
    return;
  }

  const now = new Date().toISOString();

  for (const account of accounts) {
    const existing = await db.execute({
      sql: "SELECT id FROM user WHERE email = ?",
      args: [account.email],
    });

    const userId = existing.rows[0] ? String(existing.rows[0].id) : account.id;

    if (existing.rows[0]) {
      await db.execute({
        sql: "UPDATE user SET name = ?, role = ?, updatedAt = ? WHERE id = ?",
        args: [account.name, account.role, now, userId],
      });
    } else {
      await db.execute({
        sql: `INSERT INTO user (id, name, email, emailVerified, image, role, createdAt, updatedAt)
              VALUES (?, ?, ?, 1, NULL, ?, ?, ?)`,
        args: [userId, account.name, account.email, account.role, now, now],
      });
    }

    // better-auth stores email/password credentials in `account` under the
    // "credential" provider, hashed with its own scrypt helper.
    const password = await hashPassword(account.password);
    const credential = await db.execute({
      sql: "SELECT id FROM account WHERE userId = ? AND providerId = 'credential'",
      args: [userId],
    });

    if (credential.rows[0]) {
      await db.execute({
        sql: "UPDATE account SET password = ?, updatedAt = ? WHERE id = ?",
        args: [password, now, String(credential.rows[0].id)],
      });
    } else {
      await db.execute({
        sql: `INSERT INTO account
                (id, accountId, providerId, userId, password, createdAt, updatedAt)
              VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
        args: [randomUUID(), userId, userId, password, now, now],
      });
    }
  }

  console.log(
    `seed: ${accounts.length} demo account(s) ready — ` +
      accounts.map((a) => `${a.email} (${a.role})`).join(", ")
  );
}

async function seed() {
  if (!(await tableExists("course")) || !(await tableExists("chapter"))) {
    throw new Error(
      "seed: course/chapter tables are missing. Run `npm run db:migrate` first."
    );
  }
  await seedCourses();
  await seedResources();
  await seedAccounts();
}

async function setRole(email, role) {
  if (!email) throw new Error("role: usage — db.mjs role <email> <creator|viewer>");
  if (!ROLES.includes(role)) {
    throw new Error(`role: role must be one of ${ROLES.join(", ")}`);
  }
  if (!(await tableExists("user"))) {
    throw new Error("role: `user` table not found. Run `npm run auth:migrate` first.");
  }

  const result = await db.execute({
    sql: "UPDATE user SET role = ?, updatedAt = ? WHERE email = ?",
    args: [role, new Date().toISOString(), email],
  });

  if (result.rowsAffected === 0) {
    throw new Error(`role: no user with email ${email}`);
  }
  console.log(`role: ${email} is now ${role}`);
}

async function main() {
  const command = process.argv[2] ?? "migrate";

  switch (command) {
    case "migrate":
      await migrate();
      break;
    case "seed":
      await seed();
      break;
    case "reset":
      await migrate();
      await seed();
      break;
    case "role":
      await setRole(process.argv[3], process.argv[4]);
      break;
    default:
      throw new Error(`Unknown command: ${command} (use migrate|seed|reset|role)`);
  }
}

main()
  .then(() => db.close())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    db.close();
    process.exit(1);
  });
