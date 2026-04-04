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

  const isEnglish = language.toLowerCase() === "english";
  const langInstruction = isEnglish
    ? "Write entirely in English."
    : `Write ENTIRELY in ${language}. Every word — title, meta description, tags, category, and article body — must be in ${language}. The focus keyword "${keyword}" may appear in its original form since it is the SEO target term, but all surrounding words, sentences, and headings must be in ${language}. Do not mix in random English words outside of the keyword itself.`;

  // Use generous tokens — no credit limits, prioritize quality
  const targetTokens = Math.max(Math.round(wordCount * 3.5), 8000);

  // Each title style is a concrete FORMAT STRING — not a vague description
  // The format must be diverse so batches of articles look nothing alike
  const titleStylePool = [
    // Curiosity gap
    `Write a curiosity-gap title. Format: "The [keyword] Secret Most [type of person] Never Learn" or "What Nobody Tells You About [keyword]" — keep it under 70 chars, include "${keyword}" naturally.`,
    // Mistake/warning angle
    `Write a mistake-warning title. Format: "The [keyword] Mistake That Costs [people/businesses] [consequence]" or "Stop Making This [keyword] Mistake" — under 70 chars, include "${keyword}".`,
    // Direct contrarian
    `Write a contrarian title that challenges the mainstream view. Format: "Why [common belief about keyword] Is Wrong" or "The Case Against [popular keyword approach]" — under 70 chars, include "${keyword}".`,
    // Specific how-to with outcome
    `Write a specific how-to title with a clear outcome. Format: "How to [achieve specific result] With [keyword]" or "How to [keyword] Without [common pain point]" — under 70 chars, include "${keyword}".`,
    // Honest/real-talk
    `Write an honest, no-hype title. Format: "[keyword]: What Actually Works (And What Doesn't)" or "An Honest Look at [keyword]" or "The Truth About [keyword]" — under 70 chars, include "${keyword}".`,
    // Question (real search intent)
    `Write a title as a genuine search question someone would type. Format: "Does [keyword] Really Work?" or "Is [keyword] Worth It?" or "Can [keyword] Actually [achieve result]?" — under 70 chars, include "${keyword}".`,
    // Specific numbered list (not generic)
    `Write a numbered list title. Format: "[N] [keyword] Mistakes That Are Holding You Back" or "[N] Things Experts Know About [keyword] That Beginners Don't" — pick a specific number 5–12, under 70 chars, include "${keyword}".`,
    // Time/effort promise
    `Write a result-promise title. Format: "How to [keyword] in [short timeframe]" or "Get Better at [keyword] Starting Today" or "[keyword]: Results You Can See Quickly" — under 70 chars, include "${keyword}".`,
  ];
  const titleStyle = titleStylePool[Math.floor(Math.random() * titleStylePool.length)];

  // Pick a random content angle so articles don't share the same opening style
  const contentAngles = [
    "Start with a surprising statistic or counterintuitive fact that reframes the topic.",
    "Start with a short, vivid real-world scenario or anecdote that puts the reader in a situation.",
    "Start with a direct, bold claim that challenges what most people think about this topic.",
    "Start with an honest admission of what most guides get wrong about this topic.",
    "Start with a practical question the reader is likely already asking themselves.",
  ];
  const contentAngle = contentAngles[Math.floor(Math.random() * contentAngles.length)];

  const prompt = `You are an experienced journalist and SEO expert. Write a high-quality, reader-first blog article about "${keyword}".
${langInstruction}

Respond with ONLY a valid JSON object — no text before or after, no markdown fences:
{"title":"...","metaDescription":"...","category":"...","tags":["...","...","..."],"content":"..."}

=== TITLE ===
${titleStyle}

TITLE RULES:
- Must include the exact phrase "${keyword}" somewhere natural in the title (it may appear in its original form)
- Under 70 characters
- ${isEnglish ? "" : `CRITICAL: Write the title in ${language} — the format patterns above are English examples showing structure only; translate the surrounding words into ${language}. Only "${keyword}" itself may stay in its original form.`}
- BANNED words/phrases — never use these: "Ultimate Guide", "Complete Guide", "Everything You Need", "Best Practices", "Proven Strategies", "Expert Tips", "In Today's World", "Unleash", "Dive Into", "Game-Changer", "Comprehensive", "In-Depth"
- Do NOT start with "Best [keyword]..." — that pattern is overused and generic
- Do NOT write "[Keyword]: [Generic Suffix]" colon-separator format unless it's genuinely interesting
- The title should feel like it was written by a real blogger, not an SEO tool

=== META DESCRIPTION ===
Under 155 characters. Include "${keyword}" naturally. Compelling, specific, tells the reader exactly what they'll get.

=== CATEGORY ===
A specific, niche-relevant category name based on the keyword topic (e.g., "Fitness Nutrition", "Personal Finance", "Web Development"). Never: Blog, General, Uncategorized, News, Posts.

=== TAGS ===
3 to 5 tags that are semantically relevant to the keyword — mix of broad and specific.

=== CONTENT ===
Write approximately ${wordCount} words of clean HTML. IMPORTANT: Do NOT follow a generic template. 

First, decide what kind of article best serves someone searching "${keyword}":
- Is it a how-to guide? Then use step-by-step structure with <ol>.
- Is it a comparison or review? Use pros/cons, comparison tables naturally.
- Is it an informational explainer? Use logical sections that flow from basics to advanced.
- Is it a listicle? Organize around numbered or categorized items.
- Is it a problem/solution article? Lead with the pain point, then solutions.

Choose the structure that FITS THE TOPIC, not a standard template.

OPENING (no heading before first paragraph):
${contentAngle} Naturally weave in "${keyword}" within the first 2–3 sentences. 3–5 sentences total.

BODY STRUCTURE (choose what fits the topic):
- Use <h2> for major sections and <h3> for sub-points where they add clarity — not by default
- Number of sections should be determined by the content, not a fixed count
- Use <ul> or <ol> where listing genuinely helps the reader — don't force them
- Use a <table> only if comparing options, showing stats, or organizing structured data naturally
- Use <blockquote> for a genuinely insightful quote, expert opinion, or important callout — 0 or 1 max
- Include 1–2 external links to real, authoritative sources (Wikipedia, gov sites, major journals) with descriptive anchor text — never example.com or fake URLs
- Use <strong> for terms the reader genuinely needs to notice

CLOSING:
End the article naturally — a summary, a call to action, or a forward-looking thought. The heading should fit the article's tone (don't force "Final Thoughts" if something else works better).

WRITING RULES:
- Write like a real person who knows this topic deeply, not an AI filling a template
- Vary sentence rhythm — some short and punchy, some detailed and explanatory
- Each section must add new value — no padding, no restating the same point differently
- Use specific examples, real scenarios, and concrete details — not vague generalities
- Use "${keyword}" naturally, maximum 5–6 times total — rely on semantic variations
- Avoid all filler: "In today's world", "It is worth noting", "As we all know", "In conclusion"
- No H1 tags — WordPress adds the title automatically

Return ONLY the JSON object, nothing else.`;

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
      temperature: 0.82,
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

  // Safety net: guarantee the EXACT keyword appears somewhere in the title
  const originalTitle = parsed.title;
  const titleHasKeyword = parsed.title.toLowerCase().includes(keyword.toLowerCase());
  if (!titleHasKeyword) {
    if (isEnglish) {
      // English: apply natural varied fallback patterns
      const kw = keyword.charAt(0).toUpperCase() + keyword.slice(1);
      const naturalFallbacks = [
        `What Nobody Tells You About ${kw}`,
        `The Truth About ${kw} (Without the Hype)`,
        `Is ${kw} Actually Worth It? An Honest Look`,
        `Why Most People Get ${kw} Wrong`,
        `${kw}: What Actually Works and What Doesn't`,
        `Stop Overthinking ${kw} — Here's What Matters`,
        `How to Get the Most From ${kw}`,
        `The ${kw} Mistakes You Don't Know You're Making`,
        `${kw} Explained: No Fluff, Just What Works`,
      ];
      parsed.title = naturalFallbacks[Math.floor(Math.random() * naturalFallbacks.length)];
    } else {
      // Non-English: the AI correctly wrote the title in the target language and likely
      // translated the keyword — only override if the title is empty or suspiciously short
      if (!parsed.title || parsed.title.trim().length < 5) {
        parsed.title = keyword; // Last resort: just use the keyword itself
      }
      // Otherwise keep the AI's foreign-language title as-is
    }
    logger.info({ original: originalTitle, final: parsed.title, keyword, language }, "Title keyword check — applied safety logic");
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
  wpStatus: "publish" | "draft",
  keyword: string
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
      _yoast_wpseo_focuskw: keyword,
      rank_math_focus_keyword: keyword,
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
    keyword
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
        const publishedUrl = await publishToWordPress(site, aiResult, featuredMediaId, slug, wpStatus, article.keyword);

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
