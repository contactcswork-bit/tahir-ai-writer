import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();

interface WpPost {
  link: string;
  title: { rendered: string };
  date: string;
}

interface SiteResult {
  siteUrl: string;
  articles: { title: string; url: string; date: string }[];
  error?: string;
}

router.post("/fetch-links", async (req: Request, res: Response) => {
  const { sites } = req.body as { sites: string[] };

  if (!Array.isArray(sites) || sites.length === 0) {
    return res.status(400).json({ error: "Provide at least one site URL." });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const results: SiteResult[] = await Promise.all(
    sites.map(async (rawUrl): Promise<SiteResult> => {
      const siteUrl = rawUrl.replace(/\/+$/, "");
      try {
        const apiUrl =
          `${siteUrl}/wp-json/wp/v2/posts` +
          `?after=${encodeURIComponent(since)}` +
          `&per_page=100` +
          `&orderby=date` +
          `&status=publish` +
          `&_fields=link,title,date`;

        const res = await fetch(apiUrl, {
          signal: AbortSignal.timeout(12000),
          headers: { "User-Agent": "TahirAIWriter/1.0" },
        });

        if (!res.ok) {
          return { siteUrl, articles: [], error: `HTTP ${res.status}` };
        }

        const posts: WpPost[] = await res.json();
        const articles = posts.map((p) => ({
          title: p.title?.rendered?.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#8217;/g, "'").replace(/&#8216;/g, "'") || "(no title)",
          url: p.link,
          date: p.date,
        }));

        return { siteUrl, articles };
      } catch (err: any) {
        const msg = err?.name === "TimeoutError"
          ? "Request timed out (12s)"
          : err?.message || "Unknown error";
        return { siteUrl, articles: [], error: msg };
      }
    })
  );

  res.json(results);
});

export default router;
