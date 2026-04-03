import { useState, useEffect } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/errors";
import { Save, Plus, Trash2 } from "lucide-react";

export default function Settings() {
  const { data: settings, refetch } = useGetSettings();
  const updateMutation = useUpdateSettings();
  const { toast } = useToast();

  const [formData, setFormData] = useState<any>({
    longcatApiKey: "",
    longcatModel: "LongCat-Flash-Chat",
    pollinationsEnabled: false,
    defaultLanguage: "English",
    defaultWordCount: 800,
    concurrentGenerations: 5,
    customApis: [],
  });

  useEffect(() => {
    if (settings) {
      setFormData(settings);
    }
  }, [settings]);

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({ data: formData });
      toast({ title: "Settings saved successfully" });
      refetch();
    } catch (e: unknown) {
      toast(toastError(e));
    }
  };

  const updateField = (field: string, value: any) => {
    setFormData({ ...formData, [field]: value });
  };

  if (!settings) return <Layout><div className="p-8">Loading...</div></Layout>;

  return (
    <Layout>
      <div className="space-y-6 max-w-4xl">
        <div className="flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center">
          <h1 className="text-2xl font-bold">Platform Settings</h1>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            <Save className="w-4 h-4 mr-2" />
            Save Changes
          </Button>
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>API Settings</CardTitle>
              <CardDescription>Configure the primary AI models and API keys.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>LongCat API Key</Label>
                <Input 
                  type="password" 
                  value={formData.longcatApiKey || ""} 
                  onChange={(e) => updateField("longcatApiKey", e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label>LongCat Model</Label>
                <Select value={formData.longcatModel} onValueChange={(v) => updateField("longcatModel", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LongCat-Flash-Chat">LongCat-Flash-Chat</SelectItem>
                    <SelectItem value="LongCat-Flash-Thinking-2601">LongCat-Flash-Thinking-2601</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between pt-2">
                <div className="space-y-0.5">
                  <Label>Pollinations AI (Images)</Label>
                  <div className="text-sm text-gray-500">Enable AI image generation for articles</div>
                </div>
                <Switch 
                  checked={!!formData.pollinationsEnabled} 
                  onCheckedChange={(v) => updateField("pollinationsEnabled", v)} 
                />
              </div>
              {formData.pollinationsEnabled && (
                <div className="space-y-2">
                  <Label>Pollinations API Key</Label>
                  <Input
                    type="password"
                    placeholder="sk_..."
                    value={formData.pollinationsApiKey || ""}
                    onChange={(e) => updateField("pollinationsApiKey", e.target.value)}
                  />
                  <div className="text-xs text-gray-500">
                    From <a href="https://enter.pollinations.ai/" target="_blank" rel="noreferrer" className="text-primary underline">enter.pollinations.ai</a> — enables watermark removal, higher rate limits, and private images.
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Generation Defaults</CardTitle>
              <CardDescription>Default settings for new article generations.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Default Language</Label>
                  <Select value={formData.defaultLanguage} onValueChange={(v) => updateField("defaultLanguage", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="English">English</SelectItem>
                      <SelectItem value="German">German</SelectItem>
                      <SelectItem value="French">French</SelectItem>
                      <SelectItem value="Spanish">Spanish</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Default Word Count</Label>
                  <Select value={String(formData.defaultWordCount)} onValueChange={(v) => updateField("defaultWordCount", parseInt(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="500">500</SelectItem>
                      <SelectItem value="800">800</SelectItem>
                      <SelectItem value="1200">1200</SelectItem>
                      <SelectItem value="2000">2000</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Concurrent Generations</Label>
                  <Input 
                    type="number" 
                    min={1} 
                    max={20} 
                    value={formData.concurrentGenerations || 1} 
                    onChange={(e) => updateField("concurrentGenerations", parseInt(e.target.value))} 
                  />
                  <div className="text-xs text-gray-500">How many articles to generate at once</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Custom APIs</CardTitle>
                  <CardDescription>Add your own custom endpoints for generation.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => {
                  const apis = [...(formData.customApis || []), { id: Date.now().toString(), name: "New API", baseUrl: "", apiKey: "", isDefault: false }];
                  updateField("customApis", apis);
                }}>
                  <Plus className="w-4 h-4 mr-2" /> Add API
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {formData.customApis?.map((api: any, i: number) => (
                <div key={api.id} className="grid sm:grid-cols-12 gap-4 items-start border p-4 rounded-md relative group">
                  <div className="sm:col-span-3 space-y-2">
                    <Label>Name</Label>
                    <Input 
                      value={api.name} 
                      onChange={(e) => {
                        const apis = [...formData.customApis];
                        apis[i].name = e.target.value;
                        updateField("customApis", apis);
                      }} 
                    />
                  </div>
                  <div className="sm:col-span-4 space-y-2">
                    <Label>Base URL</Label>
                    <Input 
                      value={api.baseUrl} 
                      onChange={(e) => {
                        const apis = [...formData.customApis];
                        apis[i].baseUrl = e.target.value;
                        updateField("customApis", apis);
                      }} 
                    />
                  </div>
                  <div className="sm:col-span-4 space-y-2">
                    <Label>API Key</Label>
                    <Input 
                      type="password"
                      value={api.apiKey} 
                      onChange={(e) => {
                        const apis = [...formData.customApis];
                        apis[i].apiKey = e.target.value;
                        updateField("customApis", apis);
                      }} 
                    />
                  </div>
                  <div className="sm:col-span-1 pt-8 flex justify-end">
                    <Button variant="ghost" size="icon" className="text-red-500" onClick={() => {
                      const apis = formData.customApis.filter((_: any, idx: number) => idx !== i);
                      updateField("customApis", apis);
                    }}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {(!formData.customApis || formData.customApis.length === 0) && (
                <div className="text-center text-gray-500 py-4 text-sm">No custom APIs configured.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}