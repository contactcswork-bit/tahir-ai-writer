import { useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ErrorBoundary } from "@/components/error-boundary";

import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Sites from "@/pages/sites";
import Generate from "@/pages/generate";
import History from "@/pages/history";
import ArticleUrls from "@/pages/article-urls";
import FailedArticles from "@/pages/failed-articles";
import Users from "@/pages/users";
import Settings from "@/pages/settings";
import WpAuthCallback from "@/pages/wp-auth-callback";
import FetchLinks from "@/pages/fetch-links";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ component: Component, adminOnly = false }: { component: any, adminOnly?: boolean }) {
  const { user, isLoading } = useAuth();
  
  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }
  
  if (!user) {
    window.location.href = "/login";
    return null;
  }
  
  if (adminOnly && user.role !== "admin") {
    return <div className="min-h-screen flex items-center justify-center">Unauthorized</div>;
  }
  
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/wp-auth-callback" component={WpAuthCallback} />
      <Route path="/">
        {() => <ProtectedRoute component={Dashboard} />}
      </Route>
      <Route path="/dashboard">
        {() => <ProtectedRoute component={Dashboard} />}
      </Route>
      <Route path="/sites">
        {() => <ProtectedRoute component={Sites} />}
      </Route>
      <Route path="/generate">
        {() => <ProtectedRoute component={Generate} />}
      </Route>
      <Route path="/history">
        {() => <ProtectedRoute component={History} />}
      </Route>
      <Route path="/article-urls">
        {() => <ProtectedRoute component={ArticleUrls} />}
      </Route>
      <Route path="/fetch-links">
        {() => <ProtectedRoute component={FetchLinks} />}
      </Route>
      <Route path="/failed-articles">
        {() => <ProtectedRoute component={FailedArticles} />}
      </Route>
      <Route path="/users">
        {() => <ProtectedRoute component={Users} adminOnly />}
      </Route>
      <Route path="/settings">
        {() => <ProtectedRoute component={Settings} adminOnly />}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthProvider>
              <Router />
            </AuthProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
