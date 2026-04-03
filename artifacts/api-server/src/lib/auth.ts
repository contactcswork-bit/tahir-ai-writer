import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "tahir-ai-writer-salt").digest("hex");
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

export function generateToken(userId: number): string {
  const payload = `${userId}:${Date.now()}:${Math.random()}`;
  return Buffer.from(payload).toString("base64");
}

export function parseToken(token: string): number | null {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const parts = decoded.split(":");
    const userId = parseInt(parts[0], 10);
    if (isNaN(userId)) return null;
    return userId;
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = auth.slice(7);
  const userId = parseToken(token);
  if (!userId) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  (req as any).user = user;
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, async () => {
    const user = (req as any).user;
    if (user.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  });
}
