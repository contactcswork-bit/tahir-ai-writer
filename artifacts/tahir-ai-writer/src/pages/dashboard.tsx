import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useGetDashboardStats, useGetDashboardSitesOverview } from "@workspace/api-client-react";
import { Globe, CheckCircle2, FileText, Clock, Plus } from "lucide-react";
import { Link } from "wouter";

export default function Dashboard() {
  const { data: stats } = useGetDashboardStats();
  const { data: sitesOverview } = useGetDashboardSitesOverview();

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
              <p className="text-xs text-gray-500 mt-1">
                {stats?.connectedSites || 0} connected
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Published Today</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.publishedToday || 0}</div>
              <p className="text-xs text-gray-500 mt-1">
                {stats?.totalPublished || 0} total
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Drafts Today</CardTitle>
              <FileText className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.draftsToday || 0}</div>
              <p className="text-xs text-gray-500 mt-1">
                {stats?.totalDrafts || 0} total
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Failed Today</CardTitle>
              <Clock className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.failedToday || 0}</div>
              <p className="text-xs text-gray-500 mt-1">
                {stats?.totalFailed || 0} total
              </p>
            </CardContent>
          </Card>
        </div>

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
                <Badge variant={site.status === "connected" ? "default" : "secondary"} className={site.status === "connected" ? "bg-green-500 hover:bg-green-600" : ""}>
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