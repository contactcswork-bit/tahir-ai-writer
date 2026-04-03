import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, requireAuth } from "../lib/auth";
import { LoginBody, ChangePasswordBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const token = generateToken(user.id);
  const { passwordHash, ...safeUser } = user;
  res.json({ user: safeUser, token });
});

router.post("/auth/logout", async (_req, res): Promise<void> => {
  res.json({ success: true, message: "Logged out" });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const { passwordHash, ...safeUser } = user;
  res.json(safeUser);
});

router.post("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const user = (req as any).user;
  const { currentPassword, newPassword } = parsed.data;

  if (!verifyPassword(currentPassword, user.passwordHash)) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }

  await db.update(usersTable).set({ passwordHash: hashPassword(newPassword) }).where(eq(usersTable.id, user.id));
  res.json({ success: true, message: "Password changed successfully" });
});

export default router;
