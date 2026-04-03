import { Router, type IRouter } from "express";
import { db, sitesTable, foldersTable } from "@workspace/db";
import { eq, and, ilike, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import {
  ListSitesQueryParams,
  CreateSiteBody,
  BulkAddSitesBody,
  AutoConnectSiteBody,
  UpdateSiteBody,
  GetSiteParams,
  UpdateSiteParams,
  DeleteSiteParams,
  TestSiteParams,
  ToggleSitePinParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function testWordPressConnection(url: string, username: string, password: string): Promise<{ success: boolean; message: string }> {
  try {
    const siteUrl = url.replace(/\/$/, "");
    const credentials = Buffer.from(`${username}:${password}`).toString("base64");
    const response = await fetch(`${siteUrl}/wp-json/wp/v2/posts?per_page=1`, {
      headers: { "Authorization": `Basic ${credentials}` },
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok || response.status === 200) {
      return { success: true, message: "Connected successfully" };
    }
    return { success: false, message: `HTTP ${response.status}: ${response.statusText}` };
  } catch (err: any) {
    return { success: false, message: err?.message || "Connection failed" };
  }
}

router.get("/sites", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const params = ListSitesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  let query = db.select().from(sitesTable).where(eq(sitesTable.userId, user.id));

  const sites = await db.select().from(sitesTable).where(eq(sitesTable.userId, user.id)).orderBy(sitesTable.isPinned, sitesTable.createdAt);
  res.json(sites);
});

router.post("/sites", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const parsed = CreateSiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const siteUrl = parsed.data.url.replace(/\/$/, "");
  const siteName = parsed.data.name || new URL(siteUrl).hostname;

  const [site] = await db.insert(sitesTable).values({
    userId: user.id,
    name: siteName,
    url: siteUrl,
    username: parsed.data.username,
    applicationPassword: parsed.data.applicationPassword,
    folderId: parsed.data.folderId || null,
    category: parsed.data.category || "General",
    status: "pending",
  }).returning();

  res.status(201).json(site);
});

router.post("/sites/bulk-add", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const parsed = BulkAddSitesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const results = [];
  let failed = 0;

  for (const s of parsed.data.sites) {
    try {
      const siteUrl = s.url.replace(/\/$/, "");
      const siteName = s.name || new URL(siteUrl).hostname;
      const [site] = await db.insert(sitesTable).values({
        userId: user.id,
        name: siteName,
        url: siteUrl,
        username: s.username,
        applicationPassword: s.applicationPassword,
        folderId: s.folderId || null,
        category: s.category || "General",
        status: "pending",
      }).returning();
      results.push(site);
    } catch {
      failed++;
    }
  }

  res.json({ added: results.length, failed, sites: results });
});

router.post("/sites/auto-connect", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const parsed = AutoConnectSiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const siteUrl = parsed.data.url.replace(/\/$/, "");
  const siteName = new URL(siteUrl).hostname;

  const [site] = await db.insert(sitesTable).values({
    userId: user.id,
    name: siteName,
    url: siteUrl,
    username: "auto-connect",
    applicationPassword: "pending",
    folderId: parsed.data.folderId || null,
    category: "General",
    status: "pending",
  }).returning();

  res.json(site);
});

router.post("/sites/test-all", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const sites = await db.select().from(sitesTable).where(eq(sitesTable.userId, user.id));

  const results = await Promise.all(
    sites.map(async (site) => {
      const result = await testWordPressConnection(site.url, site.username, site.applicationPassword);
      const status = result.success ? "connected" : "disconnected";
      await db.update(sitesTable).set({ status, lastTested: new Date() }).where(eq(sitesTable.id, site.id));
      return { siteId: site.id, ...result };
    })
  );

  const totalPassed = results.filter((r) => r.success).length;
  const totalFailed = results.filter((r) => !r.success).length;

  res.json({ results, totalTested: results.length, totalPassed, totalFailed });
});

router.get("/sites/:id", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const params = GetSiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [site] = await db.select().from(sitesTable).where(
    and(eq(sitesTable.id, params.data.id), eq(sitesTable.userId, user.id))
  );
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  res.json(site);
});

router.patch("/sites/:id", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const params = UpdateSiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateSiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: any = {};
  if (parsed.data.name != null) updateData.name = parsed.data.name;
  if (parsed.data.url != null) updateData.url = parsed.data.url;
  if (parsed.data.username != null) updateData.username = parsed.data.username;
  if (parsed.data.applicationPassword != null) updateData.applicationPassword = parsed.data.applicationPassword;
  if (parsed.data.folderId !== undefined) updateData.folderId = parsed.data.folderId;
  if (parsed.data.category != null) updateData.category = parsed.data.category;
  if (parsed.data.isPinned != null) updateData.isPinned = parsed.data.isPinned;

  const [site] = await db.update(sitesTable).set(updateData).where(
    and(eq(sitesTable.id, params.data.id), eq(sitesTable.userId, user.id))
  ).returning();

  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  res.json(site);
});

router.delete("/sites/:id", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const params = DeleteSiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db.delete(sitesTable).where(
    and(eq(sitesTable.id, params.data.id), eq(sitesTable.userId, user.id))
  );
  res.sendStatus(204);
});

router.post("/sites/:id/test", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const params = TestSiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [site] = await db.select().from(sitesTable).where(
    and(eq(sitesTable.id, params.data.id), eq(sitesTable.userId, user.id))
  );
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }

  const result = await testWordPressConnection(site.url, site.username, site.applicationPassword);
  const status = result.success ? "connected" : "disconnected";
  await db.update(sitesTable).set({ status, lastTested: new Date() }).where(eq(sitesTable.id, site.id));

  res.json({ siteId: site.id, ...result });
});

router.patch("/sites/:id/pin", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const params = ToggleSitePinParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [site] = await db.select().from(sitesTable).where(
    and(eq(sitesTable.id, params.data.id), eq(sitesTable.userId, user.id))
  );
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }

  const [updated] = await db.update(sitesTable).set({ isPinned: !site.isPinned }).where(eq(sitesTable.id, site.id)).returning();
  res.json(updated);
});

export default router;
