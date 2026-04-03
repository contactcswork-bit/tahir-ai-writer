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
  Loader2, Pin, Globe, Clock, Send
} from "lucide-react";
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
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [selectedSites, setSelectedSites] = useState<number[]>([]);
  const [publishNow, setPublishNow] = useState(false);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);

  const { data: sites = [] } = useListSites();
  const generateMutation = useGenerateArticles();
  const { data: status, refetch: refetchStatus } = useGetGenerateStatus();
  const { toast } = useToast();

  const fetchQueue = useCallback(async () => {
    try {
      const res = await apiFetch("/generate/queue");
      if (res.ok) {
        const data = await res.json();
        setQueueItems(data.items || []);
      }
    } catch {
      // Non-critical
    }
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

  const handleScheduleToggle = (val: boolean) => {
    setScheduleEnabled(val);
    if (!val) setScheduledAt("");
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
          scheduledAt: scheduleEnabled && scheduledAt ? scheduledAt : undefined,
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
    } catch (e: unknown) {
      toast(toastError(e));
    }
  };

  const pendingCount = queueItems.filter(i => i.status === "queued").length;
  const processingCount = queueItems.filter(i => i.status === "generating").length;
  const imageEnabled = imageSource !== "none";

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
              <CardTitle className="text-lg">Article Settings</CardTitle>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 font-normal">
                Configure your content generation
              </p>
            </CardHeader>

            <CardContent className="pt-5 space-y-5">

              {/* Keywords textarea */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm font-medium">
                  <List className="w-4 h-4 text-gray-500" />
                  Keywords / Topics * <span className="font-normal text-gray-400">(one per line)</span>
                </Label>
                <Textarea
                  rows={5}
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder={"best laptops 2026\nhealthy breakfast recipes\ndigital marketing tips\nhome workout routine"}
                  className="font-mono text-sm resize-y bg-white dark:bg-zinc-950"
                />
                <p className="text-xs text-gray-400">
                  Enter one keyword per line • Each keyword will generate unique articles for all selected sites
                </p>
              </div>

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

              {keywordList.length > 0 && selectedSites.length > 0 && (
                <p className="text-xs text-center text-gray-400">
                  {keywordList.length * selectedSites.length} total article{keywordList.length * selectedSites.length !== 1 ? "s" : ""} will be queued
                </p>
              )}
            </CardContent>
          </Card>

          {/* Queue panel */}
          {queueItems.length > 0 && (
            <Card className="shadow-sm">
              <CardHeader className="pb-2 border-b border-gray-100 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Queue</CardTitle>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    {processingCount > 0 && (
                      <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {processingCount}
                      </span>
                    )}
                    {pendingCount > 0 && (
                      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                        <Clock className="w-3 h-3" />
                        {pendingCount}
                      </span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-gray-100 dark:divide-zinc-800 max-h-60 overflow-y-auto">
                  {queueItems.map(item => (
                    <div key={item.id} className="flex items-center gap-2.5 px-3 py-2.5">
                      {item.status === "generating" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 shrink-0" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{item.keyword}</p>
                        {item.siteName && (
                          <p className="text-[10px] text-gray-400 truncate">{item.siteName}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

      </div>
    </Layout>
  );
}
