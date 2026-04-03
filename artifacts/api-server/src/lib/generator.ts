import { db, articlesTable, sitesTable, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const queue: number[] = [];
let processing = 0;
const MAX_CONCURRENT = 5;

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

async function uploadImageToWordPress(
  site: any,
  credentials: string,
  siteUrl: string,
  imageUrl: string,
  keyword: string
): Promise<number | null> {
  try {
    const imgResponse = await fetch(imageUrl, { redirect: "follow" });
    if (!imgResponse.ok) return null;

    const imageBuffer = await imgResponse.arrayBuffer();
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

  const prompt = `You are an expert SEO content writer. Write a comprehensive, high-quality blog article about "${keyword}" in ${language}.

Return your response as a single JSON object with EXACTLY these fields (no other text before or after):

{
  "title": "Compelling, click-worthy title (no year unless needed, no clickbait, max 65 chars)",
  "metaDescription": "SEO meta description, exactly under 155 characters, compelling and includes the keyword naturally",
  "category": "Single most relevant category name (e.g. Technology, Health, Finance, Travel, etc.)",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "content": "FULL HTML article here"
}

CONTENT REQUIREMENTS:
- Approximately ${wordCount} words (not counting HTML tags)
- Language: ${language}
- Current year context: 2026 (do NOT mention 2024 or 2025 as current)
- Start with <h2> sections directly (no <h1> in content - title is separate)
- 3-4 H2 sections, each with optional H3 subsections
- Short paragraphs: 2-3 sentences max. No walls of text.
- Include at least 2 bulleted/numbered lists: <ul><li>...</li></ul>
- Bold important terms: <strong>term</strong>
- Include 2 natural internal links: <a href="https://example.com/related-topic">anchor text</a>
- Include 1-2 external authority links (Wikipedia, well-known sources)
- Use "${keyword}" naturally in intro, at least one H2, and 3-5 times total
- End with a strong conclusion H2

TITLE REQUIREMENTS:
- Engaging, benefit-driven or curiosity-driven
- No "Ultimate Guide to..." or "Everything You Need to Know" clichés
- No years like 2024, 2025 in the title
- Max 65 characters

META DESCRIPTION:
- Must be under 155 characters
- Include the keyword naturally
- Make it compelling to click

TAGS (exactly 5):
- Mix of broad and specific
- Related to the keyword and content
- Single words or short phrases

CATEGORY:
- Single most fitting parent category
- Keep it broad (Technology, Health, Finance, Travel, Business, Lifestyle, etc.)

Return ONLY the JSON. No markdown fences. No explanation.`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 8000,
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
    meta: {
      yoast_wpseo_metadesc: aiResult.metaDescription,
      _yoast_wpseo_metadesc: aiResult.metaDescription,
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
  return post.link || `${siteUrl}/?p=${post.id}`;
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

    const aiResult = await callAI(article.keyword, language, wordCount, settings);

    const cleanContent = aiResult.content
      .replace(/^```html\n?/i, "")
      .replace(/```$/i, "")
      .trim();

    aiResult.content = cleanContent;

    const wordCountActual = cleanContent.replace(/<[^>]+>/g, "").split(/\s+/).filter(Boolean).length;
    const slug = slugify(article.keyword);

    let featuredImageUrl: string | null = null;
    if (article.imageSource === "pollinations" && settings?.pollinationsEnabled !== false) {
      featuredImageUrl = await getPollinationsImageUrl(article.keyword, settings);
    } else if (article.imageSource === "url" && article.featuredImageUrl) {
      featuredImageUrl = article.featuredImageUrl;
    }

    if (article.siteId) {
      const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, article.siteId));
      if (site) {
        const scheduledAt = article.scheduledAt;
        const now = new Date();

        if (scheduledAt && scheduledAt > now) {
          await db.update(articlesTable).set({
            status: "scheduled",
            title: aiResult.title,
            content: cleanContent,
            wordCount: wordCountActual,
            featuredImageUrl,
          }).where(eq(articlesTable.id, articleId));
          return;
        }

        const credentials = Buffer.from(`${site.username}:${site.applicationPassword}`).toString("base64");
        const siteUrl = site.url.replace(/\/$/, "");

        let featuredMediaId: number | null = null;
        if (featuredImageUrl) {
          featuredMediaId = await uploadImageToWordPress(site, credentials, siteUrl, featuredImageUrl, article.keyword);
        }

        const wpStatus = publishNow ? "publish" : "draft";
        const dbStatus = publishNow ? "published" : "draft";

        const publishedUrl = await publishToWordPress(site, aiResult, featuredMediaId, slug, wpStatus);

        await db.update(articlesTable).set({
          status: dbStatus,
          title: aiResult.title,
          content: cleanContent,
          wordCount: wordCountActual,
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
      title: aiResult.title,
      content: cleanContent,
      wordCount: wordCountActual,
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
