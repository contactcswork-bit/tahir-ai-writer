import { Router, type IRouter } from "express";
import { db, foldersTable, sitesTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import {
  CreateFolderBody,
  UpdateFolderParams,
  UpdateFolderBody,
  DeleteFolderParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/folders", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const folders = await db.select().from(foldersTable).where(eq(foldersTable.userId, user.id)).orderBy(foldersTable.createdAt);

  const foldersWithCount = await Promise.all(
    folders.map(async (folder) => {
      const [result] = await db.select({ count: count() }).from(sitesTable).where(eq(sitesTable.folderId, folder.id));
      return { ...folder, siteCount: Number(result?.count || 0) };
    })
  );

  res.json(foldersWithCount);
});

router.post("/folders", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const parsed = CreateFolderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [folder] = await db.insert(foldersTable).values({
    userId: user.id,
    name: parsed.data.name,
  }).returning();

  res.status(201).json({ ...folder, siteCount: 0 });
});

router.patch("/folders/:id", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const params = UpdateFolderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateFolderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [folder] = await db.update(foldersTable).set({ name: parsed.data.name }).where(
    and(eq(foldersTable.id, params.data.id), eq(foldersTable.userId, user.id))
  ).returning();

  if (!folder) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }

  const [result] = await db.select({ count: count() }).from(sitesTable).where(eq(sitesTable.folderId, folder.id));
  res.json({ ...folder, siteCount: Number(result?.count || 0) });
});

router.delete("/folders/:id", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const params = DeleteFolderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db.update(sitesTable).set({ folderId: null }).where(
    and(eq(sitesTable.folderId, params.data.id), eq(sitesTable.userId, user.id))
  );

  await db.delete(foldersTable).where(
    and(eq(foldersTable.id, params.data.id), eq(foldersTable.userId, user.id))
  );
  res.sendStatus(204);
});

export default router;
