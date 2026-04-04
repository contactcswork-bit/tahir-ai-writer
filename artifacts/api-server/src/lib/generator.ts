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

const DEFAULT_POLLINATIONS_KEY = "sk_31GUBfVAdRunoZ0Gc2W3NmaCwMYikNb2";

function buildPollinationsUrl(keyword: string, apiKey: string): string {
  const prompt = encodeURIComponent(
    `${keyword} professional blog featured image, high quality, photorealistic, editorial style`
  );
  const params = new URLSearchParams({
    model: "flux",
    width: "1200",
    height: "628",
  });
  // gen.pollinations.ai uses ?key= query param for auth
  if (apiKey) params.set("key", apiKey);
  return `https://gen.pollinations.ai/image/${prompt}?${params.toString()}`;
}

async function getPollinationsImageUrl(keyword: string, settings: any): Promise<string | null> {
  try {
    const apiKey = settings?.pollinationsApiKey || DEFAULT_POLLINATIONS_KEY;
    return buildPollinationsUrl(keyword, apiKey);
  } catch {
    return null;
  }
}

async function fetchImageWithRetry(
  imageUrl: string,
  apiKey: string = DEFAULT_POLLINATIONS_KEY,
  maxRetries = 3
): Promise<Response | null> {
  // Use semaphore even for authenticated endpoint to be safe
  await acquireImageSemaphore();
  try {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        // Short delays for authenticated endpoint (much less rate limiting)
        await new Promise((r) => setTimeout(r, attempt * 5000));
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);
      try {
        const headers: Record<string, string> = {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "image/*,*/*;q=0.8",
        };
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

        const res = await fetch(imageUrl, {
          redirect: "follow",
          signal: controller.signal,
          headers,
        });
        clearTimeout(timeout);

        if (res.status === 429) {
          logger.warn({ attempt }, "Pollinations rate limited (429), retrying...");
          continue;
        }
        if (res.status === 402 || res.status === 401) {
          logger.warn({ status: res.status }, "Pollinations auth/payment issue — skipping image");
          return null;
        }
        if (!res.ok) {
          logger.warn({ status: res.status, attempt }, "Image fetch failed");
          return null;
        }
        logger.info({ attempt, size: res.headers.get("content-length") }, "Pollinations image fetched successfully");
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

// ── Yoast / RankMath meta update helpers ─────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function updateMetaViaXmlRpc(
  siteUrl: string,
  username: string,
  password: string,
  postId: number,
  metaDescription?: string,
  keyword?: string
): Promise<{ success: boolean; reason?: string }> {
  const xmlRpcUrl = `${siteUrl}/xmlrpc.php`;
  const customFields: Array<{ key: string; value: string }> = [];

  if (metaDescription) {
    customFields.push({ key: "_yoast_wpseo_metadesc", value: metaDescription });
    customFields.push({ key: "rank_math_description", value: metaDescription });
  }
  if (keyword) {
    customFields.push({ key: "_yoast_wpseo_focuskw", value: keyword });
    customFields.push({ key: "rank_math_focus_keyword", value: keyword });
  }
  if (customFields.length === 0) return { success: true, reason: "No meta to update" };

  const customFieldsXml = customFields
    .map(
      (cf) => `<struct>
        <member><name>key</name><value><string>${escapeXml(cf.key)}</string></value></member>
        <member><name>value</name><value><string>${escapeXml(cf.value)}</string></value></member>
      </struct>`
    )
    .join("");

  const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<methodCall>
  <methodName>wp.editPost</methodName>
  <params>
    <param><value><int>1</int></value></param>
    <param><value><string>${escapeXml(username)}</string></value></param>
    <param><value><string>${escapeXml(password)}</string></value></param>
    <param><value><int>${postId}</int></value></param>
    <param><value><struct>
      <member>
        <name>custom_fields</name>
        <value><array><data>${customFieldsXml}</data></array></value>
      </member>
    </struct></value></param>
  </params>
</methodCall>`;

  try {
    const response = await fetch(xmlRpcUrl, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      body: xmlPayload,
    });
    const responseText = await response.text();
    if (!response.ok) return { success: false, reason: `HTTP ${response.status}` };
    if (responseText.includes("<fault>")) return { success: false, reason: "XML-RPC fault" };
    return { success: true };
  } catch (e) {
    return { success: false, reason: String(e) };
  }
}

async function updateYoastMeta(
  siteUrl: string,
  credentials: string,
  username: string,
  password: string,
  postId: number,
  metaDescription?: string,
  keyword?: string
): Promise<void> {
  // Method 1: XML-RPC (most reliable for private meta keys)
  const xmlRpcResult = await updateMetaViaXmlRpc(siteUrl, username, password, postId, metaDescription, keyword);
  if (xmlRpcResult.success) {
    logger.info({ postId, method: "XML-RPC" }, "Yoast meta updated via XML-RPC");
  } else {
    logger.warn({ postId, reason: xmlRpcResult.reason }, "XML-RPC meta update failed, trying REST");
  }

  // Method 2: REST API meta fields
  try {
    await fetch(`${siteUrl}/wp-json/wp/v2/posts/${postId}`, {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        meta: {
          _yoast_wpseo_metadesc: metaDescription || "",
          _yoast_wpseo_focuskw: keyword || "",
          yoast_wpseo_metadesc: metaDescription || "",
          rank_math_description: metaDescription || "",
          rank_math_focus_keyword: keyword || "",
        },
      }),
    });
  } catch (e) {
    logger.warn({ e, postId }, "REST meta update failed (non-fatal)");
  }

  // Method 3: Yoast dedicated REST endpoint
  try {
    await fetch(`${siteUrl}/wp-json/yoast/v1/meta/posts/${postId}`, {
      method: "PUT",
      headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        wpseo_metadesc: metaDescription || "",
        wpseo_focuskw: keyword || "",
      }),
    });
  } catch (e) {
    logger.warn({ e, postId }, "Yoast REST endpoint failed (non-fatal)");
  }
}

// ── WordPress image upload ────────────────────────────────────────────────────

async function uploadImageToWordPress(
  site: any,
  credentials: string,
  siteUrl: string,
  imageUrl: string,
  keyword: string,
  apiKey: string = DEFAULT_POLLINATIONS_KEY
): Promise<number | null> {
  try {
    const imgResponse = await fetchImageWithRetry(imageUrl, apiKey);
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

// Generic WordPress default category names — skip these and create a specific one instead
const GENERIC_CATEGORY_NAMES = new Set(["blog", "uncategorized", "general", "news", "articles", "posts"]);

async function getOrCreateCategory(
  credentials: string,
  siteUrl: string,
  categoryName: string
): Promise<number | null> {
  try {
    const cleanName = categoryName.trim();
    if (!cleanName) return null;

    // Don't look up or return generic/default categories — create a specific one
    const isGeneric = GENERIC_CATEGORY_NAMES.has(cleanName.toLowerCase());

    if (!isGeneric) {
      // Search for an existing category with this exact name
      const searchRes = await fetch(
        `${siteUrl}/wp-json/wp/v2/categories?search=${encodeURIComponent(cleanName)}&per_page=10`,
        { headers: { Authorization: `Basic ${credentials}` } }
      );
      if (searchRes.ok) {
        const existing = await searchRes.json() as any[];
        const match = existing.find(
          (c: any) => c.name.toLowerCase() === cleanName.toLowerCase()
        );
        if (match) {
          logger.info({ categoryId: match.id, categoryName: match.name }, "Reusing existing WP category");
          return match.id;
        }
      }
    }

    // Create the category
    const createRes = await fetch(`${siteUrl}/wp-json/wp/v2/categories`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: cleanName }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      logger.warn({ status: createRes.status, errText, categoryName: cleanName }, "Failed to create WP category");
      return null;
    }

    const cat = await createRes.json() as any;
    logger.info({ categoryId: cat.id, categoryName: cat.name }, "Created new WP category");
    return cat.id ?? null;
  } catch (err) {
    logger.warn({ err, categoryName }, "getOrCreateCategory exception");
    return null;
  }
}

interface AIResult {
  title: string;
  metaDescription: string;
  category: string;
  tags: string[];
  content: string;
  tokensPrompt: number;
  tokensCompletion: number;
  tokensTotal: number;
}

async function callAI(keyword: string, language: string, wordCount: number, settings: any): Promise<AIResult> {
  const apiKey = settings?.longcatApiKey || "ak_23V6tb6f04Vq4m030D2SA74N0EW1a";
  const model = settings?.longcatModel || "LongCat-Flash-Thinking-2601";
  const url = "https://api.longcat.chat/openai/v1/chat/completions";

  const langInstruction = language.toLowerCase() === "english"
    ? "Write entirely in English."
    : `Write ENTIRELY in ${language}. Every word — title, meta description, tags, category, and article body — must be in ${language}. Do not use English anywhere.`;

  // Use generous tokens — no credit limits, prioritize quality
  const targetTokens = Math.max(Math.round(wordCount * 3.5), 8000);

  const prompt = `You are a senior SEO content strategist and expert writer with 15 years of experience ranking articles on Google. Write a comprehensive, authoritative blog article about "${keyword}".
${langInstruction}

Respond with ONLY a valid JSON object — no text before or after, no markdown fences:

{"title":"...","metaDescription":"...","category":"...","tags":["...","...","...","...","..."],"content":"..."}

=== TITLE RULES (CRITICAL) ===
The title MUST contain the EXACT keyword phrase "${keyword}" verbatim, word-for-word, without shortening, paraphrasing, or reordering any words. Add 2-5 powerful SEO words (e.g., "Best", "Proven", "Ultimate", "Complete", "Expert", "Top", "Effective", "Essential") before or after to make the full title 10-15 words. No years. No clichés like "dive into" or "unleash".
Example: keyword "blue running shoes for men" → title "Best Blue Running Shoes for Men That Deliver Proven Performance"

=== META DESCRIPTION ===
Under 155 characters. Include "${keyword}" naturally. Make it compelling and action-driven to improve click-through rate.

=== CATEGORY ===
A SPECIFIC, topic-based category derived directly from the keyword (e.g., "Kitchen Appliances", "Digital Marketing", "Weight Loss"). NEVER use: Blog, General, Uncategorized, News, Articles, Posts.

=== TAGS ===
Exactly 5 tags — mix of broad topic, specific niche, and long-tail variations of the keyword.

=== CONTENT (HIGH QUALITY REQUIREMENTS) ===
Write ~${wordCount} words of clean, semantic HTML. This must read like an expert-authored article, NOT generic AI content.

STRUCTURE:
1. Opening paragraph (NO heading) — hook the reader with a bold statement, surprising stat, or relatable problem. Naturally include "${keyword}" in the first 2 sentences. Promise what the reader will learn. 3-4 sentences.
2. 5-7 <h2> sections covering the topic thoroughly — each with 3-4 meaty paragraphs (4-6 sentences each). Go deep, not shallow.
3. At least one <h2> heading must naturally contain "${keyword}" verbatim.
4. Under at least 2 <h2>s, add 2-3 <h3> sub-sections for depth.
5. Include at least ONE HTML table (<table><thead><tr><th>…</th></tr></thead><tbody>…</tbody></table>) — for comparison, pros/cons, quick reference, or key stats.
6. Include a dedicated <h2>Frequently Asked Questions</h2> section with 4-5 Q&A pairs using <h3> for each question and <p> for the answer.
7. At least 2 <ul> bullet lists AND at least 1 <ol> numbered list.
8. Use <blockquote> for 1-2 key expert tips or important callouts.
9. Bold important terms and phrases with <strong>.
10. 1-2 external links to genuinely real, authoritative sources (Wikipedia, government sites, major publications — NEVER example.com or fake URLs). Use descriptive anchor text.
11. End with a <h2>Final Thoughts</h2> (or equivalent) section summarizing key takeaways and a clear call-to-action for the reader.

WRITING QUALITY:
- Write like a real expert who deeply understands this topic — add specific details, nuance, and insights
- Vary sentence length and structure — mix short punchy sentences with longer explanatory ones
- Use transition phrases between paragraphs for smooth flow
- Include specific examples, scenarios, or use cases to illustrate points
- Avoid filler phrases: "In today's world", "In conclusion", "It is worth noting", "It goes without saying"
- NEVER use: "${keyword}" more than 6 times total (avoid keyword stuffing)
- Use LSI keywords and natural semantic variations of the topic
- Current year is 2026

FORBIDDEN:
- No placeholder links, no example.com, no fake URLs
- No H1 tags (WordPress adds the title as H1)
- No keyword stuffing
- No thin, vague, or generic paragraphs

Return ONLY the JSON object.`;

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
      temperature: 0.65,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LongCat API error: ${response.status} - ${err}`);
  }

  const data = await response.json() as any;

  const tokensPrompt = Number(data.usage?.prompt_tokens || 0);
  const tokensCompletion = Number(data.usage?.completion_tokens || 0);
  const tokensTotal = Number(data.usage?.total_tokens || 0);

  let raw = (data.choices?.[0]?.message?.content || "").trim();

  raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: Omit<AIResult, "tokensPrompt" | "tokensCompletion" | "tokensTotal">;
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

  // Safety net: guarantee the EXACT keyword appears verbatim in the title
  const originalTitle = parsed.title;
  if (!parsed.title.toLowerCase().includes(keyword.toLowerCase())) {
    const powerSuffixes = [
      "Complete Guide to Know",
      "Expert Tips and Proven Strategies",
      "Best Practices and Essential Tips",
      "Ultimate Guide for Best Results",
      "Top Strategies That Actually Work",
    ];
    const suffix = powerSuffixes[Math.floor(Math.random() * powerSuffixes.length)];
    const keywordTitleCase = keyword.charAt(0).toUpperCase() + keyword.slice(1);
    parsed.title = `${keywordTitleCase}: ${suffix}`;
    logger.info({ original: originalTitle, forced: parsed.title, keyword }, "AI omitted exact keyword from title — forced keyword into title");
  }

  if (parsed.metaDescription.length > 155) {
    parsed.metaDescription = parsed.metaDescription.substring(0, 152) + "...";
  }

  return { ...parsed, tokensPrompt, tokensCompletion, tokensTotal };
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

  // Safety net: if AI returns a generic category name, derive one from the keyword
  let resolvedCategory = aiResult.category?.trim() || "";
  if (!resolvedCategory || GENERIC_CATEGORY_NAMES.has(resolvedCategory.toLowerCase())) {
    // Derive a specific category from the keyword (Title Case, max 3 words)
    const keywordWords = article.keyword.split(/\s+/).slice(0, 3);
    resolvedCategory = keywordWords
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
    logger.info({ original: aiResult.category, derived: resolvedCategory }, "AI returned generic category — using keyword-derived category");
  }

  const categoryId = await getOrCreateCategory(credentials, siteUrl, resolvedCategory);

  const payload: any = {
    title: aiResult.title,
    content: aiResult.content,
    excerpt: aiResult.metaDescription,
    slug,
    status: wpStatus,
    // Yoast SEO: internal storage key is _yoast_wpseo_metadesc (private, with underscore).
    // WordPress REST API allows setting private meta IF Yoast registers it with show_in_rest:true.
    // We include both key variants to cover all Yoast versions.
    meta: {
      _yoast_wpseo_metadesc: aiResult.metaDescription,
      yoast_wpseo_metadesc: aiResult.metaDescription,
      rank_math_description: aiResult.metaDescription,
      _yoast_wpseo_focuskw: article.keyword,
      rank_math_focus_keyword: article.keyword,
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

  // After post is created, update Yoast/RankMath meta via XML-RPC + REST fallbacks
  await updateYoastMeta(
    siteUrl,
    credentials,
    site.username,
    site.applicationPassword,
    postId,
    aiResult.metaDescription,
    article.keyword
  );

  return postLink;
}

async function generateArticle(articleId: number): Promise<void> {
  await db.update(articlesTable).set({ status: "generating" }).where(eq(articlesTable.id, articleId));

  const [article] = await db.select().from(articlesTable).where(eq(articlesTable.id, articleId));
  if (!article) return;

  const settings = await getSettings();

  try {
    const language = article.language || "english";
    const wordCount = article.wordCount || 1500;
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
        const pollinationsKey = settings?.pollinationsApiKey || DEFAULT_POLLINATIONS_KEY;
        let featuredMediaId: number | null = null;
        if (featuredImageUrl) {
          featuredMediaId = await uploadImageToWordPress(site, credentials, siteUrl, featuredImageUrl, article.keyword, pollinationsKey);
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
          tokensPrompt: aiResult.tokensPrompt || null,
          tokensCompletion: aiResult.tokensCompletion || null,
          tokensTotal: aiResult.tokensTotal || null,
        }).where(eq(articlesTable.id, articleId));

        await db.update(sitesTable).set({ status: "connected" }).where(eq(sitesTable.id, site.id));
        return;
      }
    }

    await db.update(articlesTable).set({
      status: "draft",
      featuredImageUrl,
      tokensPrompt: aiResult.tokensPrompt || null,
      tokensCompletion: aiResult.tokensCompletion || null,
      tokensTotal: aiResult.tokensTotal || null,
    }).where(eq(articlesTable.id, articleId));

  } catch (err: any) {
    logger.error({ err, articleId }, "Article generation failed");
    await db.update(articlesTable).set({
      status: "failed",
      errorMessage: err?.message || "Unknown error",
    }).where(eq(articlesTable.id, articleId));
  }
}
