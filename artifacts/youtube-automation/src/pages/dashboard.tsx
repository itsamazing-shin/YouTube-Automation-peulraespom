import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Video, Clock, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

const API_BASE = `${import.meta.env.BASE_URL}api`.replace(/\/+/g, '/');

interface Project {
  id: number;
  title: string;
  topic: string;
  status: string;
  videoType: string;
  progress: number;
  progressMessage: string | null;
  createdAt: string;
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
  draft: { label: "준비중", variant: "secondary", icon: <Clock className="w-3 h-3" /> },
  generating: { label: "생성중", variant: "default", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  completed: { label: "완료", variant: "outline", icon: <CheckCircle2 className="w-3 h-3 text-green-500" /> },
  error: { label: "오류", variant: "destructive", icon: <AlertCircle className="w-3 h-3" /> },
};

export default function Dashboard() {
  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/projects`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">AI 영상 자동 생성 프로젝트를 관리하세요</p>
        </div>
        <Link href="/create">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            새 영상 만들기
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Video className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">아직 프로젝트가 없습니다</h3>
            <p className="text-muted-foreground text-sm mb-4">첫 번째 AI 영상을 만들어보세요</p>
            <Link href="/create">
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                새 영상 만들기
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const status = statusConfig[project.status] || statusConfig.draft;
            return (
              <Link key={project.id} href={`/project/${project.id}`}>
                <Card className="cursor-pointer transition-all hover:shadow-md hover:border-primary/20">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <Badge variant={status.variant} className="flex items-center gap-1">
                        {status.icon}
                        {status.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {project.videoType === "shorts" ? "Shorts" : "Long-form"}
                      </span>
                    </div>
                    <h3 className="font-semibold text-sm line-clamp-2 mb-1">{project.title}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-1">{project.topic}</p>
                    {project.status === "generating" && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-muted-foreground">{project.progressMessage || "처리중..."}</span>
                          <span className="font-medium">{project.progress}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all duration-500"
                            style={{ width: `${project.progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-3">
                      {new Date(project.createdAt).toLocaleDateString("ko-KR")}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
