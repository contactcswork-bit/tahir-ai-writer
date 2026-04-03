import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useGetTodayArticleUrls } from "@workspace/api-client-react";
import { Copy, RefreshCw, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ArticleUrls() {
  const { data: sites = [], refetch, isFetching } = useGetTodayArticleUrls();
  const { toast } = useToast();

  const handleCopyAll = () => {
    let text = "";
    sites.forEach(site => {
      text += `\n=== ${site.siteName} ===\n`;
      site.articles.forEach(article => {
        text += `${article.title}\n${article.url}\n\n`;
      });
    });

    navigator.clipboard.writeText(text.trim());
    toast({ title: "Copied to clipboard" });
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center">
          <h1 className="text-2xl font-bold">Today's Published URLs</h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> 
              Refresh
            </Button>
            <Button size="sm" onClick={handleCopyAll}>
              <Copy className="w-4 h-4 mr-2" /> 
              Copy All
            </Button>
          </div>
        </div>

        <div className="grid gap-6">
          {sites.map(site => (
            <Card key={site.siteName}>
              <CardHeader className="bg-gray-50/50 dark:bg-zinc-900/50 border-b pb-4">
                <CardTitle className="text-lg flex items-center justify-between">
                  <span>{site.siteName}</span>
                  <span className="text-sm font-normal text-gray-500 bg-gray-100 dark:bg-zinc-800 px-2 py-1 rounded">
                    {site.articles.length} articles
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-gray-100 dark:divide-zinc-800">
                  {site.articles.map(article => (
                    <div key={article.id} className="p-4 hover:bg-gray-50 dark:hover:bg-zinc-800/30 transition-colors">
                      <div className="font-medium mb-1 text-gray-900 dark:text-gray-100">{article.title}</div>
                      <a href={article.url} target="_blank" rel="noreferrer" className="text-primary hover:underline text-sm flex items-center gap-1">
                        {article.url}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
          
          {sites.length === 0 && !isFetching && (
            <div className="py-12 text-center text-gray-500 bg-white dark:bg-zinc-900 rounded-lg border border-dashed">
              No articles published today.
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}