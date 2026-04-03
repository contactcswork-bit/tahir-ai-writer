import { useState, useRef } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/errors";
import { Copy, Download, Globe, Loader2, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface Article {
  title: string;
  url: string;
  date: string;
}

interface SiteResult {
  siteUrl: string;
  articles: Article[];
  error?: string;
}

const STORAGE_KEY = "fetch-links-sites";

export default function FetchLinks() {
  const [siteInput, setSiteInput] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEY) || ""; } catch { return ""; }
  });
  const [results, setResults] = useState<SiteResult[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);

  const parseSites = (raw: string): string[] =>
    raw
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.startsWith("http") ? s : `https://${s}`));

  const handleFetch = async () => {
    const sites = parseSites(siteInput);
    if (sites.length === 0) {
      toast({ title: "Enter at least one WordPress URL", variant: "destructive" });
      return;
    }

    try { localStorage.setItem(STORAGE_KEY, siteInput); } catch {}

    abortRef.current = new AbortController();
    setLoading(true);
    setResults([]);

    try {
      const res = await apiFetch("/fetch-links", {
        method: "POST",
        body: JSON.stringify({ sites }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Server error ${res.status}`);
      }
      const data: SiteResult[] = await res.json();
      setResults(data);

      const total = data.reduce((n, s) => n + s.articles.length, 0);
      const failed = data.filter((s) => !!s.error).length;
      toast({
        title: `Fetched ${total} article${total !== 1 ? "s" : ""}`,
        description: failed > 0 ? `${failed} site(s) had errors` : `from ${data.length} site(s)`,
      });
    } catch (err) {
      toastError(err, toast, "Fetch failed");
    } finally {
      setLoading(false);
    }
  };

  const copyAllUrls = () => {
    const lines: string[] = [];
    results.forEach((site) => {
      if (site.articles.length === 0) return;
      lines.push(`=== ${site.siteUrl} (${site.articles.length}) ===`);
      site.articles.forEach((a) => lines.push(a.url));
      lines.push("");
    });
    navigator.clipboard.writeText(lines.join("\n").trim());
    toast({ title: "All URLs copied to clipboard" });
  };

  const copySiteUrls = (site: SiteResult) => {
    const text = site.articles.map((a) => a.url).join("\n");
    navigator.clipboard.writeText(text);
    toast({ title: `Copied ${site.articles.length} URL${site.articles.length !== 1 ? "s" : ""}` });
  };

  const downloadAllCsv = () => {
    const rows = [["Site", "Title", "URL", "Date"]];
    results.forEach((site) => {
      site.articles.forEach((a) => {
        rows.push([site.siteUrl, a.title, a.url, a.date]);
      });
    });
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fetch-links-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalArticles = results.reduce((n, s) => n + s.articles.length, 0);
  const sitesWithErrors = results.filter((s) => !!s.error);

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center">
          <div>
            <h1 className="text-2xl font-bold">Fetch Links</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Fetch articles published in the last 24 hours from any public WordPress site — no login required.
            </p>
          </div>
          {results.length > 0 && (
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={downloadAllCsv}>
                <Download className="w-4 h-4 mr-2" />
                CSV
              </Button>
              <Button size="sm" onClick={copyAllUrls} disabled={totalArticles === 0}>
                <Copy className="w-4 h-4 mr-2" />
                Copy All URLs
              </Button>
            </div>
          )}
        </div>

        {/* Input card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              WordPress Site URLs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={siteInput}
              onChange={(e) => setSiteInput(e.target.value)}
              placeholder={`Enter one WordPress URL per line, e.g.\nhttps://example.com\nhttps://myblog.com\nhttps://news-site.com`}
              className="min-h-[140px] font-mono text-sm resize-y"
              disabled={loading}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">
                {parseSites(siteInput).length} site{parseSites(siteInput).length !== 1 ? "s" : ""} entered
                {" · "}URLs auto-saved
              </span>
              <div className="flex gap-2">
                {loading && (
                  <Button variant="ghost" size="sm" onClick={() => abortRef.current?.abort()} className="text-red-500">
                    Cancel
                  </Button>
                )}
                <Button onClick={handleFetch} disabled={loading} className="min-w-[110px]">
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Fetching…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Fetch Now
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary bar */}
        {results.length > 0 && (
          <div className="flex flex-wrap gap-3 items-center text-sm">
            <Badge variant="secondary" className="text-sm px-3 py-1">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-green-500" />
              {totalArticles} articles found
            </Badge>
            <Badge variant="secondary" className="text-sm px-3 py-1">
              <Globe className="w-3.5 h-3.5 mr-1.5" />
              {results.length} site{results.length !== 1 ? "s" : ""} checked
            </Badge>
            {sitesWithErrors.length > 0 && (
              <Badge variant="destructive" className="text-sm px-3 py-1">
                <AlertCircle className="w-3.5 h-3.5 mr-1.5" />
                {sitesWithErrors.length} site{sitesWithErrors.length !== 1 ? "s" : ""} failed
              </Badge>
            )}
          </div>
        )}

        {/* Results */}
        <div className="grid gap-4">
          {results.map((site) => (
            <Card key={site.siteUrl} className={site.error ? "border-red-200 dark:border-red-800" : ""}>
              <CardHeader className="bg-gray-50/50 dark:bg-zinc-900/50 border-b pb-3">
                <CardTitle className="text-sm flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {site.error ? (
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                    )}
                    <span className="font-mono text-xs truncate max-w-[320px] text-gray-700 dark:text-gray-300">
                      {site.siteUrl}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-normal text-gray-500 bg-gray-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
                      {site.articles.length} article{site.articles.length !== 1 ? "s" : ""}
                    </span>
                    {site.articles.length > 0 && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => copySiteUrls(site)}>
                        <Copy className="w-3 h-3 mr-1" />
                        Copy
                      </Button>
                    )}
                  </div>
                </CardTitle>
                {site.error && (
                  <p className="text-xs text-red-500 mt-1 pl-6">{site.error}</p>
                )}
              </CardHeader>

              {site.articles.length > 0 && (
                <CardContent className="p-0">
                  <div className="divide-y divide-gray-100 dark:divide-zinc-800">
                    {site.articles.map((article, i) => (
                      <div key={i} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-zinc-800/30 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-0.5 leading-snug">
                              {article.title}
                            </p>
                            <a
                              href={article.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-primary hover:underline break-all"
                            >
                              {article.url}
                            </a>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-[11px] text-gray-400 whitespace-nowrap">
                              {new Date(article.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 ml-1"
                              title="Copy URL"
                              onClick={() => {
                                navigator.clipboard.writeText(article.url);
                                toast({ title: "URL copied" });
                              }}
                            >
                              <Copy className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}

              {site.articles.length === 0 && !site.error && (
                <CardContent className="py-6 text-center text-sm text-gray-400">
                  No articles published in the last 24 hours.
                </CardContent>
              )}
            </Card>
          ))}
        </div>

        {/* Empty state */}
        {!loading && results.length === 0 && (
          <div className="py-16 text-center border border-dashed rounded-lg text-gray-400 dark:border-zinc-700">
            <Globe className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">Enter WordPress URLs above and click Fetch Now</p>
            <p className="text-xs mt-1">Articles from the last 24 hours will appear here</p>
          </div>
        )}
      </div>
    </Layout>
  );
}
