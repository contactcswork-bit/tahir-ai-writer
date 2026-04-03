import app from "./app";
import { logger } from "./lib/logger";
import { db, usersTable, appSettingsTable } from "@workspace/db";
import { hashPassword } from "./lib/auth";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function seedAdminIfNeeded() {
  try {
    const existing = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
    if (existing.length === 0) {
      await db.insert(usersTable).values({
        email: "tahirkhatri1927@gmail.com",
        passwordHash: hashPassword("tahir123@#"),
        role: "admin",
        name: "Tahir Admin",
        isActive: true,
      });
      logger.info("Admin user created in production database");
    }

    const settings = await db.select({ id: appSettingsTable.id }).from(appSettingsTable).limit(1);
    if (settings.length === 0) {
      await db.insert(appSettingsTable).values({});
      logger.info("Default app settings created in production database");
    }
  } catch (err) {
    logger.warn({ err }, "Startup seed failed (non-fatal)");
  }
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Seed admin user and settings if production DB is empty
  await seedAdminIfNeeded();
});
