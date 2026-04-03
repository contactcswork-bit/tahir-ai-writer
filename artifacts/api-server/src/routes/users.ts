import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin, hashPassword } from "../lib/auth";
import {
  CreateUserBody,
  UpdateUserBody,
  GetUserParams,
  UpdateUserParams,
  DeleteUserParams,
  ResetUserPasswordParams,
  ResetUserPasswordBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/users", requireAdmin, async (_req, res): Promise<void> => {
  const users = await db.select({
    id: usersTable.id,
    email: usersTable.email,
    name: usersTable.name,
    role: usersTable.role,
    permissions: usersTable.permissions,
    createdAt: usersTable.createdAt,
  }).from(usersTable).orderBy(usersTable.createdAt);
  res.json(users);
});

router.post("/users", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { password, ...rest } = parsed.data;
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, rest.email.toLowerCase()));
  if (existing.length > 0) {
    res.status(400).json({ error: "Email already exists" });
    return;
  }

  const [user] = await db.insert(usersTable).values({
    ...rest,
    email: rest.email.toLowerCase(),
    passwordHash: hashPassword(password),
    permissions: rest.permissions || {
      canGenerate: true,
      canPublish: true,
      canSchedule: true,
      canManageSites: true,
      maxSites: null,
      maxArticlesPerDay: null,
    },
  }).returning();

  const { passwordHash, ...safeUser } = user;
  res.status(201).json(safeUser);
});

router.get("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [user] = await db.select({
    id: usersTable.id,
    email: usersTable.email,
    name: usersTable.name,
    role: usersTable.role,
    permissions: usersTable.permissions,
    createdAt: usersTable.createdAt,
  }).from(usersTable).where(eq(usersTable.id, params.data.id));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(user);
});

router.patch("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: any = {};
  if (parsed.data.email) updateData.email = parsed.data.email.toLowerCase();
  if (parsed.data.name) updateData.name = parsed.data.name;
  if (parsed.data.role) updateData.role = parsed.data.role;
  if (parsed.data.permissions) updateData.permissions = parsed.data.permissions;

  const [user] = await db.update(usersTable).set(updateData).where(eq(usersTable.id, params.data.id)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const { passwordHash, ...safeUser } = user;
  res.json(safeUser);
});

router.delete("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db.delete(usersTable).where(eq(usersTable.id, params.data.id));
  res.sendStatus(204);
});

router.post("/users/:id/reset-password", requireAdmin, async (req, res): Promise<void> => {
  const params = ResetUserPasswordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = ResetUserPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db.update(usersTable)
    .set({ passwordHash: hashPassword(parsed.data.newPassword) })
    .where(eq(usersTable.id, params.data.id))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ success: true, message: "Password reset successfully" });
});

export default router;
