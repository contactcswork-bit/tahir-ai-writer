import { Router, type IRouter } from "express";
import { db, articlesTable, sitesTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { GenerateArticlesBody } from "@workspace/api-zod";
import { addToQueue, getQueueStatus } from "../lib/generator";

const router: IRouter = Router();

router.post("/generate", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const parsed = GenerateArticlesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    keywords,
    siteIds,
    language = "english",
    wordCount = 800,
    model,
    imageSource = "pollinations",
    imageUrl,
    scheduledAt,
    publishNow = false,
  } = parsed.data;

  const jobIds: number[] = [];

  for (const keyword of keywords) {
    for (const siteId of siteIds) {
      const [article] = await db.insert(articlesTable).values({
        userId: user.id,
        siteId,
        keyword: keyword.trim(),
        language,
        wordCount,
        status: "queued",
        model: model || null,
        imageSource,
        featuredImageUrl: imageSource === "url" ? imageUrl : null,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        publishNow: publishNow ? 1 : 0,
      }).returning();

      jobIds.push(article.id);
      addToQueue(article.id);
    }
  }

  res.json({ queued: jobIds.length, jobIds });
});

router.get("/generate/status", requireAuth, async (_req, res): Promise<void> => {
  const status = getQueueStatus();
  res.json(status);
});

router.get("/generate/queue", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const articles = await db
    .select({
      id: articlesTable.id,
      keyword: articlesTable.keyword,
      status: articlesTable.status,
      siteId: articlesTable.siteId,
      siteName: sitesTable.name,
      createdAt: articlesTable.createdAt,
    })
    .from(articlesTable)
    .leftJoin(sitesTable, eq(articlesTable.siteId, sitesTable.id))
    .where(
      and(
        eq(articlesTable.userId, user.id),
        inArray(articlesTable.status, ["queued", "generating"])
      )
    )
    .orderBy(articlesTable.createdAt);
  res.json({ items: articles });
});

export default router;
