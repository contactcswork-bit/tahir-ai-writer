import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { 
  LayoutDashboard, 
  Globe, 
  PenTool, 
  History, 
  Link as LinkIcon, 
  AlertCircle, 
  Users, 
  Settings, 
  LogOut,
  Zap,
  Search
} from "lucide-react";
import { Button } from "./ui/button";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/sites", label: "Sites", icon: Globe },
  { href: "/generate", label: "Generate", icon: PenTool },
  { href: "/history", label: "History", icon: History },
  { href: "/article-urls", label: "Article URLs", icon: LinkIcon },
  { href: "/fetch-links", label: "Fetch Links", icon: Search },
  { href: "/failed-articles", label: "Failed Articles", icon: AlertCircle },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const isAdmin = user?.role === "admin";

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-zinc-950 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-white dark:bg-zinc-900 border-r border-gray-200 dark:border-zinc-800 flex flex-col shrink-0">
        <div className="h-16 flex items-center px-4 border-b border-gray-200 dark:border-zinc-800 shrink-0">
          <Link href="/dashboard" className="flex items-center gap-2 font-bold text-base text-primary">
            <div className="w-7 h-7 rounded bg-primary/10 flex items-center justify-center text-primary">
              <Zap className="w-4 h-4 fill-current" />
            </div>
            Tahir AI Writer
          </Link>
        </div>

        <div className="px-2 pt-1 pb-0">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-2 pt-3 pb-1">Navigation</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 flex flex-col gap-0.5 pb-2">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href === "/dashboard" && location === "/");
            return (
              <Link key={item.href} href={item.href}>
                <div className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer",
                  isActive
                    ? "bg-primary text-white" 
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-gray-900 dark:hover:text-gray-100"
                )}>
                  <item.icon className="w-4 h-4 shrink-0" />
                  {item.label}
                </div>
              </Link>
            );
          })}

          {isAdmin && (
            <>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-2 pt-4 pb-1">Admin</p>
              <Link href="/users">
                <div className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer",
                  location === "/users" 
                    ? "bg-primary text-white" 
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-gray-900 dark:hover:text-gray-100"
                )}>
                  <Users className="w-4 h-4 shrink-0" />
                  Users
                </div>
              </Link>
              <Link href="/settings">
                <div className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer",
                  location === "/settings" 
                    ? "bg-primary text-white" 
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-gray-900 dark:hover:text-gray-100"
                )}>
                  <Settings className="w-4 h-4 shrink-0" />
                  Settings
                </div>
              </Link>
            </>
          )}
        </nav>

        <div className="p-3 border-t border-gray-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col overflow-hidden min-w-0">
              <span className="text-xs font-semibold truncate text-gray-800 dark:text-gray-200">{user?.name}</span>
              <span className="text-[11px] text-gray-500 truncate">{user?.email}</span>
              <span className="text-[10px] text-primary font-medium capitalize">{user?.role}</span>
            </div>
            <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => logout()} title="Logout">
              <LogOut className="w-4 h-4 text-gray-500" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 flex items-center justify-between px-6 border-b border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0">
          <h1 className="text-base font-semibold capitalize text-gray-800 dark:text-gray-200">
            {location === "/" || location === "/dashboard" ? "Dashboard" 
              : location.replace("/", "").replace(/-/g, " ")}
          </h1>
          {(location === "/dashboard" || location === "/") && (
            <Link href="/generate">
              <button className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium bg-primary text-white px-4 py-2 hover:bg-primary/90 transition-colors">
                <PenTool className="w-4 h-4 mr-2" />
                Generate Content
              </button>
            </Link>
          )}
        </header>
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
