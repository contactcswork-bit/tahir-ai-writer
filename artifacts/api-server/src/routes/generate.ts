import { Router, type IRouter } from "express";
import { db, articlesTable, sitesTable, appSettingsTable } from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
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
  const { niche, language } = req.body as { niche?: string; language?: string };

  if (!niche || !niche.trim()) {
    res.status(400).json({ error: "Please provide a niche." });
    return;
  }

  const lang = language?.trim() || "English";

  try {
    const [appSettings] = await db.select().from(appSettingsTable).limit(1);
    const apiKey = appSettings?.longcatApiKey || "ak_23V6tb6f04Vq4m030D2SA74N0EW1a";
    const model = appSettings?.longcatModel || "LongCat-Flash-Thinking-2601";

    const prompt = `You are an SEO keyword research expert. Generate exactly 10 high-value, search-ready long-tail keywords for the niche: "${niche.trim()}".

Rules:
- Write ALL keywords in ${lang} language ONLY — every word must be in ${lang}
- Each keyword must be 3-7 words long
- Focus on buyer-intent and informational keywords that rank well
- Mix some "best X", "how to X", "X for beginners", "X tips" style keywords (translated to ${lang})
- Make them specific and realistic search queries real people type in ${lang}
- No duplicate topics

Return ONLY a valid JSON array of exactly 10 strings in ${lang}. No explanation, no markdown, no extra text.
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

// Full generation log — all statuses, last 50 articles
router.get("/generate/logs", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const articles = await db
    .select({
      id: articlesTable.id,
      keyword: articlesTable.keyword,
      status: articlesTable.status,
      siteId: articlesTable.siteId,
      siteName: sitesTable.name,
      publishedUrl: articlesTable.publishedUrl,
      errorMessage: articlesTable.errorMessage,
      createdAt: articlesTable.createdAt,
      publishedAt: articlesTable.publishedAt,
    })
    .from(articlesTable)
    .leftJoin(sitesTable, eq(articlesTable.siteId, sitesTable.id))
    .where(eq(articlesTable.userId, user.id))
    .orderBy(desc(articlesTable.createdAt))
    .limit(50);
  res.json({ items: articles });
});

// Retry a single failed article
router.post("/generate/retry/:id", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid article ID" }); return; }

  const [article] = await db
    .select()
    .from(articlesTable)
    .where(and(eq(articlesTable.id, id), eq(articlesTable.userId, user.id)));

  if (!article) { res.status(404).json({ error: "Article not found" }); return; }

  await db.update(articlesTable)
    .set({ status: "queued", errorMessage: null })
    .where(eq(articlesTable.id, id));

  addToQueue(id);
  res.json({ success: true, id });
});

// Retry ALL failed articles for the current user
router.post("/generate/retry-all-failed", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  const failed = await db
    .select({ id: articlesTable.id })
    .from(articlesTable)
    .where(and(eq(articlesTable.userId, user.id), eq(articlesTable.status, "failed")));

  for (const a of failed) {
    await db.update(articlesTable).set({ status: "queued", errorMessage: null }).where(eq(articlesTable.id, a.id));
    addToQueue(a.id);
  }

  res.json({ success: true, retried: failed.length });
});

// Smart keyword duplicate checker — scans WP sites for existing articles
router.post("/generate/check-keywords", requireAuth, async (req, res): Promise<void> => {
  const { keywords, siteIds } = req.body as { keywords?: string[]; siteIds?: number[] };

  if (!keywords?.length || !siteIds?.length) {
    res.status(400).json({ error: "keywords and siteIds are required." });
    return;
  }

  // Fetch site credentials
  const sites = await db.select().from(sitesTable).where(inArray(sitesTable.id, siteIds));

  const results = await Promise.all(
    sites.map(async (site) => {
      const siteUrl = site.url.replace(/\/$/, "");
      const credentials = Buffer.from(`${site.username}:${site.applicationPassword}`).toString("base64");

      // Check all keywords in parallel for this site
      const checks = await Promise.all(
        keywords.map(async (keyword) => {
          try {
            const searchRes = await fetch(
              `${siteUrl}/wp-json/wp/v2/posts?search=${encodeURIComponent(keyword)}&per_page=5&_fields=id,title,slug&status=any`,
              { headers: { Authorization: `Basic ${credentials}` }, signal: AbortSignal.timeout(8000) }
            );
            if (!searchRes.ok) return { keyword, exists: false };

            const posts: any[] = await searchRes.json();
            if (!Array.isArray(posts) || posts.length === 0) return { keyword, exists: false };

            const kwLower = keyword.toLowerCase();
            // Consider existing if any result title or slug contains the keyword
            const exists = posts.some((p: any) => {
              const title = (p?.title?.rendered || "").toLowerCase();
              const slug = (p?.slug || "").toLowerCase();
              return title.includes(kwLower) || slug.includes(kwLower.replace(/\s+/g, "-"));
            });

            return { keyword, exists };
          } catch {
            return { keyword, exists: false };
          }
        })
      );

      return {
        siteId: site.id,
        siteName: site.name,
        existing: checks.filter((c) => c.exists).map((c) => c.keyword),
        missing: checks.filter((c) => !c.exists).map((c) => c.keyword),
      };
    })
  );

  res.json({ results });
});

export default router;
