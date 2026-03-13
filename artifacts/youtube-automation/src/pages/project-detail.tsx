import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Play, Download, RefreshCw, Loader2, CheckCircle2, AlertCircle, Clock, FileText, Image, Sparkles } from "lucide-react";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const API_BASE = `${import.meta.env.BASE_URL}api`.replace(/\/+/g, '/');

interface ProjectDetail {
  id: number;
  title: string;
  topic: string;
  status: string;
  videoType: string;
  visualStyle: string;
  duration: string;
  tone: string;
  referenceUrl: string | null;
  scriptJson: any;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  progress: number;
  progressMessage: string | null;
  errorMessage: string | null;
  costEstimate: number | null;
  createdAt: string;
  updatedAt: string;
}

const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft: { label: "준비중", color: "text-yellow-500", icon: <Clock className="w-5 h-5 text-yellow-500" /> },
  generating: { label: "생성중", color: "text-blue-500", icon: <Loader2 className="w-5 h-5 text-blue-500 animate-spin" /> },
  completed: { label: "완료", color: "text-green-500", icon: <CheckCircle2 className="w-5 h-5 text-green-500" /> },
  error: { label: "오류", color: "text-red-500", icon: <AlertCircle className="w-5 h-5 text-red-500" /> },
};

const STEP_LABELS = [
  { key: "script", label: "AI 대본 생성", threshold: 15 },
  { key: "tts", label: "TTS 나레이션 생성", threshold: 35 },
  { key: "images", label: "AI 이미지 생성", threshold: 60 },
  { key: "compose", label: "영상 합성 (FFmpeg)", threshold: 85 },
  { key: "finalize", label: "최종 처리", threshold: 100 },
];

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [thumbnailPrompt, setThumbnailPrompt] = useState("");
  const [isRegeneratingThumb, setIsRegeneratingThumb] = useState(false);

  const { data: project, isLoading } = useQuery<ProjectDetail>({
    queryKey: ["project", id],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/projects/${id}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === "generating" ? 2000 : false;
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/projects/${id}/generate`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to generate");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", id] });
      toast({ title: "생성 시작", description: "영상 생성이 시작되었습니다." });
    },
    onError: (err: Error) => {
      toast({ title: "생성 실패", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading || !project) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const status = statusConfig[project.status] || statusConfig.draft;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{project.title}</h1>
            <Badge variant={project.status === "completed" ? "outline" : project.status === "error" ? "destructive" : "secondary"}>
              {status.label}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1">{project.topic}</p>
        </div>
      </div>

      {project.status === "generating" && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="py-6">
            <div className="flex items-center gap-3 mb-4">
              {status.icon}
              <div>
                <p className="font-medium">영상 생성 중...</p>
                <p className="text-sm text-muted-foreground">{project.progressMessage || "처리 중입니다"}</p>
              </div>
              <span className="ml-auto text-2xl font-bold text-primary">{project.progress}%</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-700 ease-out"
                style={{ width: `${project.progress}%` }}
              />
            </div>
            <div className="flex justify-between mt-4">
              {STEP_LABELS.map((step) => {
                const isActive = project.progress >= step.threshold - 14 && project.progress < step.threshold;
                const isDone = project.progress >= step.threshold;
                return (
                  <div key={step.key} className="flex flex-col items-center gap-1">
                    <div className={`w-3 h-3 rounded-full ${isDone ? "bg-primary" : isActive ? "bg-primary/50 animate-pulse" : "bg-muted-foreground/20"}`} />
                    <span className={`text-[10px] ${isDone ? "text-primary font-medium" : isActive ? "text-foreground" : "text-muted-foreground"}`}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {project.status === "error" && (
        <Card className="border-destructive/20 bg-destructive/5">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-destructive" />
              <div>
                <p className="font-medium text-destructive">오류 발생</p>
                <p className="text-sm text-muted-foreground">{project.errorMessage || "알 수 없는 오류"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {project.status === "completed" && project.videoUrl && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Play className="w-5 h-5" />
              영상 미리보기
            </CardTitle>
          </CardHeader>
          <CardContent>
            <video
              controls
              preload="metadata"
              className={`rounded-lg bg-black mx-auto ${project.videoType === "shorts" ? "max-h-[500px]" : "w-full"}`}
              src={`${API_BASE}${project.videoUrl}`}
              {...(project.thumbnailUrl ? { poster: `${API_BASE}${project.thumbnailUrl}` } : {})}
            />
            <div className="flex gap-3 mt-4">
              <a href={`${API_BASE}${project.videoUrl}`} download className="flex-1">
                <Button className="w-full">
                  <Download className="w-4 h-4 mr-2" />
                  MP4 다운로드
                </Button>
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      {project.status === "completed" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Image className="w-5 h-5" />
              썸네일
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {project.thumbnailUrl && (
              <img
                src={`${API_BASE}${project.thumbnailUrl}?t=${Date.now()}`}
                alt="썸네일"
                className="rounded-lg w-full max-w-md mx-auto"
              />
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">썸네일 프롬프트 (직접 입력)</label>
              <Textarea
                placeholder="원하는 썸네일을 설명하세요. 예: 놀란 표정의 남자가 돈다발을 보고 있는 장면, 배경은 빨간색, '충격! 이게 가능?' 텍스트"
                value={thumbnailPrompt}
                onChange={(e) => setThumbnailPrompt(e.target.value)}
                rows={3}
                className="resize-none"
              />
              <Button
                onClick={async () => {
                  if (!thumbnailPrompt.trim()) {
                    toast({ title: "프롬프트를 입력해주세요", variant: "destructive" });
                    return;
                  }
                  setIsRegeneratingThumb(true);
                  try {
                    const res = await fetch(`${API_BASE}/projects/${id}/regenerate-thumbnail`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ prompt: thumbnailPrompt }),
                    });
                    if (!res.ok) {
                      const err = await res.json().catch(() => ({}));
                      throw new Error(err.error || "Failed");
                    }
                    queryClient.invalidateQueries({ queryKey: ["project", id] });
                    toast({ title: "썸네일 재생성 완료!" });
                  } catch (err: any) {
                    toast({ title: "썸네일 생성 실패", description: err.message, variant: "destructive" });
                  } finally {
                    setIsRegeneratingThumb(false);
                  }
                }}
                disabled={isRegeneratingThumb}
                variant="outline"
                className="w-full"
              >
                {isRegeneratingThumb ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-2" />
                )}
                {isRegeneratingThumb ? "썸네일 생성 중..." : "썸네일 재생성"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">영상 설정</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">타입</span>
              <span>{project.videoType === "shorts" ? "쇼츠" : "롱폼"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">스타일</span>
              <span>{{ cinematic: "시네마틱", "simple-character": "심플 캐릭터", infographic: "인포그래픽", webtoon: "웹툰" }[project.visualStyle] || project.visualStyle}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">분량</span>
              <span>{project.videoType === "shorts" ? "약 30~60초" : ({ "1min": "약 1분", "5min": "약 5분", "10min": "약 10분", "15min": "약 15분" }[project.duration] || project.duration)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">톤</span>
              <span>{{ calm: "차분한", energetic: "활기찬", serious: "진지한", friendly: "친근한" }[project.tone] || project.tone}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">진행 정보</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">생성일</span>
              <span>{new Date(project.createdAt).toLocaleString("ko-KR")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">최근 업데이트</span>
              <span>{new Date(project.updatedAt).toLocaleString("ko-KR")}</span>
            </div>
            {project.costEstimate && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">예상 비용</span>
                <span>~{project.costEstimate.toLocaleString()}원</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {project.scriptJson && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="w-5 h-5" />
              AI 생성 대본
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {(project.scriptJson as any).sections?.map((section: any, idx: number) => (
                <div key={idx} className="border-l-2 border-primary/20 pl-4 py-1">
                  <p className="text-xs font-medium text-primary mb-1">섹션 {idx + 1}</p>
                  <p className="text-sm">{section.narration}</p>
                  {section.subtitleHighlight && (
                    <Badge variant="secondary" className="mt-2 text-xs">{section.subtitleHighlight}</Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {(project.status === "draft" || project.status === "error") && (
        <Button
          className="w-full h-12 text-base"
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
        >
          {generateMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          {project.status === "error" ? "다시 생성하기" : "영상 생성 시작"}
        </Button>
      )}
    </div>
  );
}
