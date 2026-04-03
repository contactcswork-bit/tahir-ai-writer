import { Router, type IRouter } from "express";
import { db, articlesTable, sitesTable } from "@workspace/db";
import { eq, and, desc, gte, ilike, or, isNotNull, count } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import {
  ListArticlesQueryParams,
  GetArticleParams,
  DeleteArticleParams,
  RetryArticleParams,
} from "@workspace/api-zod";
import { addToQueue } from "../lib/generator";

const router: IRouter = Router();

router.get("/articles", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const params = ListArticlesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { status, search, siteId, page = 1, limit = 20 } = params.data;
  const offset = ((Number(page) || 1) - 1) * (Number(limit) || 20);

  const conditions: any[] = [eq(articlesTable.userId, user.id)];

  if (status && status !== "all") {
    conditions.push(eq(articlesTable.status, status));
  }

  if (search) {
    conditions.push(
      or(
        ilike(articlesTable.keyword, `%${search}%`),
        ilike(articlesTable.title, `%${search}%`)
      )
    );
  }

  if (siteId) {
    conditions.push(eq(articlesTable.siteId, Number(siteId)));
  }

  const articles = await db.select().from(articlesTable)
    .leftJoin(sitesTable, eq(articlesTable.siteId, sitesTable.id))
    .where(and(...conditions))
    .orderBy(desc(articlesTable.createdAt))
    .limit(Number(limit) || 20)
    .offset(offset);

  const [countResult] = await db.select({ count: count() }).from(articlesTable).where(and(...conditions));

  const mapped = articles.map(({ articles: a, sites: s }) => ({
    ...a,
    siteName: s?.name || null,
    siteUrl: s?.url || null,
  }));

  res.json({
    articles: mapped,
    total: Number(countResult?.count || 0),
    page: Number(page) || 1,
    limit: Number(limit) || 20,
  });
});

router.get("/articles/today-urls", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const articles = await db.select().from(articlesTable)
    .leftJoin(sitesTable, eq(articlesTable.siteId, sitesTable.id))
    .where(
      and(
        eq(articlesTable.userId, user.id),
        eq(articlesTable.status, "published"),
        isNotNull(articlesTable.publishedUrl),
        gte(articlesTable.createdAt, today)
      )
    )
    .orderBy(desc(articlesTable.createdAt));

  const grouped: Record<string, any> = {};
  for (const { articles: a, sites: s } of articles) {
    if (!a.publishedUrl) continue;
    const siteKey = s?.id?.toString() || "unknown";
    if (!grouped[siteKey]) {
      grouped[siteKey] = {
        siteName: s?.name || "Unknown Site",
        siteUrl: s?.url || "",
        articles: [],
      };
    }
    grouped[siteKey].articles.push({
      id: a.id,
      title: a.title || a.keyword,
      url: a.publishedUrl,
      publishedAt: a.publishedAt?.toISOString() || a.createdAt.toISOString(),
    });
  }

  res.json(Object.values(grouped));
});

router.get("/articles/:id", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const params = GetArticleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [result] = await db.select().from(articlesTable)
    .leftJoin(sitesTable, eq(articlesTable.siteId, sitesTable.id))
    .where(and(eq(articlesTable.id, params.data.id), eq(articlesTable.userId, user.id)));

  if (!result) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  res.json({ ...result.articles, siteName: result.sites?.name || null, siteUrl: result.sites?.url || null });
});

router.delete("/articles/:id", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const params = DeleteArticleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db.delete(articlesTable).where(and(eq(articlesTable.id, params.data.id), eq(articlesTable.userId, user.id)));
  res.sendStatus(204);
});

router.post("/articles/:id/retry", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const params = RetryArticleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [article] = await db.select().from(articlesTable).where(
    and(eq(articlesTable.id, params.data.id), eq(articlesTable.userId, user.id))
  );
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  await db.update(articlesTable).set({
    status: "queued",
    errorMessage: null,
  }).where(eq(articlesTable.id, article.id));

  addToQueue(article.id);

  const [updated] = await db.select().from(articlesTable).where(eq(articlesTable.id, article.id));
  res.json({ ...updated, siteName: null, siteUrl: null });
});

export default router;
