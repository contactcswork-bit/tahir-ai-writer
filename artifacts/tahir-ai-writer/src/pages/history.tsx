import { useState } from "react";
import { Layout } from "@/components/layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useListArticles, useDeleteArticle, useRetryArticle } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Search, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/errors";
import { ListArticlesStatus } from "@workspace/api-client-react";

export default function History() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ListArticlesStatus | "all">("all");
  
  const { data, refetch } = useListArticles(
    { status: statusFilter === "all" ? undefined : statusFilter, search: search || undefined, page: 1, limit: 50 }
  );
  
  const deleteMutation = useDeleteArticle();
  const retryMutation = useRetryArticle();
  const { toast } = useToast();

  const articles = data?.articles || [];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "published": return <Badge className="bg-green-500 hover:bg-green-600">Published</Badge>;
      case "draft": return <Badge variant="secondary">Draft</Badge>;
      case "generating": return <Badge className="bg-blue-500 hover:bg-blue-600">Generating</Badge>;
      case "queued": return <Badge variant="outline">Queued</Badge>;
      case "failed": return <Badge variant="destructive">Failed</Badge>;
      case "scheduled": return <Badge className="bg-purple-500 hover:bg-purple-600">Scheduled</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this article?")) return;
    try {
      await deleteMutation.mutateAsync({ id });
      refetch();
      toast({ title: "Article deleted" });
    } catch (e: unknown) {
      toast(toastError(e));
    }
  };

  const handleRetry = async (id: number) => {
    try {
      await retryMutation.mutateAsync({ id });
      refetch();
      toast({ title: "Article retried" });
    } catch (e: unknown) {
      toast(toastError(e));
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center">
          <h1 className="text-2xl font-bold">Article History</h1>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <div className="relative flex-1 w-full max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
            <Input 
              placeholder="Search by keyword..." 
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={(val: any) => setStatusFilter(val)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="generating">Generating</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="bg-white dark:bg-zinc-900 border rounded-md shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 dark:bg-zinc-800/50 text-gray-700 dark:text-gray-300">
                <tr>
                  <th className="px-4 py-3 font-medium">Keyword / Title</th>
                  <th className="px-4 py-3 font-medium">Site</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">URL</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                {articles.map((article) => (
                  <tr key={article.id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{article.keyword}</div>
                      <div className="text-xs text-gray-500 truncate max-w-[200px]">{article.title || "-"}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{article.siteName || "-"}</td>
                    <td className="px-4 py-3">{getStatusBadge(article.status)}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {format(new Date(article.createdAt), "MMM d, yyyy HH:mm")}
                    </td>
                    <td className="px-4 py-3">
                      {article.publishedUrl ? (
                        <a href={article.publishedUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center">
                          Link <ExternalLink className="w-3 h-3 ml-1" />
                        </a>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {(article.status === "failed" || article.status === "draft") && (
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleRetry(article.id)} title="Retry">
                          <RefreshCw className="w-4 h-4 text-blue-500" />
                        </Button>
                      )}
                      <Button variant="outline" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950" onClick={() => handleDelete(article.id)} title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {articles.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      No articles found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}