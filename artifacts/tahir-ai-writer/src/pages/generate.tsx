import { useState, useEffect, useCallback } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useListSites, useGenerateArticles, useGetGenerateStatus } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/errors";
import {
  PenLine, Zap, List, Sparkles, Calendar, FileText,
  Loader2, Pin, Globe, Clock, Send, Lightbulb, Copy, Check, PlusCircle, LayoutGrid,
  ScanSearch, Filter, X, BadgeCheck, AlertCircle
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";

interface LogItem {
  id: number;
  keyword: string;
  status: "queued" | "generating" | "published" | "draft" | "failed";
  siteName: string | null;
  siteId: number | null;
  publishedUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  publishedAt: string | null;
}

function timeAgo(dateStr: string): string {
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Generate() {
  const [keywords, setKeywords] = useState("");
  const [language, setLanguage] = useState("English");
  const [wordCount, setWordCount] = useState("800");
  const [imageSource, setImageSource] = useState<"pollinations" | "url" | "none">("pollinations");
  const [imageUrl, setImageUrl] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [selectedSites, setSelectedSites] = useState<number[]>([]);
  const [publishNow, setPublishNow] = useState(false);
  const [logItems, setLogItems] = useState<LogItem[]>([]);
  const [sessionIds, setSessionIds] = useState<number[] | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<number>>(new Set());
  const [expandedErrors, setExpandedErrors] = useState<Set<number>>(new Set());
  const [retryAllLoading, setRetryAllLoading] = useState(false);
  // Bulk per-site mode
  const [bulkMode, setBulkMode] = useState(false);
  const [siteKeywords, setSiteKeywords] = useState<Record<number, string>>({});
  // Smart keyword filter
  const [autoFilter, setAutoFilter] = useState(false);
  const [filterLoading, setFilterLoading] = useState(false);
  const [masterKeywords, setMasterKeywords] = useState("");
  const [filterSummary, setFilterSummary] = useState<{
    totalChecked: number;
    totalRemoved: number;
    sitesChecked: number;
    perSite: { siteId: number; siteName: string; removed: number; kept: number }[];
  } | null>(null);
  // Keyword suggestions
  const [niche, setNiche] = useState("");
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestedKeywords, setSuggestedKeywords] = useState<string[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const { data: sites = [] } = useListSites();
  const generateMutation = useGenerateArticles();
  const { data: status, refetch: refetchStatus } = useGetGenerateStatus();
  const { toast } = useToast();

  const fetchLogs = useCallback(async () => {
    try {
      const res = await apiFetch("/generate/logs");
      if (res.ok) {
        const data = await res.json();
        setLogItems(data.items || []);
      }
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(() => {
      refetchStatus();
      fetchLogs();
    }, 3000);
    return () => clearInterval(interval);
  }, [refetchStatus, fetchLogs]);

  // Auto-hide log when every article in the current session is finished
  useEffect(() => {
    if (!sessionIds || sessionIds.length === 0) return;
    const sessionItems = logItems.filter(i => sessionIds.includes(i.id));
    if (sessionItems.length === 0) return; // Not loaded yet
    const allDone = sessionItems.every(i => i.status !== "queued" && i.status !== "generating");
    if (allDone) {
      const timer = setTimeout(() => setSessionIds(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [logItems, sessionIds]);

  const keywordList = keywords.split("\n").map(k => k.trim()).filter(k => k);

  const handleSelectAll = () => {
    if (selectedSites.length === sites.length) {
      setSelectedSites([]);
    } else {
      setSelectedSites(sites.map(s => s.id));
    }
  };

  const handlePinAll = () => {
    const pinned = sites.filter(s => s.isPinned).map(s => s.id);
    setSelectedSites(pinned);
  };

  const toggleSite = (id: number) => {
    setSelectedSites(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const handleScheduleToggle = (val: boolean) => {
    setScheduleEnabled(val);
    if (!val) setScheduledAt("");
  };

  const handleGenerate = async () => {
    if (bulkMode) {
      // Bulk mode: each site has its own keywords
      const sitesToGenerate = sites.filter(site => {
        const kwStr = siteKeywords[site.id] || "";
        return kwStr.split("\n").map((k: string) => k.trim()).filter(Boolean).length > 0;
      });

      if (sitesToGenerate.length === 0) {
        toast({ title: "Validation Error", description: "Enter at least one keyword for at least one site", variant: "destructive" });
        return;
      }

      const totalArticles = sitesToGenerate.reduce((sum, site) => {
        const kwList = (siteKeywords[site.id] || "").split("\n").map((k: string) => k.trim()).filter(Boolean);
        return sum + kwList.length;
      }, 0);

      try {
        const allJobIds: number[] = [];
        for (const site of sitesToGenerate) {
          const kwList = (siteKeywords[site.id] || "").split("\n").map((k: string) => k.trim()).filter(Boolean);
          const result: any = await generateMutation.mutateAsync({
            data: {
              keywords: kwList,
              siteIds: [site.id],
              language,
              wordCount: parseInt(wordCount),
              imageSource,
              imageUrl: imageSource === "url" ? imageUrl : undefined,
              scheduledAt: scheduleEnabled && scheduledAt ? scheduledAt : undefined,
              publishNow,
            }
          });
          if (result?.jobIds) allJobIds.push(...result.jobIds);
        }
        setSessionIds(allJobIds);
        toast({
          title: "Generation started!",
          description: `${totalArticles} article${totalArticles > 1 ? "s" : ""} queued across ${sitesToGenerate.length} site${sitesToGenerate.length > 1 ? "s" : ""}. They will be ${publishNow ? "published" : "saved as drafts"} when ready.`
        });
        setSiteKeywords({});
        refetchStatus();
        setTimeout(fetchLogs, 800);
      } catch (e: unknown) {
        toast(toastError(e));
      }
      return;
    }

    // Normal mode: shared keywords across selected sites
    if (keywordList.length === 0) {
      toast({ title: "Validation Error", description: "Please enter at least one keyword", variant: "destructive" });
      return;
    }
    if (selectedSites.length === 0) {
      toast({ title: "Validation Error", description: "Please select at least one site", variant: "destructive" });
      return;
    }

    try {
      const result: any = await generateMutation.mutateAsync({
        data: {
          keywords: keywordList,
          siteIds: selectedSites,
          language,
          wordCount: parseInt(wordCount),
          imageSource,
          imageUrl: imageSource === "url" ? imageUrl : undefined,
          scheduledAt: scheduleEnabled && scheduledAt ? scheduledAt : undefined,
          publishNow,
        }
      });

      if (result?.jobIds) setSessionIds(result.jobIds);
      const totalArticles = keywordList.length * selectedSites.length;
      toast({
        title: "Generation started!",
        description: `${totalArticles} article${totalArticles > 1 ? "s" : ""} queued. They will be ${publishNow ? "published" : "saved as drafts"} when ready.`
      });
      setKeywords("");
      refetchStatus();
      setTimeout(fetchLogs, 800);
    } catch (e: unknown) {
      toast(toastError(e));
    }
  };

  const handleSuggestKeywords = async () => {
    if (!niche.trim()) {
      toast({ title: "Enter a niche", description: "Type a niche topic first (e.g. technology, fitness, gaming)", variant: "destructive" });
      return;
    }
    setSuggestLoading(true);
    setSuggestedKeywords([]);
    setSelectedSuggestions(new Set());
    try {
      const res = await apiFetch("/generate/suggest-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche: niche.trim(), language }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get suggestions");
      setSuggestedKeywords(data.keywords || []);
    } catch (e: unknown) {
      toast(toastError(e));
    } finally {
      setSuggestLoading(false);
    }
  };

  const toggleSuggestion = (idx: number) => {
    setSelectedSuggestions(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const addSuggestionsToKeywords = (indices: number[]) => {
    const toAdd = indices.map(i => suggestedKeywords[i]).filter(Boolean);
    const existing = keywords.split("\n").map(k => k.trim()).filter(Boolean);
    const merged = [...new Set([...existing, ...toAdd])];
    setKeywords(merged.join("\n"));
    setSelectedSuggestions(new Set());
    toast({ title: `${toAdd.length} keyword${toAdd.length !== 1 ? "s" : ""} added`, description: "Scroll up to see them in the keywords box." });
  };

  const copySingleKeyword = async (kw: string, idx: number) => {
    await navigator.clipboard.writeText(kw);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  const handleScanFilter = async () => {
    const source = bulkMode ? masterKeywords : keywords;
    const kwList = source.split("\n").map(k => k.trim()).filter(Boolean);
    if (!kwList.length) {
      toast({ title: "No keywords", description: "Add keywords to the box first before scanning.", variant: "destructive" });
      return;
    }
    if (!selectedSites.length) {
      toast({ title: "No sites selected", description: "Select at least one site to scan.", variant: "destructive" });
      return;
    }
    setFilterLoading(true);
    setFilterSummary(null);
    try {
      const res = await apiFetch("/generate/check-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: kwList, siteIds: selectedSites }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      const results: { siteId: number; siteName: string; existing: string[]; missing: string[] }[] = data.results;

      let totalRemoved = 0;
      const perSite: { siteId: number; siteName: string; removed: number; kept: number }[] = [];

      if (bulkMode) {
        // Per-site mode: fill each site's keyword box with only its missing keywords
        const updates: Record<number, string> = {};
        for (const r of results) {
          updates[r.siteId] = r.missing.join("\n");
          totalRemoved += r.existing.length;
          perSite.push({ siteId: r.siteId, siteName: r.siteName, removed: r.existing.length, kept: r.missing.length });
        }
        setSiteKeywords(prev => ({ ...prev, ...updates }));
      } else {
        // Normal mode: remove keywords that exist on ANY selected site
        const existingOnAny = new Set<string>();
        for (const r of results) {
          r.existing.forEach(kw => existingOnAny.add(kw));
          perSite.push({ siteId: r.siteId, siteName: r.siteName, removed: r.existing.length, kept: r.missing.length });
        }
        const filtered = kwList.filter(kw => !existingOnAny.has(kw));
        totalRemoved = kwList.length - filtered.length;
        setKeywords(filtered.join("\n"));
      }

      setFilterSummary({ totalChecked: kwList.length, totalRemoved, sitesChecked: results.length, perSite });
      toast({
        title: totalRemoved > 0 ? `${totalRemoved} duplicate${totalRemoved !== 1 ? "s" : ""} removed` : "All keywords are new!",
        description: totalRemoved > 0
          ? `${kwList.length - totalRemoved} unique keyword${(kwList.length - totalRemoved) !== 1 ? "s" : ""} kept across ${results.length} site${results.length !== 1 ? "s" : ""}`
          : "None of your keywords exist on the selected sites.",
      });
    } catch (e: unknown) {
      toast(toastError(e));
    } finally {
      setFilterLoading(false);
    }
  };

  const pendingCount = logItems.filter(i => i.status === "queued").length;
  const processingCount = logItems.filter(i => i.status === "generating").length;

  // Session-scoped items (only current batch)
  const sessionLogItems = sessionIds ? logItems.filter(i => sessionIds.includes(i.id)) : [];
  const failedCount = sessionLogItems.filter(i => i.status === "failed").length;
  const publishedCount = sessionLogItems.filter(i => i.status === "published").length;
  const draftCount = sessionLogItems.filter(i => i.status === "draft").length;
  const sessionPending = sessionLogItems.filter(i => i.status === "queued").length;
  const sessionProcessing = sessionLogItems.filter(i => i.status === "generating").length;
  const imageEnabled = imageSource !== "none";

  const handleRetry = async (id: number) => {
    setRetryingIds(prev => new Set([...prev, id]));
    try {
      const res = await apiFetch(`/generate/retry/${id}`, { method: "POST" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Retry failed"); }
      await fetchLogs();
      toast({ title: "Article re-queued", description: "It will be picked up by the generator shortly." });
    } catch (e: unknown) { toast(toastError(e)); }
    finally { setRetryingIds(prev => { const n = new Set(prev); n.delete(id); return n; }); }
  };

  const handleRetryAllFailed = async () => {
    setRetryAllLoading(true);
    try {
      const res = await apiFetch("/generate/retry-all-failed", { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Retry failed");
      await fetchLogs();
      toast({ title: `${d.retried} article${d.retried !== 1 ? "s" : ""} re-queued`, description: "All failed articles are being retried." });
    } catch (e: unknown) { toast(toastError(e)); }
    finally { setRetryAllLoading(false); }
  };

  const toggleError = (id: number) => {
    setExpandedErrors(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  return (
    <Layout>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2.5">
          <PenLine className="w-6 h-6 text-primary" />
          Generate Content
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Enter a keyword and select sites to generate unique articles
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* ── Left: Article Settings ── */}
        <div className="flex-1 min-w-0 space-y-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-4 border-b border-gray-100 dark:border-zinc-800">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-lg">Article Settings</CardTitle>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 font-normal">
                    Configure your content generation
                  </p>
                </div>
                {/* Toggles */}
                <div className="flex flex-col gap-2.5 shrink-0">
                  {/* Per-Site Mode */}
                  <div className="flex items-center gap-2.5">
                    <div className="text-right">
                      <p className="text-sm font-medium flex items-center gap-1.5 justify-end">
                        <LayoutGrid className="w-3.5 h-3.5 text-primary" />
                        Per-Site Mode
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {bulkMode ? "Each site gets its own keywords" : "Shared keywords for all sites"}
                      </p>
                    </div>
                    <Switch checked={bulkMode} onCheckedChange={setBulkMode} />
                  </div>
                  {/* Smart Filter toggle */}
                  <div className="flex items-center gap-2.5">
                    <div className="text-right">
                      <p className="text-sm font-medium flex items-center gap-1.5 justify-end">
                        <ScanSearch className="w-3.5 h-3.5 text-emerald-500" />
                        Smart Filter
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {autoFilter ? "Scans & removes duplicates" : "Filter existing keywords"}
                      </p>
                    </div>
                    <Switch checked={autoFilter} onCheckedChange={(v) => { setAutoFilter(v); setFilterSummary(null); }} />
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-5 space-y-5">

              {/* Keywords section — normal or per-site */}
              {!bulkMode ? (
                <div className="space-y-2">
                  <Label className="flex items-center gap-2 text-sm font-medium">
                    <List className="w-4 h-4 text-gray-500" />
                    Keywords / Topics * <span className="font-normal text-gray-400">(one per line)</span>
                  </Label>
                  <Textarea
                    rows={5}
                    value={keywords}
                    onChange={(e) => { setKeywords(e.target.value); setFilterSummary(null); }}
                    placeholder={"best laptops 2026\nhealthy breakfast recipes\ndigital marketing tips\nhome workout routine"}
                    className="font-mono text-sm resize-y bg-white dark:bg-zinc-950"
                  />
                  <p className="text-xs text-gray-400">
                    Enter one keyword per line • Each keyword will generate unique articles for all selected sites
                  </p>

                  {/* Smart Filter panel — normal mode */}
                  {autoFilter && (
                    <div className="mt-1 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <ScanSearch className="w-4 h-4 text-emerald-600" />
                          <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Smart Filter Active</span>
                          <span className="text-xs text-emerald-600/70 dark:text-emerald-500/70">— scans selected sites and removes duplicate keywords</span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-900/40 shrink-0"
                          onClick={handleScanFilter}
                          disabled={filterLoading || !selectedSites.length || !keywords.trim()}
                        >
                          {filterLoading ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Scanning…</> : <><ScanSearch className="w-3.5 h-3.5 mr-1.5" />Scan & Filter</>}
                        </Button>
                      </div>
                      {!selectedSites.length && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          Select at least one site below to enable scanning
                        </p>
                      )}
                      {filterSummary && !bulkMode && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 gap-1">
                              <BadgeCheck className="w-3 h-3" />
                              {filterSummary.totalChecked - filterSummary.totalRemoved} unique kept
                            </Badge>
                            {filterSummary.totalRemoved > 0 && (
                              <Badge variant="secondary" className="bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 gap-1">
                                <X className="w-3 h-3" />
                                {filterSummary.totalRemoved} removed
                              </Badge>
                            )}
                            <Badge variant="secondary" className="bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-400 gap-1">
                              <Globe className="w-3 h-3" />
                              {filterSummary.sitesChecked} site{filterSummary.sitesChecked !== 1 ? "s" : ""} scanned
                            </Badge>
                          </div>
                          {filterSummary.perSite.length > 1 && (
                            <div className="text-xs text-gray-500 space-y-0.5">
                              {filterSummary.perSite.map(s => (
                                <div key={s.siteId} className="flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/60" />
                                  <span className="font-medium truncate max-w-[160px]">{s.siteName}</span>
                                  <span>— {s.removed > 0 ? `${s.removed} removed` : "no duplicates"}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <Label className="flex items-center gap-2 text-sm font-medium">
                    <LayoutGrid className="w-4 h-4 text-primary" />
                    Keywords per Site
                    <span className="font-normal text-gray-400">(one keyword per line, per site)</span>
                  </Label>

                  {/* Smart Filter — per-site master keywords */}
                  {autoFilter && (
                    <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 space-y-3">
                      <div className="flex items-center gap-2 mb-1">
                        <ScanSearch className="w-4 h-4 text-emerald-600" />
                        <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Smart Filter — Master Keywords</span>
                      </div>
                      <p className="text-xs text-emerald-700/70 dark:text-emerald-400/70">
                        Paste your full keyword list here. After scanning, each site's box will be auto-filled with only the keywords that don't already exist on that site.
                      </p>
                      <Textarea
                        rows={4}
                        value={masterKeywords}
                        onChange={(e) => { setMasterKeywords(e.target.value); setFilterSummary(null); }}
                        placeholder={"best laptops 2026\nhealthy breakfast recipes\ndigital marketing tips\nhome workout routine"}
                        className="font-mono text-sm resize-y bg-white dark:bg-zinc-950 border-emerald-200 dark:border-emerald-800 focus-visible:ring-emerald-400"
                      />
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex flex-wrap gap-2">
                          {filterSummary && bulkMode && (
                            <>
                              <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 gap-1">
                                <BadgeCheck className="w-3 h-3" />
                                {filterSummary.totalChecked - filterSummary.totalRemoved} total unique
                              </Badge>
                              {filterSummary.totalRemoved > 0 && (
                                <Badge variant="secondary" className="bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 gap-1">
                                  <X className="w-3 h-3" />
                                  {filterSummary.totalRemoved} duplicates removed
                                </Badge>
                              )}
                            </>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-900/40 shrink-0"
                          onClick={handleScanFilter}
                          disabled={filterLoading || !selectedSites.length || !masterKeywords.trim()}
                        >
                          {filterLoading
                            ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Scanning sites…</>
                            : <><ScanSearch className="w-3.5 h-3.5 mr-1.5" />Scan & Distribute</>}
                        </Button>
                      </div>
                      {filterSummary && bulkMode && filterSummary.perSite.length > 0 && (
                        <div className="text-xs text-gray-500 border-t border-emerald-100 dark:border-emerald-900/40 pt-2 space-y-0.5">
                          <p className="font-medium text-gray-600 dark:text-gray-400 mb-1">Per-site results:</p>
                          {filterSummary.perSite.map(s => (
                            <div key={s.siteId} className="flex items-center gap-2">
                              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.kept > 0 ? "bg-emerald-500" : "bg-gray-300"}`} />
                              <span className="font-medium truncate max-w-[150px]">{s.siteName}</span>
                              <span className="text-gray-400">—</span>
                              <span className="text-emerald-600 dark:text-emerald-400">{s.kept} new</span>
                              {s.removed > 0 && <span className="text-red-400">{s.removed} skipped</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      {!selectedSites.length && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          Select sites below first to enable scanning
                        </p>
                      )}
                    </div>
                  )}

                  {selectedSites.length === 0 ? (
                    <div className="py-8 text-center text-gray-400 text-sm border border-dashed rounded-lg">
                      <LayoutGrid className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="font-medium">No sites selected</p>
                      <p className="mt-1 text-xs">Select sites below to add keywords for each</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {sites.filter(s => selectedSites.includes(s.id)).map(site => {
                        const kwStr = siteKeywords[site.id] || "";
                        const kwCount = kwStr.split("\n").map((k: string) => k.trim()).filter(Boolean).length;
                        return (
                          <div key={site.id} className="rounded-xl border border-gray-200 dark:border-zinc-800 overflow-hidden">
                            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50/70 dark:bg-zinc-900/50 border-b border-gray-100 dark:border-zinc-800">
                              <div className="w-2 h-2 rounded-full bg-primary/60 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium truncate block">{site.name}</span>
                                <span className="text-xs text-gray-400 truncate block">{site.url}</span>
                              </div>
                              {kwCount > 0 && (
                                <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
                                  {kwCount} keyword{kwCount !== 1 ? "s" : ""}
                                </span>
                              )}
                            </div>
                            <Textarea
                              rows={3}
                              value={kwStr}
                              onChange={(e) => setSiteKeywords(prev => ({ ...prev, [site.id]: e.target.value }))}
                              placeholder={`Keywords for ${site.name}\nbest laptops 2026\nhow to invest in stocks`}
                              className="font-mono text-sm resize-y bg-white dark:bg-zinc-950 border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-xs text-gray-400">
                    Enter one keyword per line for each site • Leave empty to skip that site
                  </p>
                </div>
              )}

              {/* Language + Word Count */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-sm">Language</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger className="bg-white dark:bg-zinc-950">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="English">🇬🇧 English</SelectItem>
                      <SelectItem value="German">🇩🇪 German</SelectItem>
                      <SelectItem value="French">🇫🇷 French</SelectItem>
                      <SelectItem value="Italian">🇮🇹 Italian</SelectItem>
                      <SelectItem value="Russian">🇷🇺 Russian</SelectItem>
                      <SelectItem value="Spanish">🇪🇸 Spanish</SelectItem>
                      <SelectItem value="Turkish">🇹🇷 Turkish</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Word Count</Label>
                  <Select value={wordCount} onValueChange={setWordCount}>
                    <SelectTrigger className="bg-white dark:bg-zinc-950">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="800">800 words</SelectItem>
                      <SelectItem value="1200">1200 words</SelectItem>
                      <SelectItem value="1500">1500 words</SelectItem>
                      <SelectItem value="2000">2000 words</SelectItem>
                      <SelectItem value="2500">2500 words</SelectItem>
                      <SelectItem value="3000">3000 words</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* ── Toggle rows ── */}

              {/* AI Image Generation */}
              <div className="rounded-xl border border-gray-200 dark:border-zinc-800 overflow-hidden">
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-purple-100 dark:bg-purple-950/40 flex items-center justify-center shrink-0">
                      <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">AI Image Generation</p>
                      <p className="text-xs text-gray-500 mt-0.5">Using Pollinations Flux model</p>
                    </div>
                  </div>
                  <Switch
                    checked={imageEnabled}
                    onCheckedChange={(val) => setImageSource(val ? "pollinations" : "none")}
                  />
                </div>

                {imageEnabled && (
                  <div className="px-4 pb-4 pt-0 border-t border-gray-100 dark:border-zinc-800 bg-gray-50/50 dark:bg-zinc-900/30 space-y-3">
                    <div className="space-y-1.5 pt-3">
                      <Label className="text-sm">Image Model</Label>
                      <Select value={imageSource} onValueChange={(val: any) => setImageSource(val)}>
                        <SelectTrigger className="bg-white dark:bg-zinc-950">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pollinations">Pollinations Flux (default)</SelectItem>
                          <SelectItem value="url">Custom URL</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-gray-400">Fast, high-quality general purpose image generation.</p>
                    </div>
                    {imageSource === "url" && (
                      <div className="space-y-1.5">
                        <Label className="text-sm">Image URL</Label>
                        <Input
                          placeholder="https://example.com/image.jpg"
                          value={imageUrl}
                          onChange={(e) => setImageUrl(e.target.value)}
                          className="bg-white dark:bg-zinc-950"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Instant Publish */}
              <div className="rounded-xl border border-gray-200 dark:border-zinc-800 p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                    <Send className="w-4 h-4 text-gray-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Instant Publish</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {publishNow ? "Articles will be published directly" : "Articles will be saved as drafts"}
                    </p>
                  </div>
                </div>
                <Switch checked={publishNow} onCheckedChange={setPublishNow} />
              </div>

              {/* Schedule Publishing */}
              <div className="rounded-xl border border-gray-200 dark:border-zinc-800 overflow-hidden">
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                      <Calendar className="w-4 h-4 text-gray-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Schedule Publishing</p>
                      <p className="text-xs text-gray-500 mt-0.5">Auto-publish articles at a specific date/time</p>
                    </div>
                  </div>
                  <Switch checked={scheduleEnabled} onCheckedChange={handleScheduleToggle} />
                </div>
                {scheduleEnabled && (
                  <div className="px-4 pb-4 border-t border-gray-100 dark:border-zinc-800 bg-gray-50/50 dark:bg-zinc-900/30 pt-3">
                    <Input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                      className="bg-white dark:bg-zinc-950"
                    />
                  </div>
                )}
              </div>

            </CardContent>
          </Card>

          {/* ── Select Sites ── */}
          <Card className="shadow-sm">
              <CardHeader className="pb-3 border-b border-gray-100 dark:border-zinc-800">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Select Sites</CardTitle>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 font-normal">
                      {sites.length} connected site{sites.length !== 1 ? "s" : ""} available
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={handlePinAll} className="text-xs h-8">
                      <Pin className="w-3.5 h-3.5 mr-1.5" />
                      Select Pinned
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleSelectAll} className="text-xs h-8">
                      {selectedSites.length === sites.length && sites.length > 0 ? "Deselect All" : "Select All"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                  {sites.map(site => (
                    <div
                      key={site.id}
                      onClick={() => toggleSite(site.id)}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                        selectedSites.includes(site.id)
                          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                          : "border-gray-200 dark:border-zinc-800 hover:border-primary/50"
                      }`}
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                        selectedSites.includes(site.id) ? "bg-primary border-primary text-white" : "border-gray-300 dark:border-zinc-600"
                      }`}>
                        {selectedSites.includes(site.id) && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3 h-3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                      <div className="truncate flex-1">
                        <div className="font-medium text-sm truncate">{site.name}</div>
                        <div className="text-xs text-gray-500 truncate">{site.url}</div>
                      </div>
                      {site.isPinned && <Pin className="w-3 h-3 text-primary shrink-0" />}
                    </div>
                  ))}
                  {sites.length === 0 && (
                    <div className="col-span-full py-10 text-center text-gray-400 text-sm">
                      <Globe className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      No connected sites found. Add a site first.
                    </div>
                  )}
                </div>
              </CardContent>
          </Card>
        </div>

        {/* ── Right: Generate card ── */}
        <div className="w-full lg:w-64 shrink-0 space-y-4 lg:sticky lg:top-0">
          <Card className="shadow-sm">
            <CardHeader className="pb-3 border-b border-gray-100 dark:border-zinc-800">
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="w-4 h-4 text-primary fill-primary" />
                Generate
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5 space-y-5">
              {/* Stats */}
              {bulkMode ? (() => {
                const bulkSitesWithKw = sites.filter(s => (siteKeywords[s.id] || "").split("\n").map((k: string) => k.trim()).filter(Boolean).length > 0);
                const bulkTotal = bulkSitesWithKw.reduce((sum, s) => sum + (siteKeywords[s.id] || "").split("\n").map((k: string) => k.trim()).filter(Boolean).length, 0);
                return (
                  <>
                    <div className="flex justify-around">
                      <div className="text-center">
                        <div className="text-4xl font-bold text-gray-900 dark:text-gray-100">{bulkTotal}</div>
                        <div className="text-xs text-gray-500 mt-1">Keywords</div>
                      </div>
                      <div className="w-px bg-gray-200 dark:bg-zinc-700" />
                      <div className="text-center">
                        <div className="text-4xl font-bold text-gray-900 dark:text-gray-100">{bulkSitesWithKw.length}</div>
                        <div className="text-xs text-gray-500 mt-1">Sites</div>
                      </div>
                    </div>
                    {bulkTotal > 0 && (
                      <p className="text-xs text-center text-gray-400">
                        {bulkTotal} article{bulkTotal !== 1 ? "s" : ""} will be queued across {bulkSitesWithKw.length} site{bulkSitesWithKw.length !== 1 ? "s" : ""}
                      </p>
                    )}
                  </>
                );
              })() : (
                <>
                  <div className="flex justify-around">
                    <div className="text-center">
                      <div className="text-4xl font-bold text-gray-900 dark:text-gray-100">{keywordList.length}</div>
                      <div className="text-xs text-gray-500 mt-1">Keywords</div>
                    </div>
                    <div className="w-px bg-gray-200 dark:bg-zinc-700" />
                    <div className="text-center">
                      <div className="text-4xl font-bold text-gray-900 dark:text-gray-100">{selectedSites.length}</div>
                      <div className="text-xs text-gray-500 mt-1">Sites</div>
                    </div>
                  </div>
                  {keywordList.length > 0 && selectedSites.length > 0 && (
                    <p className="text-xs text-center text-gray-400">
                      {keywordList.length * selectedSites.length} total article{keywordList.length * selectedSites.length !== 1 ? "s" : ""} will be queued
                    </p>
                  )}
                </>
              )}

              {/* Generate button */}
              <Button
                size="lg"
                className="w-full font-semibold"
                onClick={handleGenerate}
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4 mr-2" />
                )}
                {publishNow ? "Generate & Publish" : "Generate Drafts"}
              </Button>
            </CardContent>
          </Card>

          {/* Generation Log panel — only shows current batch */}
          {sessionLogItems.length > 0 && (
            <Card className="shadow-sm">
              <CardHeader className="pb-2.5 border-b border-gray-100 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-primary" />
                      Generation Log
                      <span className="font-normal text-gray-400 text-xs">({sessionLogItems.length})</span>
                    </CardTitle>
                    {/* Status pill bar */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      {sessionProcessing > 0 && (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 rounded-full">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />{sessionProcessing} generating
                        </span>
                      )}
                      {sessionPending > 0 && (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded-full">
                          <Clock className="w-2.5 h-2.5" />{sessionPending} queued
                        </span>
                      )}
                      {publishedCount > 0 && (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded-full">
                          <Check className="w-2.5 h-2.5" />{publishedCount} published
                        </span>
                      )}
                      {draftCount > 0 && (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-full">
                          <FileText className="w-2.5 h-2.5" />{draftCount} draft
                        </span>
                      )}
                      {failedCount > 0 && (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-1.5 py-0.5 rounded-full">
                          <AlertCircle className="w-2.5 h-2.5" />{failedCount} failed
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Retry all failed */}
                  {failedCount > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[11px] h-7 px-2 border-red-200 text-red-500 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40 shrink-0"
                      onClick={handleRetryAllFailed}
                      disabled={retryAllLoading}
                    >
                      {retryAllLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Zap className="w-3 h-3 mr-1" />Retry all</>}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-gray-100 dark:divide-zinc-800 max-h-[420px] overflow-y-auto">
                  {sessionLogItems.map(item => {
                    const isActive = item.status === "queued" || item.status === "generating";
                    const isFailed = item.status === "failed";
                    const isPublished = item.status === "published";
                    const isDraft = item.status === "draft";
                    const isRetrying = retryingIds.has(item.id);
                    const errExpanded = expandedErrors.has(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`px-3 py-2.5 transition-colors ${isActive ? "bg-blue-50/40 dark:bg-blue-950/10" : isFailed ? "bg-red-50/30 dark:bg-red-950/10" : ""}`}
                      >
                        <div className="flex items-start gap-2.5">
                          {/* Status icon */}
                          <div className="mt-0.5 shrink-0">
                            {item.status === "generating" && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />}
                            {item.status === "queued" && <Clock className="w-3.5 h-3.5 text-amber-500" />}
                            {isPublished && <BadgeCheck className="w-3.5 h-3.5 text-emerald-500" />}
                            {isDraft && <FileText className="w-3.5 h-3.5 text-gray-400" />}
                            {isFailed && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-medium truncate flex-1">{item.keyword}</p>
                              {/* Published link */}
                              {isPublished && item.publishedUrl && (
                                <a
                                  href={item.publishedUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-emerald-500 hover:text-emerald-700 shrink-0"
                                  title="View article"
                                >
                                  <Globe className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              {item.siteName && <p className="text-[10px] text-gray-400 truncate max-w-[90px]">{item.siteName}</p>}
                              <p className="text-[10px] text-gray-300 dark:text-gray-600">{timeAgo(item.createdAt)}</p>
                            </div>
                            {/* Failed error row */}
                            {isFailed && item.errorMessage && (
                              <div className="mt-1">
                                <button
                                  className="text-[10px] text-red-400 hover:text-red-600 flex items-center gap-0.5"
                                  onClick={() => toggleError(item.id)}
                                >
                                  <AlertCircle className="w-2.5 h-2.5" />
                                  {errExpanded ? "Hide error" : "Show error"}
                                </button>
                                {errExpanded && (
                                  <p className="mt-1 text-[10px] text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/40 rounded px-2 py-1 break-words">
                                    {item.errorMessage}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Right actions */}
                          <div className="shrink-0 flex items-center gap-1 mt-0.5">
                            {/* Status badge */}
                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${
                              item.status === "generating" ? "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400" :
                              item.status === "queued" ? "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400" :
                              isPublished ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400" :
                              isDraft ? "bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-gray-400" :
                              "bg-red-100 text-red-500 dark:bg-red-900/30 dark:text-red-400"
                            }`}>
                              {item.status}
                            </span>
                            {/* Retry button for failed */}
                            {isFailed && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                                onClick={() => handleRetry(item.id)}
                                disabled={isRetrying}
                                title="Retry this article"
                              >
                                {isRetrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

      </div>

      {/* ── AI Keyword Suggestions ── */}
      <div className="mt-6">
        <Card className="shadow-sm">
          <CardHeader className="pb-4 border-b border-gray-100 dark:border-zinc-800">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center shrink-0">
                <Lightbulb className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <CardTitle className="text-base">AI Keyword Suggestions</CardTitle>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 font-normal">
                  Enter your niche — AI will generate 10 ready-to-use SEO keywords
                </p>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-5 space-y-4">
            {/* Niche input row */}
            <div className="flex gap-2.5">
              <Input
                placeholder="e.g. technology, fitness, gaming, finance..."
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSuggestKeywords()}
                className="bg-white dark:bg-zinc-950 flex-1"
              />
              <Button
                onClick={handleSuggestKeywords}
                disabled={suggestLoading}
                className="shrink-0 gap-2"
              >
                {suggestLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {suggestLoading ? "Generating..." : "Suggest Keywords"}
              </Button>
            </div>

            {/* Loading skeleton */}
            {suggestLoading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-10 rounded-lg bg-gray-100 dark:bg-zinc-800 animate-pulse"
                    style={{ animationDelay: `${i * 60}ms` }}
                  />
                ))}
              </div>
            )}

            {/* Keyword chips */}
            {!suggestLoading && suggestedKeywords.length > 0 && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {suggestedKeywords.map((kw, idx) => {
                    const selected = selectedSuggestions.has(idx);
                    return (
                      <div
                        key={idx}
                        onClick={() => toggleSuggestion(idx)}
                        className={`group flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border cursor-pointer select-none transition-all ${
                          selected
                            ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                            : "border-gray-200 dark:border-zinc-800 hover:border-primary/40 hover:bg-gray-50 dark:hover:bg-zinc-900"
                        }`}
                      >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                          selected ? "bg-primary border-primary text-white" : "border-gray-300 dark:border-zinc-600"
                        }`}>
                          {selected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </div>
                        <span className="flex-1 text-sm font-medium truncate">{kw}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); copySingleKeyword(kw, idx); }}
                          className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors opacity-0 group-hover:opacity-100"
                          title="Copy keyword"
                        >
                          {copiedIdx === idx ? (
                            <Check className="w-3.5 h-3.5 text-green-500 stroke-[2.5]" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2.5 pt-1 border-t border-gray-100 dark:border-zinc-800">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedSuggestions.size === 0}
                    onClick={() => addSuggestionsToKeywords(Array.from(selectedSuggestions))}
                    className="gap-1.5"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    Add Selected ({selectedSuggestions.size})
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => addSuggestionsToKeywords(suggestedKeywords.map((_, i) => i))}
                    className="gap-1.5"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    Add All 10
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedSuggestions(
                      selectedSuggestions.size === suggestedKeywords.length
                        ? new Set()
                        : new Set(suggestedKeywords.map((_, i) => i))
                    )}
                    className="text-gray-500 ml-auto"
                  >
                    {selectedSuggestions.size === suggestedKeywords.length ? "Deselect All" : "Select All"}
                  </Button>
                </div>
              </>
            )}

            {/* Empty hint */}
            {!suggestLoading && suggestedKeywords.length === 0 && (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
                Enter a niche above and click <strong>Suggest Keywords</strong> to get 10 AI-generated keyword ideas
              </p>
            )}
          </CardContent>
        </Card>
      </div>

    </Layout>
  );
}
