import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Save, Eye, EyeOff, CheckCircle2, XCircle, Loader2, Upload, Trash2, ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = `${import.meta.env.BASE_URL}api`.replace(/\/+/g, '/');

interface ApiKeyConfig {
  key: string;
  label: string;
  description: string;
  placeholder: string;
  required: boolean;
  docsUrl: string;
}

const API_KEYS: ApiKeyConfig[] = [
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI API 키",
    description: "GPT 대본 생성 + gpt-image-1 이미지 생성",
    placeholder: "sk-...",
    required: true,
    docsUrl: "https://platform.openai.com/api-keys",
  },
  {
    key: "ELEVENLABS_API_KEY",
    label: "ElevenLabs API 키",
    description: "TTS 나레이션 음성 생성",
    placeholder: "sk_...",
    required: true,
    docsUrl: "https://elevenlabs.io",
  },
  {
    key: "XAI_API_KEY",
    label: "xAI (Grok) API 키",
    description: "인트로 AI 영상 생성 (선택사항)",
    placeholder: "xai-...",
    required: false,
    docsUrl: "https://console.x.ai",
  },
  {
    key: "YOUTUBE_API_KEY",
    label: "YouTube Data API 키",
    description: "레퍼런스 영상 댓글 분석 (시청자 관심 포인트 파악)",
    placeholder: "AIza...",
    required: false,
    docsUrl: "https://console.cloud.google.com/apis/credentials",
  },
  {
    key: "PEXELS_API_KEY",
    label: "Pexels API 키",
    description: "무료 스톡 영상/이미지 검색",
    placeholder: "API Key",
    required: false,
    docsUrl: "https://www.pexels.com/api/",
  },
];

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  const { data: settings = [], isLoading } = useQuery<{ key: string; value: string; hasValue?: boolean }[]>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/settings`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    const saved = new Set<string>();
    for (const s of settings) {
      if (s.hasValue) saved.add(s.key);
    }
    setSavedKeys(saved);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: values }),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast({ title: "저장 완료", description: "API 키가 저장되었습니다." });
    },
    onError: () => {
      toast({ title: "저장 실패", description: "설정을 저장하는 중 오류가 발생했습니다.", variant: "destructive" });
    },
  });

  const maskValue = (val: string) => {
    if (!val) return "";
    if (val.length <= 8) return "••••••••";
    return val.substring(0, 4) + "••••" + val.substring(val.length - 4);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">설정</h1>
        <p className="text-muted-foreground mt-1">
          외부 API 키를 등록하세요. 각 서비스에서 직접 발급받은 키를 입력합니다.
        </p>
      </div>

      <div className="space-y-4">
        {API_KEYS.map((config) => {
          const hasValue = !!values[config.key]?.trim() || savedKeys.has(config.key);
          const isVisible = showKeys[config.key];

          return (
            <Card key={config.key}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{config.label}</CardTitle>
                    {config.required ? (
                      <Badge variant="secondary" className="text-xs">필수</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">선택</Badge>
                    )}
                  </div>
                  {hasValue ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                <CardDescription>{config.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      type={isVisible ? "text" : "password"}
                      placeholder={config.placeholder}
                      value={values[config.key] || ""}
                      onChange={(e) => setValues((prev) => ({ ...prev, [config.key]: e.target.value }))}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowKeys((prev) => ({ ...prev, [config.key]: !prev[config.key] }))}
                  >
                    {isVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
                <a
                  href={config.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline mt-2 inline-block"
                >
                  API 키 발급받기 →
                </a>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Button
        className="w-full"
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
      >
        {saveMutation.isPending ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Save className="w-4 h-4 mr-2" />
        )}
        설정 저장
      </Button>

      <ChannelLogoSection />
    </div>
  );
}

function ChannelLogoSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: logoData } = useQuery<{ logoUrl: string | null }>({
    queryKey: ["channel-logo"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/logo`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("logo", file);
      const res = await fetch(`${API_BASE}/upload-logo`, { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      queryClient.invalidateQueries({ queryKey: ["channel-logo"] });
      toast({ title: "업로드 완료", description: "채널 로고가 저장되었습니다." });
    } catch {
      toast({ title: "업로드 실패", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async () => {
    try {
      await fetch(`${API_BASE}/logo`, { method: "DELETE" });
      queryClient.invalidateQueries({ queryKey: ["channel-logo"] });
      toast({ title: "삭제 완료", description: "채널 로고가 삭제되었습니다." });
    } catch {
      toast({ title: "삭제 실패", variant: "destructive" });
    }
  };

  const logoUrl = logoData?.logoUrl;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">채널 로고</CardTitle>
          <Badge variant="outline" className="text-xs">선택</Badge>
        </div>
        <CardDescription>썸네일 좌측 상단에 표시될 채널 로고 이미지를 업로드하세요</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          {logoUrl ? (
            <div className="relative w-20 h-20 rounded-lg border border-border overflow-hidden bg-muted flex-shrink-0">
              <img
                src={`${API_BASE.replace('/api', '')}${logoUrl}`}
                alt="채널 로고"
                className="w-full h-full object-contain"
              />
            </div>
          ) : (
            <div className="w-20 h-20 rounded-lg border border-dashed border-border flex items-center justify-center bg-muted/30 flex-shrink-0">
              <ImageIcon className="w-8 h-8 text-muted-foreground" />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleUpload}
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              {logoUrl ? "로고 변경" : "로고 업로드"}
            </Button>
            {logoUrl && (
              <Button variant="ghost" size="sm" onClick={handleDelete} className="text-destructive hover:text-destructive">
                <Trash2 className="w-4 h-4 mr-2" />
                삭제
              </Button>
            )}
            <p className="text-xs text-muted-foreground">PNG/JPG, 최대 5MB</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
