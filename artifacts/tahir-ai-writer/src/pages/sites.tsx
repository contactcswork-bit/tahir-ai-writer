import { useState, useEffect } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  useListSites,
  useListFolders,
  useToggleSitePin,
  useDeleteSite,
  useTestSite,
  useCreateSite,
  useCreateFolder,
  useBulkAddSites,
} from "@workspace/api-client-react";
import { Search, Plus, FolderPlus, RefreshCw, Pin, Trash2, Loader2, CheckCircle2, XCircle, Link2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Sites() {
  const [search, setSearch] = useState("");
  const [addSiteOpen, setAddSiteOpen] = useState(false);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [autoConnectOpen, setAutoConnectOpen] = useState(false);

  const [newSite, setNewSite] = useState({ name: "", url: "", username: "", applicationPassword: "", folderId: "" });
  const [folderName, setFolderName] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [autoConnectUrl, setAutoConnectUrl] = useState("");
  const [testingAll, setTestingAll] = useState(false);

  const { data: sites = [], refetch: refetchSites } = useListSites();
  const { data: folders = [], refetch: refetchFolders } = useListFolders();

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "wp-auth-success") {
        refetchSites();
        toast({ title: `Site connected`, description: `"${event.data.siteName}" was added successfully.` });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [refetchSites]);

  const togglePin = useToggleSitePin();
  const deleteSite = useDeleteSite();
  const testSite = useTestSite();
  const createSite = useCreateSite();
  const createFolder = useCreateFolder();
  const bulkAddSites = useBulkAddSites();
  const { toast } = useToast();

  const filtered = sites.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.url.toLowerCase().includes(search.toLowerCase())
  );

  const handleTogglePin = async (id: number) => {
    try {
      await togglePin.mutateAsync({ id });
      refetchSites();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete site "${name}"?`)) return;
    try {
      await deleteSite.mutateAsync({ id });
      refetchSites();
      toast({ title: "Site deleted" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleTest = async (id: number) => {
    try {
      const res = await testSite.mutateAsync({ id });
      toast({
        title: res.success ? "Test Successful" : "Test Failed",
        description: res.message,
        variant: res.success ? "default" : "destructive"
      });
      refetchSites();
    } catch (e: any) {
      toast({ title: "Test Error", description: e.message, variant: "destructive" });
    }
  };

  const handleTestAll = async () => {
    setTestingAll(true);
    let success = 0, failed = 0;
    for (const site of sites) {
      try {
        const res = await testSite.mutateAsync({ id: site.id });
        if (res.success) success++; else failed++;
      } catch {
        failed++;
      }
    }
    setTestingAll(false);
    refetchSites();
    toast({ title: `Test All Complete`, description: `${success} connected, ${failed} failed` });
  };

  const handlePinAllRecent = async () => {
    const unpinned = sites.filter(s => !s.isPinned);
    for (const site of unpinned) {
      await togglePin.mutateAsync({ id: site.id });
    }
    refetchSites();
    toast({ title: "All sites pinned" });
  };

  const handleAddSite = async () => {
    if (!newSite.name || !newSite.url || !newSite.username || !newSite.applicationPassword) {
      toast({ title: "Validation", description: "All fields are required", variant: "destructive" });
      return;
    }
    try {
      await createSite.mutateAsync({
        data: {
          name: newSite.name,
          url: newSite.url.replace(/\/$/, ""),
          username: newSite.username,
          applicationPassword: newSite.applicationPassword,
          folderId: newSite.folderId ? parseInt(newSite.folderId) : undefined,
        }
      });
      toast({ title: "Site added successfully!" });
      setNewSite({ name: "", url: "", username: "", applicationPassword: "", folderId: "" });
      setAddSiteOpen(false);
      refetchSites();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleBulkAdd = async () => {
    const lines = bulkText.split("\n").map(l => l.trim()).filter(l => l);
    if (lines.length === 0) {
      toast({ title: "No sites entered", variant: "destructive" });
      return;
    }
    const entries = lines.map(line => {
      const parts = line.split(",").map(p => p.trim());
      return { url: parts[0], username: parts[1] || "", applicationPassword: parts[2] || "" };
    });
    try {
      await bulkAddSites.mutateAsync({ data: { sites: entries } });
      toast({ title: `Added ${entries.length} sites` });
      setBulkText("");
      setBulkAddOpen(false);
      refetchSites();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleCreateFolder = async () => {
    if (!folderName.trim()) {
      toast({ title: "Enter a folder name", variant: "destructive" });
      return;
    }
    try {
      await createFolder.mutateAsync({ data: { name: folderName.trim() } });
      toast({ title: "Folder created" });
      setFolderName("");
      setNewFolderOpen(false);
      refetchFolders();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const openWpAuthTabs = (urls: string[]) => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const successUrl = `${window.location.origin}${base}/wp-auth-callback`;
    const rejectUrl = `${window.location.origin}${base}/sites`;

    const validUrls = urls
      .map(u => u.trim())
      .filter(u => u.length > 0)
      .map(u => (u.startsWith("http") ? u : `https://${u}`).replace(/\/$/, ""));

    for (const siteUrl of validUrls) {
      const params = new URLSearchParams({
        app_name: "Tahir AI Writer",
        success_url: successUrl,
        reject_url: rejectUrl,
      });
      const wpAuthUrl = `${siteUrl}/wp-admin/authorize-application.php?${params.toString()}`;
      window.open(wpAuthUrl, "_blank", "noopener");
    }
  };

  const handleAutoConnect = () => {
    const urls = autoConnectUrl.split("\n").map(u => u.trim()).filter(u => u);
    if (urls.length === 0) {
      toast({ title: "Enter at least one WordPress URL", variant: "destructive" });
      return;
    }
    openWpAuthTabs(urls);
    setAutoConnectOpen(false);
    setAutoConnectUrl("");
    if (urls.length > 1) {
      toast({ title: `Opened ${urls.length} authorization tabs`, description: "Approve each one to connect your sites." });
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between gap-3 items-start sm:items-center">
          <h1 className="text-2xl font-bold">Sites Management</h1>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleTestAll} disabled={testingAll || sites.length === 0}>
              {testingAll ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Test All
            </Button>
            <Button variant="outline" size="sm" onClick={handlePinAllRecent} disabled={sites.length === 0}>
              <Pin className="w-4 h-4 mr-2" /> Pin All
            </Button>
            <Button variant="outline" size="sm" onClick={() => setBulkAddOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> Bulk Add
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAutoConnectOpen(true)}>
              <Link2 className="w-4 h-4 mr-2" /> Auto Connect
            </Button>
            <Button size="sm" onClick={() => setAddSiteOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> Add Site
            </Button>
          </div>
        </div>

        <div className="flex gap-3 items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
            <Input
              placeholder="Search sites..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => setNewFolderOpen(true)}>
            <FolderPlus className="w-4 h-4 mr-2" /> New Folder
          </Button>
          {folders.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {folders.map(f => (
                <Badge key={f.id} variant="outline" className="cursor-pointer text-xs">
                  {f.name}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map(site => (
            <Card key={site.id} className="flex flex-col">
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <div className="space-y-0.5 min-w-0 pr-2">
                  <CardTitle className="text-sm font-semibold truncate" title={site.name}>
                    {site.name}
                  </CardTitle>
                  <CardDescription className="truncate text-xs" title={site.url}>
                    {site.url}
                  </CardDescription>
                </div>
                <Button
                  variant="ghost" size="icon"
                  className={`shrink-0 h-8 w-8 ${site.isPinned ? "text-primary" : "text-gray-300 hover:text-gray-500"}`}
                  onClick={() => handleTogglePin(site.id)}
                  title={site.isPinned ? "Unpin" : "Pin"}
                >
                  <Pin className="w-4 h-4" />
                </Button>
              </CardHeader>
              <CardContent className="flex-1 pb-2">
                <div className="flex items-center justify-between">
                  <Badge
                    className={site.status === "connected" ? "bg-green-500 hover:bg-green-600 text-white text-xs" : "text-xs"}
                    variant={site.status === "connected" ? "default" : "secondary"}
                  >
                    {site.status === "connected" ? (
                      <><CheckCircle2 className="w-3 h-3 mr-1" /> Connected</>
                    ) : (
                      <><XCircle className="w-3 h-3 mr-1" /> {site.status || "Unknown"}</>
                    )}
                  </Badge>
                  {site.category && (
                    <span className="text-gray-400 text-xs">{site.category}</span>
                  )}
                </div>
              </CardContent>
              <CardFooter className="pt-3 border-t border-gray-100 dark:border-zinc-800 flex justify-between">
                <Button variant="ghost" size="sm" onClick={() => handleTest(site.id)} className="text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30">
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Test
                </Button>
                <Button
                  variant="ghost" size="sm"
                  className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                  onClick={() => handleDelete(site.id, site.name)}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
                </Button>
              </CardFooter>
            </Card>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full py-16 text-center text-gray-400 bg-white dark:bg-zinc-900 rounded-lg border-2 border-dashed">
              <Globe2 className="w-10 h-10 mx-auto mb-3 text-gray-300" />
              <p className="font-medium text-gray-500">No sites found</p>
              <p className="text-sm mt-1">Click "Add Site" to connect your first WordPress site.</p>
              <Button className="mt-4" size="sm" onClick={() => setAddSiteOpen(true)}>
                <Plus className="w-4 h-4 mr-2" /> Add Site
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Add Site Dialog */}
      <Dialog open={addSiteOpen} onOpenChange={setAddSiteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add WordPress Site</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Site Name</Label>
              <Input placeholder="My Blog" value={newSite.name} onChange={e => setNewSite({ ...newSite, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>WordPress URL</Label>
              <Input placeholder="https://myblog.com" value={newSite.url} onChange={e => setNewSite({ ...newSite, url: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>WP Username</Label>
              <Input placeholder="admin" value={newSite.username} onChange={e => setNewSite({ ...newSite, username: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Application Password</Label>
              <Input type="password" placeholder="xxxx xxxx xxxx xxxx" value={newSite.applicationPassword} onChange={e => setNewSite({ ...newSite, applicationPassword: e.target.value })} />
              <p className="text-xs text-gray-500">Generate in WP Admin → Users → Profile → Application Passwords</p>
            </div>
            {folders.length > 0 && (
              <div className="space-y-1.5">
                <Label>Folder (optional)</Label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                  value={newSite.folderId}
                  onChange={e => setNewSite({ ...newSite, folderId: e.target.value })}
                >
                  <option value="">No folder</option>
                  {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddSiteOpen(false)}>Cancel</Button>
            <Button onClick={handleAddSite} disabled={createSite.isPending}>
              {createSite.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Add Site
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Add Dialog */}
      <Dialog open={bulkAddOpen} onOpenChange={setBulkAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Bulk Add Sites</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-500">Enter one site per line in the format: <code className="bg-gray-100 dark:bg-zinc-800 px-1 rounded">url, username, app_password</code></p>
            <textarea
              className="w-full h-40 border rounded-md px-3 py-2 text-sm font-mono bg-background resize-none"
              placeholder={"https://site1.com, admin, xxxx xxxx\nhttps://site2.com, admin, yyyy yyyy"}
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkAddOpen(false)}>Cancel</Button>
            <Button onClick={handleBulkAdd} disabled={bulkAddSites.isPending}>
              {bulkAddSites.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Add Sites
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Folder Dialog */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create Folder</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-1.5">
            <Label>Folder Name</Label>
            <Input
              placeholder="e.g. Tech Sites"
              value={folderName}
              onChange={e => setFolderName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleCreateFolder()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateFolder} disabled={createFolder.isPending}>
              {createFolder.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Auto Connect Dialog */}
      <Dialog open={autoConnectOpen} onOpenChange={setAutoConnectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Auto Connect Sites</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md p-3 text-sm text-blue-700 dark:text-blue-300">
              <p className="font-medium mb-1">How it works:</p>
              <ol className="list-decimal list-inside space-y-1 text-xs">
                <li>Enter one or more WordPress URLs (one per line)</li>
                <li>A new tab opens for each site's WordPress admin</li>
                <li>Click <strong>"Yes, I Approve"</strong> in each tab</li>
                <li>Each tab closes and the site is added automatically</li>
              </ol>
            </div>
            <div className="space-y-1.5">
              <Label>
                WordPress URLs
                {autoConnectUrl.split("\n").filter(u => u.trim()).length > 1 && (
                  <span className="ml-2 text-xs text-primary font-normal">
                    ({autoConnectUrl.split("\n").filter(u => u.trim()).length} sites — {autoConnectUrl.split("\n").filter(u => u.trim()).length} tabs will open)
                  </span>
                )}
              </Label>
              <textarea
                className="w-full h-28 border rounded-md px-3 py-2 text-sm bg-background resize-none font-mono"
                placeholder={"https://site1.com\nhttps://site2.com\nhttps://site3.com"}
                value={autoConnectUrl}
                onChange={e => setAutoConnectUrl(e.target.value)}
              />
              <p className="text-xs text-gray-500">Must be logged into each WordPress admin. One URL per line.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAutoConnectOpen(false)}>Cancel</Button>
            <Button onClick={handleAutoConnect}>
              Open Authorization Tab{autoConnectUrl.split("\n").filter(u => u.trim()).length > 1 ? "s" : ""} →
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function Globe2({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  );
}
