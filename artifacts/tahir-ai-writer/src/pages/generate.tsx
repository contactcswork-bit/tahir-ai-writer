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
import { Wand2, Loader2, Pin, Globe, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface QueueItem {
  id: number;
  keyword: string;
  status: "queued" | "generating";
  siteName: string | null;
  createdAt: string;
}

export default function Generate() {
  const [keywords, setKeywords] = useState("");
  const [language, setLanguage] = useState("English");
  const [wordCount, setWordCount] = useState("1500");
  const [imageSource, setImageSource] = useState<"pollinations" | "url" | "none">("pollinations");
  const [imageUrl, setImageUrl] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [selectedSites, setSelectedSites] = useState<number[]>([]);
  const [publishNow, setPublishNow] = useState(false);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);

  const { data: sites = [] } = useListSites();
  const generateMutation = useGenerateArticles();
  const { data: status, refetch: refetchStatus } = useGetGenerateStatus();
  const { toast } = useToast();

  const isActive = (status && (status.queueLength > 0 || status.processing > 0)) || queueItems.length > 0;

  const fetchQueue = useCallback(async () => {
    try {
      const res = await apiFetch("/generate/queue");
      if (res.ok) {
        const data = await res.json();
        setQueueItems(data.items || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(() => {
      refetchStatus();
      fetchQueue();
    }, 3000);
    return () => clearInterval(interval);
  }, [refetchStatus, fetchQueue]);

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

  const handleGenerate = async () => {
    if (keywordList.length === 0) {
      toast({ title: "Validation Error", description: "Please enter at least one keyword", variant: "destructive" });
      return;
    }
    if (selectedSites.length === 0) {
      toast({ title: "Validation Error", description: "Please select at least one site", variant: "destructive" });
      return;
    }

    try {
      await generateMutation.mutateAsync({
        data: {
          keywords: keywordList,
          siteIds: selectedSites,
          language,
          wordCount: parseInt(wordCount),
          imageSource,
          imageUrl: imageSource === "url" ? imageUrl : undefined,
          scheduledAt: scheduledAt || undefined,
          publishNow,
        }
      });

      const totalArticles = keywordList.length * selectedSites.length;
      toast({
        title: "Generation started!",
        description: `${totalArticles} article${totalArticles > 1 ? "s" : ""} queued. They will be ${publishNow ? "published" : "saved as drafts"} when ready.`
      });
      setKeywords("");
      refetchStatus();
      setTimeout(fetchQueue, 1000);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const pendingCount = queueItems.filter(i => i.status === "queued").length;
  const processingCount = queueItems.filter(i => i.status === "generating").length;

  return (
    <Layout>
      <div className="flex flex-col lg:flex-row gap-6">

        {/* Left Panel: Settings */}
        <div className="w-full lg:w-1/3 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Article Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Keywords / Topics (one per line)</Label>
                <Textarea
                  rows={8}
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder={"best laptops 2025\nhow to lose weight\nai tools for business"}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-gray-500">{keywordList.length} keyword{keywordList.length !== 1 ? "s" : ""} entered</p>
              </div>

              <div className="space-y-2">
                <Label>Language</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="English">English</SelectItem>
                    <SelectItem value="German">German</SelectItem>
                    <SelectItem value="French">French</SelectItem>
                    <SelectItem value="Italian">Italian</SelectItem>
                    <SelectItem value="Russian">Russian</SelectItem>
                    <SelectItem value="Spanish">Spanish</SelectItem>
                    <SelectItem value="Turkish">Turkish</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Word Count</Label>
                <Select value={wordCount} onValueChange={setWordCount}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="800">800 Words</SelectItem>
                    <SelectItem value="1200">1200 Words</SelectItem>
                    <SelectItem value="1500">1500 Words</SelectItem>
                    <SelectItem value="2000">2000 Words</SelectItem>
                    <SelectItem value="2500">2500 Words</SelectItem>
                    <SelectItem value="3000">3000 Words</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Image Source</Label>
                <Select value={imageSource} onValueChange={(val: any) => setImageSource(val)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pollinations">Pollinations AI</SelectItem>
                    <SelectItem value="url">Custom URL</SelectItem>
                    <SelectItem value="none">None</SelectItem>
                  </SelectContent>
                </Select>
                {imageSource === "url" && (
                  <Input
                    placeholder="https://example.com/image.jpg"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    className="mt-2"
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label>Schedule (Optional)</Label>
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </div>

              {/* Publish toggle */}
              <div className="flex items-center justify-between py-2 border-t border-gray-100 dark:border-zinc-800">
                <div>
                  <p className="text-sm font-medium">Auto Publish</p>
                  <p className="text-xs text-gray-500">
                    {publishNow ? "Articles will be published directly" : "Articles will be saved as drafts"}
                  </p>
                </div>
                <Switch
                  checked={publishNow}
                  onCheckedChange={setPublishNow}
                />
              </div>

            </CardContent>
          </Card>
        </div>

        {/* Right Panel: Sites + Queue */}
        <div className="w-full lg:w-2/3 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-gray-100 dark:border-zinc-800">
              <CardTitle className="text-xl">Generate</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-6">

              {/* Stats + Generate button */}
              <div className="flex flex-col sm:flex-row justify-between gap-4 items-center bg-gray-50 dark:bg-zinc-900 p-4 rounded-lg border border-gray-100 dark:border-zinc-800">
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <div className="text-2xl font-bold">{keywordList.length}</div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider">Keywords</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">{selectedSites.length}</div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider">Sites</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-primary">{keywordList.length * selectedSites.length}</div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider">Total Articles</div>
                  </div>
                </div>

                <Button
                  size="lg"
                  onClick={handleGenerate}
                  disabled={generateMutation.isPending}
                  className="w-full sm:w-auto font-semibold"
                  variant={publishNow ? "default" : "outline"}
                >
                  {generateMutation.isPending
                    ? <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    : <Wand2 className="w-5 h-5 mr-2" />
                  }
                  {publishNow ? "Generate & Publish" : "Generate Drafts"}
                </Button>
              </div>

              {/* Active Queue Panel */}
              {queueItems.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm">Generation Queue</h3>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      {processingCount > 0 && (
                        <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          {processingCount} processing
                        </span>
                      )}
                      {pendingCount > 0 && (
                        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                          <Clock className="w-3 h-3" />
                          {pendingCount} pending
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="border rounded-lg overflow-hidden divide-y divide-gray-100 dark:divide-zinc-800 max-h-72 overflow-y-auto">
                    {queueItems.map(item => (
                      <div key={item.id} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-zinc-950">
                        <div className="shrink-0">
                          {item.status === "generating" ? (
                            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                          ) : (
                            <Clock className="w-4 h-4 text-amber-500" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.keyword}</p>
                          {item.siteName && (
                            <p className="text-xs text-gray-500 truncate flex items-center gap-1">
                              <Globe className="w-3 h-3" />
                              {item.siteName}
                            </p>
                          )}
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                          item.status === "generating"
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        }`}>
                          {item.status === "generating" ? "Generating" : "Queued"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Site selection */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm">Select Target Sites</h3>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handlePinAll}>
                      <Pin className="w-4 h-4 mr-2" /> Pinned
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleSelectAll}>
                      {selectedSites.length === sites.length && sites.length > 0 ? "Deselect All" : "Select All"}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                  {sites.map(site => (
                    <div
                      key={site.id}
                      onClick={() => toggleSite(site.id)}
                      className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-all ${
                        selectedSites.includes(site.id)
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                          : 'border-gray-200 dark:border-zinc-800 hover:border-primary/50'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                        selectedSites.includes(site.id) ? 'bg-primary border-primary text-white' : 'border-gray-300'
                      }`}>
                        {selectedSites.includes(site.id) && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3 h-3">
                            <polyline points="20 6 9 17 4 12"></polyline>
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
                    <div className="col-span-full py-8 text-center text-gray-500 text-sm">
                      No connected sites found. Add a site first.
                    </div>
                  )}
                </div>
              </div>

            </CardContent>
          </Card>
        </div>

      </div>
    </Layout>
  );
}
