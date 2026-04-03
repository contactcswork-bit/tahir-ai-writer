import { Router, type IRouter } from "express";
import { db, articlesTable, sitesTable } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq, and, gte, count, sql, sum, avg, isNotNull } from "drizzle-orm";
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

// Admin-only: daily usage stats with per-article token breakdown
router.get("/dashboard/usage", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  // Today's per-article breakdown (all users, admin sees everyone)
  const todayArticles = await db
    .select({
      id: articlesTable.id,
      keyword: articlesTable.keyword,
      status: articlesTable.status,
      wordCount: articlesTable.wordCount,
      tokensPrompt: articlesTable.tokensPrompt,
      tokensCompletion: articlesTable.tokensCompletion,
      tokensTotal: articlesTable.tokensTotal,
      createdAt: articlesTable.createdAt,
      userId: articlesTable.userId,
    })
    .from(articlesTable)
    .where(gte(articlesTable.createdAt, today))
    .orderBy(sql`${articlesTable.createdAt} desc`);

  // Today's summary totals (only articles with token data)
  const todaySummary = await db
    .select({
      totalArticles: count(),
      totalTokens: sum(articlesTable.tokensTotal),
      avgTokens: avg(articlesTable.tokensTotal),
      totalPromptTokens: sum(articlesTable.tokensPrompt),
      totalCompletionTokens: sum(articlesTable.tokensCompletion),
    })
    .from(articlesTable)
    .where(and(gte(articlesTable.createdAt, today), isNotNull(articlesTable.tokensTotal)));

  // Last 7 days daily totals
  const dailyTotals = await db
    .select({
      date: sql<string>`DATE(${articlesTable.createdAt} AT TIME ZONE 'UTC')`,
      articles: count(),
      tokens: sum(articlesTable.tokensTotal),
    })
    .from(articlesTable)
    .where(and(gte(articlesTable.createdAt, sevenDaysAgo), isNotNull(articlesTable.tokensTotal)))
    .groupBy(sql`DATE(${articlesTable.createdAt} AT TIME ZONE 'UTC')`)
    .orderBy(sql`DATE(${articlesTable.createdAt} AT TIME ZONE 'UTC') asc`);

  // Per-user breakdown for today
  const userBreakdown = await db
    .select({
      userId: articlesTable.userId,
      articles: count(),
      tokens: sum(articlesTable.tokensTotal),
    })
    .from(articlesTable)
    .where(and(gte(articlesTable.createdAt, today), isNotNull(articlesTable.tokensTotal)))
    .groupBy(articlesTable.userId);

  const summary = todaySummary[0] || {};

  res.json({
    summary: {
      totalArticles: Number(summary.totalArticles || 0),
      totalTokens: Number(summary.totalTokens || 0),
      avgTokensPerArticle: Math.round(Number(summary.avgTokens || 0)),
      totalPromptTokens: Number(summary.totalPromptTokens || 0),
      totalCompletionTokens: Number(summary.totalCompletionTokens || 0),
    },
    todayArticles: todayArticles.map(a => ({
      id: a.id,
      keyword: a.keyword,
      status: a.status,
      wordCount: a.wordCount || 0,
      tokensPrompt: a.tokensPrompt || 0,
      tokensCompletion: a.tokensCompletion || 0,
      tokensTotal: a.tokensTotal || 0,
      createdAt: a.createdAt,
      userId: a.userId,
    })),
    dailyTotals: dailyTotals.map(d => ({
      date: d.date,
      articles: Number(d.articles || 0),
      tokens: Number(d.tokens || 0),
    })),
    userBreakdown: userBreakdown.map(u => ({
      userId: u.userId,
      articles: Number(u.articles || 0),
      tokens: Number(u.tokens || 0),
    })),
  });
});

export default router;
