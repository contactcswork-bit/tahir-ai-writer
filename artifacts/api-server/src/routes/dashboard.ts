import { Router, type IRouter } from "express";
import { db, articlesTable, sitesTable } from "@workspace/db";
import { eq, and, gte, count, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.get("/dashboard/stats", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [totalSitesResult] = await db.select({ count: count() }).from(sitesTable).where(eq(sitesTable.userId, user.id));
  const [connectedSitesResult] = await db.select({ count: count() }).from(sitesTable).where(
    and(eq(sitesTable.userId, user.id), eq(sitesTable.status, "connected"))
  );

  const [publishedTodayResult] = await db.select({ count: count() }).from(articlesTable).where(
    and(eq(articlesTable.userId, user.id), eq(articlesTable.status, "published"), gte(articlesTable.publishedAt, today))
  );

  const [draftsTodayResult] = await db.select({ count: count() }).from(articlesTable).where(
    and(eq(articlesTable.userId, user.id), eq(articlesTable.status, "draft"), gte(articlesTable.createdAt, today))
  );

  const [failedTodayResult] = await db.select({ count: count() }).from(articlesTable).where(
    and(eq(articlesTable.userId, user.id), eq(articlesTable.status, "failed"), gte(articlesTable.createdAt, today))
  );

  const [totalArticlesResult] = await db.select({ count: count() }).from(articlesTable).where(eq(articlesTable.userId, user.id));
  const [totalPublishedResult] = await db.select({ count: count() }).from(articlesTable).where(
    and(eq(articlesTable.userId, user.id), eq(articlesTable.status, "published"))
  );
  const [totalFailedResult] = await db.select({ count: count() }).from(articlesTable).where(
    and(eq(articlesTable.userId, user.id), eq(articlesTable.status, "failed"))
  );
  const [totalDraftsResult] = await db.select({ count: count() }).from(articlesTable).where(
    and(eq(articlesTable.userId, user.id), eq(articlesTable.status, "draft"))
  );
  const [scheduledResult] = await db.select({ count: count() }).from(articlesTable).where(
    and(eq(articlesTable.userId, user.id), eq(articlesTable.status, "scheduled"))
  );

  res.json({
    totalSites: Number(totalSitesResult?.count || 0),
    connectedSites: Number(connectedSitesResult?.count || 0),
    publishedToday: Number(publishedTodayResult?.count || 0),
    draftsToday: Number(draftsTodayResult?.count || 0),
    failedToday: Number(failedTodayResult?.count || 0),
    totalArticles: Number(totalArticlesResult?.count || 0),
    totalPublished: Number(totalPublishedResult?.count || 0),
    totalFailed: Number(totalFailedResult?.count || 0),
    totalDrafts: Number(totalDraftsResult?.count || 0),
    scheduledCount: Number(scheduledResult?.count || 0),
  });
});

router.get("/dashboard/sites-overview", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const sites = await db.select().from(sitesTable).where(eq(sitesTable.userId, user.id)).orderBy(sitesTable.createdAt);

  const sitesWithStats = await Promise.all(
    sites.map(async (site) => {
      const [publishedResult] = await db.select({ count: count() }).from(articlesTable).where(
        and(eq(articlesTable.siteId, site.id), eq(articlesTable.status, "published"))
      );
      return {
        id: site.id,
        name: site.name,
        url: site.url,
        status: site.status,
        category: site.category,
        articlesPublished: Number(publishedResult?.count || 0),
      };
    })
  );

  const totalActive = sites.length;
  const totalConnected = sites.filter((s) => s.status === "connected").length;

  res.json({ totalActive, totalConnected, sites: sitesWithStats });
});

export default router;
