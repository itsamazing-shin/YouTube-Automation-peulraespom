import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import CreateVideo from "@/pages/create-video";
import ProjectDetail from "@/pages/project-detail";
import Settings from "@/pages/settings";
import { LayoutDashboard, PlusCircle, Settings as SettingsIcon, Youtube } from "lucide-react";
import { cn } from "@/lib/utils";

const queryClient = new QueryClient();

function Sidebar() {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "대시보드", icon: LayoutDashboard },
    { href: "/create", label: "새 영상", icon: PlusCircle },
    { href: "/settings", label: "설정", icon: SettingsIcon },
  ];

  return (
    <aside className="w-60 bg-sidebar border-r border-sidebar-border flex flex-col h-screen fixed left-0 top-0">
      <div className="p-5 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <Youtube className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-bold text-sm text-sidebar-foreground">VideoForge</h1>
            <p className="text-[10px] text-muted-foreground">AI 영상 자동화</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <p className="text-[10px] text-muted-foreground text-center">
          VideoForge v1.0
        </p>
      </div>
    </aside>
  );
}

function AppLayout() {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="ml-60 p-8">
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/create" component={CreateVideo} />
          <Route path="/project/:id" component={ProjectDetail} />
          <Route path="/settings" component={Settings} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppLayout />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
