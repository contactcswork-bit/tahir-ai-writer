import { useState, useEffect } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useGetDashboardStats, useGetDashboardSitesOverview } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import {
  Globe, CheckCircle2, FileText, Clock, Plus,
  Zap, TrendingUp, BarChart3, ChevronDown, ChevronUp,
  Hash, Brain, MessageSquare
} from "lucide-react";
import { Link } from "wouter";

interface UsageSummary {
  totalArticles: number;
  totalTokens: number;
  avgTokensPerArticle: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
}

interface UsageArticle {
  id: number;
  keyword: string;
  status: string;
  wordCount: number;
  tokensPrompt: number;
  tokensCompletion: number;
  tokensTotal: number;
  createdAt: string;
  userId: number;
}

interface DailyTotal {
  date: string;
  articles: number;
  tokens: number;
}

interface UsageData {
  summary: UsageSummary;
  todayArticles: UsageArticle[];
  dailyTotals: DailyTotal[];
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function statusColor(s: string) {
  switch (s) {
    case "published": return "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400";
    case "draft": return "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400";
    case "failed": return "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400";
    case "generating": return "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400";
    case "queued": return "bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-gray-300";
    case "scheduled": return "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400";
    default: return "bg-gray-100 text-gray-600";
  }
}

function AdminUsagePanel() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    apiFetch("/dashboard/usage")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setUsage(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const maxTokens = Math.max(...(usage?.dailyTotals.map(d => d.tokens) || [1]), 1);

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary fill-primary" />
          Daily Usage
          <span className="text-sm font-normal text-gray-400 ml-1">Admin Only</span>
        </h2>
        <span className="text-xs text-gray-400">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</span>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-gray-500">Total Credits Today</CardTitle>
            <Zap className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">
              {loading ? "—" : fmt(usage?.summary.totalTokens || 0)}
            </div>
            <p className="text-xs text-gray-400 mt-1">tokens consumed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-gray-500">Avg per Article</CardTitle>
            <TrendingUp className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? "—" : fmt(usage?.summary.avgTokensPerArticle || 0)}
            </div>
            <p className="text-xs text-gray-400 mt-1">tokens / article</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-gray-500">Prompt Tokens</CardTitle>
            <Brain className="w-4 h-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? "—" : fmt(usage?.summary.totalPromptTokens || 0)}
            </div>
            <p className="text-xs text-gray-400 mt-1">input today</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-gray-500">Output Tokens</CardTitle>
            <MessageSquare className="w-4 h-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? "—" : fmt(usage?.summary.totalCompletionTokens || 0)}
            </div>
            <p className="text-xs text-gray-400 mt-1">generated today</p>
          </CardContent>
        </Card>
      </div>

      {/* 7-day bar chart */}
      {!loading && usage && usage.dailyTotals.length > 0 && (
        <Card>
          <CardHeader className="pb-3 border-b border-gray-100 dark:border-zinc-800">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-gray-500" />
              7-Day Token Trend
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="flex items-end gap-2 h-24">
              {usage.dailyTotals.map((d) => {
                const pct = Math.max((d.tokens / maxTokens) * 100, 4);
                const dateLabel = new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
                      {fmt(d.tokens)} tokens · {d.articles} article{d.articles !== 1 ? "s" : ""}
                    </div>
                    <div
                      className="w-full bg-primary/80 hover:bg-primary rounded-t-sm transition-all cursor-default"
                      style={{ height: `${pct}%` }}
                    />
                    <span className="text-[10px] text-gray-400 truncate max-w-full">{dateLabel.split(",")[0]}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Today's articles table */}
      {!loading && usage && usage.todayArticles.length > 0 && (
        <Card>
          <CardHeader className="pb-3 border-b border-gray-100 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Hash className="w-4 h-4 text-gray-500" />
                Today's Articles — Credit Breakdown
                <span className="ml-1 text-xs font-normal bg-gray-100 dark:bg-zinc-800 text-gray-500 px-2 py-0.5 rounded">
                  {usage.todayArticles.length} total
                </span>
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => setExpanded(e => !e)}
              >
                {expanded ? <><ChevronUp className="w-3.5 h-3.5" /> Collapse</> : <><ChevronDown className="w-3.5 h-3.5" /> Expand</>}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {/* Always show first 5 rows */}
            <div className="divide-y divide-gray-100 dark:divide-zinc-800">
              {(expanded ? usage.todayArticles : usage.todayArticles.slice(0, 5)).map(a => (
                <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-zinc-800/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{a.keyword}</p>
                    <p className="text-[11px] text-gray-400">
                      {a.wordCount > 0 ? `${a.wordCount.toLocaleString()} words` : "—"}
                      {" · "}
                      {new Date(a.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-right">
                    {a.tokensTotal > 0 ? (
                      <div>
                        <div className="text-sm font-semibold text-primary">{fmt(a.tokensTotal)}</div>
                        <div className="text-[10px] text-gray-400">
                          {fmt(a.tokensPrompt)}↑ {fmt(a.tokensCompletion)}↓
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">no data</span>
                    )}
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${statusColor(a.status)}`}>
                      {a.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {!expanded && usage.todayArticles.length > 5 && (
              <div className="px-4 py-2.5 text-center">
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setExpanded(true)}>
                  Show {usage.todayArticles.length - 5} more articles
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!loading && (!usage || usage.summary.totalArticles === 0) && (
        <div className="py-8 text-center text-sm text-gray-400 border border-dashed rounded-lg dark:border-zinc-700">
          No articles generated today yet. Usage data appears here after the first article completes.
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { data: stats } = useGetDashboardStats();
  const { data: sitesOverview } = useGetDashboardSitesOverview();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return (
    <Layout>
      <div className="space-y-8">

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Total Sites</CardTitle>
              <Globe className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalSites || 0}</div>
              <p className="text-xs text-gray-500 mt-1">{stats?.connectedSites || 0} connected</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Published Today</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.publishedToday || 0}</div>
              <p className="text-xs text-gray-500 mt-1">{stats?.totalPublished || 0} total</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Drafts Today</CardTitle>
              <FileText className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.draftsToday || 0}</div>
              <p className="text-xs text-gray-500 mt-1">{stats?.totalDrafts || 0} total</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Failed Today</CardTitle>
              <Clock className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.failedToday || 0}</div>
              <p className="text-xs text-gray-500 mt-1">{stats?.totalFailed || 0} total</p>
            </CardContent>
          </Card>
        </div>

        {/* Admin: Daily Usage Panel */}
        {isAdmin && <AdminUsagePanel />}

        {/* Sites Overview */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Sites Overview</h2>
          <Link href="/sites">
            <Button variant="outline" size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Add Site
            </Button>
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sitesOverview?.sites?.map((site) => (
            <Card key={site.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base font-medium truncate pr-4" title={site.name}>{site.name}</CardTitle>
                <Badge
                  variant={site.status === "connected" ? "default" : "secondary"}
                  className={site.status === "connected" ? "bg-green-500 hover:bg-green-600" : ""}
                >
                  {site.status}
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-gray-500 truncate mb-4" title={site.url}>{site.url}</div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Published</span>
                  <span className="font-medium">{site.articlesPublished}</span>
                </div>
              </CardContent>
            </Card>
          ))}
          {(!sitesOverview?.sites || sitesOverview.sites.length === 0) && (
            <div className="col-span-full py-12 text-center text-gray-500 bg-white dark:bg-zinc-900 rounded-lg border border-dashed">
              No sites added yet. Click "Add Site" to get started.
            </div>
          )}
        </div>

      </div>
    </Layout>
  );
}
