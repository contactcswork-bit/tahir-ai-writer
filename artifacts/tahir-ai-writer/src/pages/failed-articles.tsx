import { useState } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useListArticles, useRetryArticle } from "@workspace/api-client-react";
import { format } from "date-fns";
import { RefreshCw, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";

export default function FailedArticles() {
  const { data, refetch } = useListArticles(
    { status: "failed", page: 1, limit: 100 }
  );

  const retryMutation = useRetryArticle();
  const { toast } = useToast();

  const articles = (data?.articles || []).filter((a) => a.status === "failed");

  const handleRetry = async (id: number) => {
    try {
      await retryMutation.mutateAsync({ id });
      refetch();
      toast({ title: "Article retried" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleRetryAll = async () => {
    if (!confirm("Are you sure you want to retry all failed articles?")) return;
    try {
      for (const article of articles) {
        await retryMutation.mutateAsync({ id: article.id });
      }
      refetch();
      toast({ title: "All articles queued for retry" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Failed Articles</h1>
            <span className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 py-1 px-2.5 rounded-full text-xs font-semibold">
              {articles.length} Failed
            </span>
          </div>
          {articles.length > 0 && (
            <Button onClick={handleRetryAll} size="sm">
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry All Failed
            </Button>
          )}
        </div>

        <div className="grid gap-4">
          {articles.map((article) => (
            <Card key={article.id} className="border-red-100 dark:border-red-900/20 overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-red-500"></div>
              <CardContent className="p-4 pl-5">
                <div className="flex flex-col md:flex-row gap-4 justify-between md:items-center">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-lg">{article.keyword}</span>
                      <span className="text-sm text-gray-500">on {article.siteName || "Unknown Site"}</span>
                    </div>
                    {article.errorMessage && (
                      <div className="flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400 mt-1">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{article.errorMessage}</span>
                      </div>
                    )}
                    <div className="text-xs text-gray-400 mt-2">
                      Failed at: {format(new Date(article.createdAt), "MMM d, yyyy HH:mm")}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <Button variant="outline" onClick={() => handleRetry(article.id)}>
                      <RefreshCw className="w-4 h-4 mr-2 text-blue-500" />
                      Retry Generation
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {articles.length === 0 && (
            <div className="py-16 text-center">
              <div className="w-16 h-16 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-medium">No failed articles</h3>
              <p className="text-gray-500 mt-1">All your article generations are running smoothly.</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}