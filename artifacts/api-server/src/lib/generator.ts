import { db, articlesTable, sitesTable, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const queue: number[] = [];
let processing = 0;
const MAX_CONCURRENT = 5;

// Global semaphore: Pollinations free tier allows only 1 concurrent request per IP.
// This prevents multiple articles from hammering the endpoint at the same time.
let imageFetchBusy = false;
const imageFetchWaiters: Array<() => void> = [];

async function acquireImageSemaphore(): Promise<void> {
  if (!imageFetchBusy) {
    imageFetchBusy = true;
    return;
  }
  return new Promise<void>((resolve) => {
    imageFetchWaiters.push(() => {
      imageFetchBusy = true;
      resolve();
    });
  });
}

function releaseImageSemaphore(): void {
  const next = imageFetchWaiters.shift();
  if (next) {
    next();
  } else {
    imageFetchBusy = false;
  }
}

export function addToQueue(articleId: number): void {
  queue.push(articleId);
  processQueue();
}

async function processQueue(): Promise<void> {
  while (queue.length > 0 && processing < MAX_CONCURRENT) {
    const articleId = queue.shift()!;
    processing++;
    generateArticle(articleId)
      .catch((err) => logger.error({ err, articleId }, "Error generating article"))
      .finally(() => {
        processing--;
        processQueue();
      });
  }
}

export function getQueueStatus() {
  return {
    queueLength: queue.length,
    processing,
    completed: 0,
    failed: 0,
  };
}

async function getSettings() {
  const [settings] = await db.select().from(appSettingsTable).limit(1);
  return settings;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function getPollinationsImageUrl(keyword: string, settings: any): Promise<string | null> {
  try {
    const prompt = encodeURIComponent(
      `${keyword} professional blog featured image, high quality, photorealistic, editorial style`
    );
    const params = new URLSearchParams({
      width: "1200",
      height: "628",
      nologo: "true",
      enhance: "true",
      model: "flux",
    });
    const apiKey = settings?.pollinationsApiKey || "";
    if (apiKey) {
      params.set("token", apiKey);
      params.set("private", "true");
    }
    return `https://image.pollinations.ai/prompt/${prompt}?${params.toString()}`;
  } catch {
    return null;
  }
}

async function fetchImageWithRetry(imageUrl: string, maxRetries = 4): Promise<Response | null> {
  // Retry delays: first attempt immediately, then 20s, 35s, 50s between tries
  const retryDelays = [0, 20000, 35000, 50000];

  await acquireImageSemaphore();
  try {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, retryDelays[attempt] ?? 50000));
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);
      try {
        const res = await fetch(imageUrl, {
          redirect: "follow",
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
            "Accept": "image/*,*/*;q=0.8",
            "Referer": "https://pollinations.ai/",
          },
        });
        clearTimeout(timeout);
        if (res.status === 429) {
          logger.warn({ attempt, imageUrl }, `Pollinations rate limited (429), waiting before retry ${attempt + 1}/${maxRetries}`);
          continue;
        }
        if (res.status === 402 || res.status === 401) {
          logger.warn({ status: res.status }, "Pollinations auth/payment issue — skipping image");
          return null;
        }
        if (!res.ok) {
          logger.warn({ status: res.status, attempt }, "Image fetch non-ok response");
          return null;
        }
        return res;
      } catch (err) {
        clearTimeout(timeout);
        logger.warn({ err, attempt }, "Image fetch error, retrying...");
      }
    }
    logger.warn({ imageUrl }, "Image fetch failed after all retries");
    return null;
  } finally {
    releaseImageSemaphore();
  }
}

async function uploadImageToWordPress(
  site: any,
  credentials: string,
  siteUrl: string,
  imageUrl: string,
  keyword: string
): Promise<number | null> {
  try {
    const imgResponse = await fetchImageWithRetry(imageUrl);
    if (!imgResponse) return null;

    const imageBuffer = await imgResponse.arrayBuffer();
    if (!imageBuffer.byteLength) {
      logger.warn("Image buffer empty, skipping upload");
      return null;
    }
    const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";
    const filename = `${slugify(keyword)}-${Date.now()}.${ext}`;

    const uploadResponse = await fetch(`${siteUrl}/wp-json/wp/v2/media`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": contentType,
      },
      body: imageBuffer,
    });

    if (!uploadResponse.ok) {
      const err = await uploadResponse.text();
      logger.warn({ err }, "Image upload to WordPress failed");
      return null;
    }

    const media = await uploadResponse.json() as any;
    return media.id ?? null;
  } catch (err) {
    logger.warn({ err }, "uploadImageToWordPress exception");
    return null;
  }
}

async function getOrCreateTag(
  credentials: string,
  siteUrl: string,
  tagName: string
): Promise<number | null> {
  try {
    const searchRes = await fetch(
      `${siteUrl}/wp-json/wp/v2/tags?search=${encodeURIComponent(tagName)}&per_page=1`,
      { headers: { Authorization: `Basic ${credentials}` } }
    );
    if (searchRes.ok) {
      const existing = await searchRes.json() as any[];
      if (existing.length > 0 && existing[0].name.toLowerCase() === tagName.toLowerCase()) {
        return existing[0].id;
      }
    }

    const createRes = await fetch(`${siteUrl}/wp-json/wp/v2/tags`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: tagName }),
    });

    if (!createRes.ok) return null;
    const tag = await createRes.json() as any;
    return tag.id ?? null;
  } catch {
    return null;
  }
}

async function getOrCreateCategory(
  credentials: string,
  siteUrl: string,
  categoryName: string
): Promise<number | null> {
  try {
    const searchRes = await fetch(
      `${siteUrl}/wp-json/wp/v2/categories?search=${encodeURIComponent(categoryName)}&per_page=1`,
      { headers: { Authorization: `Basic ${credentials}` } }
    );
    if (searchRes.ok) {
      const existing = await searchRes.json() as any[];
      if (existing.length > 0 && existing[0].name.toLowerCase() === categoryName.toLowerCase()) {
        return existing[0].id;
      }
    }

    const createRes = await fetch(`${siteUrl}/wp-json/wp/v2/categories`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: categoryName }),
    });

    if (!createRes.ok) return null;
    const cat = await createRes.json() as any;
    return cat.id ?? null;
  } catch {
    return null;
  }
}

interface AIResult {
  title: string;
  metaDescription: string;
  category: string;
  tags: string[];
  content: string;
}

async function callAI(keyword: string, language: string, wordCount: number, settings: any): Promise<AIResult> {
  const apiKey = settings?.longcatApiKey || "ak_23V6tb6f04Vq4m030D2SA74N0EW1a";
  const model = settings?.longcatModel || "LongCat-Flash-Chat";
  const url = "https://api.longcat.chat/openai/v1/chat/completions";

  const langInstruction = language.toLowerCase() === "english"
    ? "Write entirely in English."
    : `Write ENTIRELY in ${language}. Every word — title, meta description, tags, category, and article body — must be in ${language}. Do not use English anywhere.`;

  const targetTokens = Math.min(Math.max(Math.round(wordCount * 2.2), 2000), 6000);

  const prompt = `You are an expert SEO content writer. Write a blog article about "${keyword}".
${langInstruction}

Respond with ONLY a JSON object — no text before or after, no markdown fences:

{"title":"...","metaDescription":"...","category":"...","tags":["...","...","...","...","..."],"content":"..."}

RULES:
- title: max 65 chars, engaging, no clichés, no years (2024/2025)
- metaDescription: under 155 chars, includes keyword, compelling
- category: single broad category (Technology/Health/Finance/Travel/Business/Lifestyle etc)
- tags: exactly 5, mix of broad and specific, short phrases
- content: ~${wordCount} words of HTML; start with <h2> (no <h1>); 3-4 H2 sections with optional H3s; short paragraphs (2-3 sentences); at least 2 lists <ul><li>; bold key terms <strong>; 1-2 external links to real authoritative sources (Wikipedia, official sites — NO example.com, NO placeholder URLs); use "${keyword}" naturally in intro, one H2, and 3-5 times total; end with conclusion H2
- current year is 2026
- NO placeholder links, NO example.com, NO fake URLs

Return ONLY the JSON.`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: targetTokens,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LongCat API error: ${response.status} - ${err}`);
  }

  const data = await response.json() as any;
  let raw = (data.choices?.[0]?.message?.content || "").trim();

  raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: AIResult;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI returned invalid JSON");
    parsed = JSON.parse(jsonMatch[0]);
  }

  if (!parsed.content) throw new Error("AI returned empty content");
  if (!parsed.metaDescription) parsed.metaDescription = `Learn everything about ${keyword} in this comprehensive guide.`;
  if (!parsed.title) parsed.title = keyword;
  if (!Array.isArray(parsed.tags)) parsed.tags = [keyword];
  if (!parsed.category) parsed.category = "General";

  if (parsed.metaDescription.length > 155) {
    parsed.metaDescription = parsed.metaDescription.substring(0, 152) + "...";
  }

  return parsed;
}

async function publishToWordPress(
  site: any,
  aiResult: AIResult,
  featuredMediaId: number | null,
  slug: string,
  wpStatus: "publish" | "draft"
): Promise<string> {
  const credentials = Buffer.from(`${site.username}:${site.applicationPassword}`).toString("base64");
  const siteUrl = site.url.replace(/\/$/, "");

  const tagIds: number[] = [];
  for (const tag of (aiResult.tags || []).slice(0, 5)) {
    const id = await getOrCreateTag(credentials, siteUrl, tag);
    if (id) tagIds.push(id);
  }

  const categoryId = await getOrCreateCategory(credentials, siteUrl, aiResult.category);

  const payload: any = {
    title: aiResult.title,
    content: aiResult.content,
    excerpt: aiResult.metaDescription,
    slug,
    status: wpStatus,
    // Yoast SEO and Rank Math meta included in initial POST
    meta: {
      yoast_wpseo_metadesc: aiResult.metaDescription,
      rank_math_description: aiResult.metaDescription,
    },
  };

  if (tagIds.length > 0) payload.tags = tagIds;
  if (categoryId) payload.categories = [categoryId];
  if (featuredMediaId) payload.featured_media = featuredMediaId;

  const response = await fetch(`${siteUrl}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`WordPress publish error: ${response.status} - ${err}`);
  }

  const post = await response.json() as any;
  const postId: number = post.id;
  const postLink: string = post.link || `${siteUrl}/?p=${postId}`;

  // Secondary update: PUT with Yoast meta to ensure it's picked up by Yoast SEO
  try {
    const patchPayload: any = {
      meta: {
        yoast_wpseo_metadesc: aiResult.metaDescription,
        rank_math_description: aiResult.metaDescription,
      },
    };
    // Re-affirm featured_media in the update (some WP setups need it set twice)
    if (featuredMediaId) patchPayload.featured_media = featuredMediaId;

    const patchRes = await fetch(`${siteUrl}/wp-json/wp/v2/posts/${postId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify(patchPayload),
    });
    if (!patchRes.ok) {
      const patchErr = await patchRes.text();
      logger.warn({ patchErr, postId }, "Yoast meta PUT failed (non-fatal)");
    } else {
      logger.info({ postId }, "Yoast meta PUT succeeded");
    }
  } catch (err) {
    logger.warn({ err }, "Yoast meta PUT exception (non-fatal)");
  }

  return postLink;
}

async function generateArticle(articleId: number): Promise<void> {
  await db.update(articlesTable).set({ status: "generating" }).where(eq(articlesTable.id, articleId));

  const [article] = await db.select().from(articlesTable).where(eq(articlesTable.id, articleId));
  if (!article) return;

  const settings = await getSettings();

  try {
    const language = article.language || "english";
    const wordCount = article.wordCount || 800;
    const publishNow = article.publishNow === 1;

    let imageUrlPromise: Promise<string | null> = Promise.resolve(null);
    if (article.imageSource === "pollinations" && settings?.pollinationsEnabled !== false) {
      imageUrlPromise = getPollinationsImageUrl(article.keyword, settings);
    } else if (article.imageSource === "url" && article.featuredImageUrl) {
      imageUrlPromise = Promise.resolve(article.featuredImageUrl);
    }

    const aiResult = await callAI(article.keyword, language, wordCount, settings);

    const cleanContent = aiResult.content
      .replace(/^```html\n?/i, "")
      .replace(/```$/i, "")
      .trim();

    aiResult.content = cleanContent;

    const wordCountActual = cleanContent.replace(/<[^>]+>/g, "").split(/\s+/).filter(Boolean).length;
    const slug = slugify(article.keyword);

    // Step 1: Save generated content immediately (content is ready, image pending)
    await db.update(articlesTable).set({
      status: "generating",
      title: aiResult.title,
      content: cleanContent,
      wordCount: wordCountActual,
    }).where(eq(articlesTable.id, articleId));

    // Step 2: Fetch image URL (may be a Pollinations URL or direct URL)
    const featuredImageUrl = await imageUrlPromise;

    if (article.siteId) {
      const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, article.siteId));
      if (site) {
        const scheduledAt = article.scheduledAt;
        const now = new Date();

        if (scheduledAt && scheduledAt > now) {
          await db.update(articlesTable).set({
            status: "scheduled",
            featuredImageUrl,
          }).where(eq(articlesTable.id, articleId));
          return;
        }

        const credentials = Buffer.from(`${site.username}:${site.applicationPassword}`).toString("base64");
        const siteUrl = site.url.replace(/\/$/, "");

        // Step 3: Download image and upload to WordPress media library
        let featuredMediaId: number | null = null;
        if (featuredImageUrl) {
          featuredMediaId = await uploadImageToWordPress(site, credentials, siteUrl, featuredImageUrl, article.keyword);
        }

        const wpStatus = publishNow ? "publish" : "draft";
        const dbStatus = publishNow ? "published" : "draft";

        // Step 4: Publish to WordPress (with Yoast meta PATCH)
        const publishedUrl = await publishToWordPress(site, aiResult, featuredMediaId, slug, wpStatus);

        // Step 5: Mark complete
        await db.update(articlesTable).set({
          status: dbStatus,
          featuredImageUrl,
          publishedUrl,
          publishedAt: publishNow ? new Date() : null,
        }).where(eq(articlesTable.id, articleId));

        await db.update(sitesTable).set({ status: "connected" }).where(eq(sitesTable.id, site.id));
        return;
      }
    }

    await db.update(articlesTable).set({
      status: "draft",
      featuredImageUrl,
    }).where(eq(articlesTable.id, articleId));

  } catch (err: any) {
    logger.error({ err, articleId }, "Article generation failed");
    await db.update(articlesTable).set({
      status: "failed",
      errorMessage: err?.message || "Unknown error",
    }).where(eq(articlesTable.id, articleId));
  }
}
