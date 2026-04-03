import { useState } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useListArticles, useRetryArticle } from "@workspace/api-client-react";
import { format } from "date-fns";
import { RefreshCw, AlertCircle, XCircle, Loader2, Ban } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

export default function FailedArticles() {
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [bulkCancelling, setBulkCancelling] = useState(false);
  const queryClient = useQueryClient();

  const { data: failedData, refetch: refetchFailed } = useListArticles(
    { status: "failed", page: 1, limit: 100 }
  );
  const { data: generatingData, refetch: refetchGenerating } = useListArticles(
    { status: "generating", page: 1, limit: 100 }
  );
  const { data: queuedData, refetch: refetchQueued } = useListArticles(
    { status: "queued", page: 1, limit: 100 }
  );

  const retryMutation = useRetryArticle();
  const { toast } = useToast();

  const failedArticles = (failedData?.articles || []).filter((a) => a.status === "failed");
  const stuckArticles = [
    ...(generatingData?.articles || []).filter((a) => a.status === "generating"),
    ...(queuedData?.articles || []).filter((a) => a.status === "queued"),
  ];

  const refetchAll = () => {
    refetchFailed();
    refetchGenerating();
    refetchQueued();
    queryClient.invalidateQueries();
  };

  const handleRetry = async (id: number) => {
    try {
      await retryMutation.mutateAsync({ id });
      refetchAll();
      toast({ title: "Article queued for retry" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleRetryAll = async () => {
    if (!confirm("Retry all failed articles?")) return;
    try {
      for (const article of failedArticles) {
        await retryMutation.mutateAsync({ id: article.id });
      }
      refetchAll();
      toast({ title: `${failedArticles.length} articles queued for retry` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleCancel = async (id: number) => {
    setCancellingId(id);
    try {
      const res = await apiFetch(`/articles/${id}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error("Cancel failed");
      refetchAll();
      toast({ title: "Article cancelled" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setCancellingId(null);
    }
  };

  const handleBulkCancel = async () => {
    if (!confirm(`Cancel all ${stuckArticles.length} stuck articles?`)) return;
    setBulkCancelling(true);
    try {
      const ids = stuckArticles.map((a) => a.id);
      const res = await apiFetch("/articles/bulk-cancel", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Bulk cancel failed");
      const json = await res.json();
      refetchAll();
      toast({ title: `${json.cancelled} articles cancelled` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBulkCancelling(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-8">

        {/* Stuck Articles Section */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between gap-3 items-start sm:items-center">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold">Stuck / In Progress</h2>
              <span className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 py-1 px-2.5 rounded-full text-xs font-semibold">
                {stuckArticles.length}
              </span>
            </div>
            {stuckArticles.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkCancel}
                disabled={bulkCancelling}
              >
                {bulkCancelling ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Ban className="w-4 h-4 mr-2" />
                )}
                Cancel All Stuck ({stuckArticles.length})
              </Button>
            )}
          </div>

          {stuckArticles.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No articles are currently stuck.</p>
          ) : (
            <div className="grid gap-3">
              {stuckArticles.map((article) => (
                <Card key={article.id} className="border-yellow-100 dark:border-yellow-900/20 overflow-hidden relative">
                  <div className="absolute top-0 left-0 w-1 h-full bg-yellow-400" />
                  <CardContent className="p-4 pl-5">
                    <div className="flex flex-col md:flex-row gap-3 justify-between md:items-center">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Loader2 className="w-4 h-4 text-yellow-500 animate-spin shrink-0" />
                          <span className="font-semibold">{article.keyword}</span>
                          <span className="text-sm text-gray-500">on {article.siteName || "Unknown Site"}</span>
                          <span className="text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 px-2 py-0.5 rounded-full capitalize">
                            {article.status}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400">
                          Started: {format(new Date(article.createdAt), "MMM d, yyyy HH:mm")}
                        </div>
                      </div>
                      <div className="shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCancel(article.id)}
                          disabled={cancellingId === article.id}
                          className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950"
                        >
                          {cancellingId === article.id ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <XCircle className="w-4 h-4 mr-2" />
                          )}
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Failed Articles Section */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between gap-3 items-start sm:items-center">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold">Failed Articles</h2>
              <span className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 py-1 px-2.5 rounded-full text-xs font-semibold">
                {failedArticles.length}
              </span>
            </div>
            {failedArticles.length > 0 && (
              <Button size="sm" onClick={handleRetryAll}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry All Failed ({failedArticles.length})
              </Button>
            )}
          </div>

          {failedArticles.length === 0 ? (
            <div className="py-10 text-center">
              <div className="w-14 h-14 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto mb-3">
                <AlertCircle className="w-7 h-7" />
              </div>
              <h3 className="text-base font-medium">No failed articles</h3>
              <p className="text-gray-500 text-sm mt-1">All your article generations are running smoothly.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {failedArticles.map((article) => (
                <Card key={article.id} className="border-red-100 dark:border-red-900/20 overflow-hidden relative">
                  <div className="absolute top-0 left-0 w-1 h-full bg-red-500" />
                  <CardContent className="p-4 pl-5">
                    <div className="flex flex-col md:flex-row gap-3 justify-between md:items-center">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{article.keyword}</span>
                          <span className="text-sm text-gray-500">on {article.siteName || "Unknown Site"}</span>
                        </div>
                        {article.errorMessage && (
                          <div className="flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400 mt-1">
                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                            <span>{article.errorMessage}</span>
                          </div>
                        )}
                        <div className="text-xs text-gray-400 mt-1">
                          Failed at: {format(new Date(article.createdAt), "MMM d, yyyy HH:mm")}
                        </div>
                      </div>
                      <div className="shrink-0">
                        <Button variant="outline" size="sm" onClick={() => handleRetry(article.id)}>
                          <RefreshCw className="w-4 h-4 mr-2 text-blue-500" />
                          Retry
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

      </div>
    </Layout>
  );
}
