import { Router, type IRouter } from "express";
import { db, articlesTable, sitesTable, appSettingsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { GenerateArticlesBody } from "@workspace/api-zod";
import { addToQueue, getQueueStatus } from "../lib/generator";

const router: IRouter = Router();

router.post("/generate", requireAuth, async (req, res, next): Promise<void> => {
  try {
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
  } catch (err) { next(err); }
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

// Keyword suggestion using LongCat AI
router.post("/generate/suggest-keywords", requireAuth, async (req, res): Promise<void> => {
  const { niche } = req.body as { niche?: string };

  if (!niche || !niche.trim()) {
    res.status(400).json({ error: "Please provide a niche." });
    return;
  }

  try {
    const [appSettings] = await db.select().from(appSettingsTable).limit(1);
    const apiKey = appSettings?.longcatApiKey || "ak_23V6tb6f04Vq4m030D2SA74N0EW1a";
    const model = appSettings?.longcatModel || "LongCat-Flash-Thinking-2601";

    const prompt = `You are an SEO keyword research expert. Generate exactly 10 high-value, search-ready long-tail keywords for the niche: "${niche.trim()}".

Rules:
- Each keyword must be 3-7 words long
- Focus on buyer-intent and informational keywords that rank well
- Mix some "best X", "how to X", "X for beginners", "X tips" style keywords
- Make them specific and realistic search queries real people type
- No duplicate topics

Return ONLY a valid JSON array of exactly 10 strings. No explanation, no markdown, no extra text.
Example format: ["keyword one here", "another keyword phrase", ...]`;

    const response = await fetch("https://api.longcat.chat/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      res.status(502).json({ error: `AI error: ${response.status}` });
      return;
    }

    const data = await response.json() as any;
    let raw = (data.choices?.[0]?.message?.content || "").trim();

    // Strip markdown fences if present
    raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    // Extract JSON array
    const arrMatch = raw.match(/\[[\s\S]*\]/);
    if (!arrMatch) {
      res.status(502).json({ error: "AI returned unexpected format." });
      return;
    }

    const keywords: string[] = JSON.parse(arrMatch[0]);
    const cleaned = keywords
      .filter(k => typeof k === "string" && k.trim())
      .slice(0, 10)
      .map(k => k.trim());

    res.json({ keywords: cleaned });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to generate suggestions." });
  }
});

export default router;
