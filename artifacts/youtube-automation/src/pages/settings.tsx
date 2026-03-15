import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Eye, EyeOff, CheckCircle2, XCircle, Loader2, Upload, Trash2, ImageIcon, Mic, Key, Settings2, Play, Square } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ElevenLabsVoice {
  id: string;
  name: string;
  gender: string;
  accent: string;
  description: string;
  useCase: string;
  previewUrl: string | null;
  category: string;
}

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
    key: "GEMINI_API_KEY",
    label: "Google AI Studio (Gemini) API 키",
    description: "Gemini TTS 자연스러운 음성 생성 (무료)",
    placeholder: "AIza...",
    required: false,
    docsUrl: "https://aistudio.google.com/apikey",
  },
  {
    key: "ELEVENLABS_API_KEY",
    label: "ElevenLabs API 키",
    description: "TTS 나레이션 음성 생성 (유료)",
    placeholder: "sk_...",
    required: false,
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
      toast({ title: "저장 완료", description: "설정이 저장되었습니다." });
    },
    onError: () => {
      toast({ title: "저장 실패", description: "설정을 저장하는 중 오류가 발생했습니다.", variant: "destructive" });
    },
  });

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
          API 키, 음성, 채널 브랜딩을 관리하세요.
        </p>
      </div>

      <Tabs defaultValue="api-keys" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="api-keys" className="flex items-center gap-1.5">
            <Key className="w-3.5 h-3.5" />
            API 키
          </TabsTrigger>
          <TabsTrigger value="voice" className="flex items-center gap-1.5">
            <Mic className="w-3.5 h-3.5" />
            음성
          </TabsTrigger>
          <TabsTrigger value="branding" className="flex items-center gap-1.5">
            <Settings2 className="w-3.5 h-3.5" />
            브랜딩
          </TabsTrigger>
        </TabsList>

        <TabsContent value="api-keys" className="space-y-4 mt-4">
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
            API 키 저장
          </Button>
        </TabsContent>

        <TabsContent value="voice" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">TTS 엔진 선택</CardTitle>
              <CardDescription>영상 나레이션에 사용할 음성 엔진을 선택하세요.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { value: "gemini", label: "Gemini TTS (권장)", desc: "자연스러운 AI 음성, Google AI Studio 키 필요 (무료)" },
                { value: "elevenlabs", label: "ElevenLabs", desc: "프리미엄 음성, ElevenLabs 키 필요 (유료)" },
                { value: "google", label: "Google 번역 TTS", desc: "기본 음성, API 키 불필요 (무료)" },
              ].map(engine => {
                const currentEngine = values["TTS_ENGINE"] || settings.find(s => s.key === "TTS_ENGINE")?.value || "elevenlabs";
                return (
                  <div
                    key={engine.value}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${currentEngine === engine.value ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
                    onClick={() => setValues(prev => ({ ...prev, TTS_ENGINE: engine.value }))}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${currentEngine === engine.value ? "border-primary" : "border-muted-foreground"}`}>
                      {currentEngine === engine.value && <div className="w-2 h-2 rounded-full bg-primary" />}
                    </div>
                    <div>
                      <div className="font-medium text-sm">{engine.label}</div>
                      <div className="text-xs text-muted-foreground">{engine.desc}</div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {(values["TTS_ENGINE"] || settings.find(s => s.key === "TTS_ENGINE")?.value || "elevenlabs") === "gemini" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Gemini 음성 선택</CardTitle>
                <CardDescription>나레이션에 사용할 Gemini TTS 음성을 선택하세요.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { value: "Kore", label: "Kore", desc: "차분하고 또렷한 여성 음성" },
                  { value: "Leda", label: "Leda", desc: "부드럽고 따뜻한 여성 음성" },
                  { value: "Aoede", label: "Aoede", desc: "밝고 친근한 여성 음성 (기본, 권장)" },
                  { value: "Zephyr", label: "Zephyr", desc: "가볍고 경쾌한 음성" },
                  { value: "Puck", label: "Puck", desc: "활기차고 에너지 넘치는 음성" },
                  { value: "Charon", label: "Charon", desc: "깊고 차분한 남성 음성" },
                  { value: "Orus", label: "Orus", desc: "무게감 있는 남성 음성" },
                  { value: "Fenrir", label: "Fenrir", desc: "힘 있고 진지한 남성 음성" },
                ].map(voice => {
                  const currentVoice = values["GEMINI_VOICE_NAME"] || settings.find(s => s.key === "GEMINI_VOICE_NAME")?.value || "Aoede";
                  return (
                    <div
                      key={voice.value}
                      className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${currentVoice === voice.value ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
                      onClick={() => setValues(prev => ({ ...prev, GEMINI_VOICE_NAME: voice.value }))}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${currentVoice === voice.value ? "border-primary" : "border-muted-foreground"}`}>
                        {currentVoice === voice.value && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                      </div>
                      <div>
                        <div className="font-medium text-sm">{voice.label}</div>
                        <div className="text-xs text-muted-foreground">{voice.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">TTS 재생 속도</CardTitle>
              <CardDescription>나레이션 음성의 재생 속도를 조절합니다.</CardDescription>
            </CardHeader>
            <CardContent>
              {(() => {
                const currentSpeed = values["TTS_SPEED"] || settings.find(s => s.key === "TTS_SPEED")?.value || "1.25";
                const speedOptions = [
                  { value: "1.0", label: "1.0x (원본)" },
                  { value: "1.1", label: "1.1x" },
                  { value: "1.15", label: "1.15x" },
                  { value: "1.2", label: "1.2x" },
                  { value: "1.25", label: "1.25x (기본)" },
                  { value: "1.3", label: "1.3x" },
                  { value: "1.4", label: "1.4x" },
                  { value: "1.5", label: "1.5x" },
                ];
                return (
                  <div className="flex gap-2 flex-wrap">
                    {speedOptions.map(opt => (
                      <div
                        key={opt.value}
                        className={`px-3 py-1.5 rounded-lg border cursor-pointer text-sm transition-colors ${currentSpeed === opt.value ? "border-primary bg-primary/10 text-primary font-medium" : "border-border hover:border-primary/50 text-muted-foreground"}`}
                        onClick={() => setValues(prev => ({ ...prev, TTS_SPEED: opt.value }))}
                      >
                        {opt.label}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          {(values["TTS_ENGINE"] || settings.find(s => s.key === "TTS_ENGINE")?.value || "elevenlabs") === "elevenlabs" && (
            <VoiceSelector
              selectedVoiceId={values["ELEVENLABS_VOICE_ID"] || settings.find(s => s.key === "ELEVENLABS_VOICE_ID")?.value || "XrExE9yKIg1WjnnlVkGX"}
              onSelect={(id) => setValues((prev) => ({ ...prev, ELEVENLABS_VOICE_ID: id }))}
              hasApiKey={savedKeys.has("ELEVENLABS_API_KEY")}
            />
          )}

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
            음성 설정 저장
          </Button>
        </TabsContent>

        <TabsContent value="branding" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">채널 이름</CardTitle>
              <CardDescription>영상 인트로 화면에 표시됩니다. 예: "너만모르는 경제"</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="채널 이름 입력"
                value={"CHANNEL_NAME" in values ? values["CHANNEL_NAME"] : (settings.find(s => s.key === "CHANNEL_NAME")?.value || "")}
                onChange={(e) => setValues((prev) => ({ ...prev, CHANNEL_NAME: e.target.value }))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">인트로 나레이션</CardTitle>
              <CardDescription>영상 시작 시 읽을 인트로 멘트입니다. 비워두면 기본 인트로가 사용됩니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="안녕하세요, 꼭 알아야 호구가 안되는 정보만 쏙쏙 알려드리는 '너만모르는 경제학' 입니다."
                value={"CHANNEL_INTRO" in values ? values["CHANNEL_INTRO"] : (settings.find(s => s.key === "CHANNEL_INTRO")?.value || "")}
                onChange={(e) => setValues((prev) => ({ ...prev, CHANNEL_INTRO: e.target.value }))}
              />
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                size="sm"
                className="w-full"
              >
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                브랜딩 저장
              </Button>
            </CardContent>
          </Card>
          <ChannelLogoSection />
          <ChannelCharacterSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function VoiceSelector({ selectedVoiceId, onSelect, hasApiKey }: { selectedVoiceId: string; onSelect: (id: string) => void; hasApiKey: boolean }) {
  const { toast } = useToast();
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data: voices = [], isLoading: voicesLoading } = useQuery<ElevenLabsVoice[]>({
    queryKey: ["elevenlabs-voices"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/voices`);
      if (!res.ok) throw new Error("Failed to fetch voices");
      return res.json();
    },
    enabled: hasApiKey,
    staleTime: 5 * 60 * 1000,
  });

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingVoiceId(null);
  };

  const [loadingVoiceId, setLoadingVoiceId] = useState<string | null>(null);

  const playPreview = async (voice: ElevenLabsVoice) => {
    if (playingVoiceId === voice.id) {
      stopAudio();
      return;
    }
    stopAudio();

    if (voice.previewUrl) {
      const audio = new Audio(voice.previewUrl);
      audioRef.current = audio;
      audio.onended = () => setPlayingVoiceId(null);
      audio.onerror = () => {
        setPlayingVoiceId(null);
        toast({ title: "미리듣기 실패", description: "음성 재생에 실패했습니다.", variant: "destructive" });
      };
      audio.play();
      setPlayingVoiceId(voice.id);
      return;
    }

    setLoadingVoiceId(voice.id);
    try {
      const res = await fetch(`${API_BASE}/voice-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId: voice.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "미리듣기 실패" }));
        throw new Error(err.error || "미리듣기 실패");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setPlayingVoiceId(null);
        URL.revokeObjectURL(url);
      };
      audio.play();
      setPlayingVoiceId(voice.id);
    } catch (err: any) {
      toast({ title: "미리듣기 실패", description: err.message, variant: "destructive" });
    } finally {
      setLoadingVoiceId(null);
    }
  };

  const formatGender = (g: string) => {
    if (g === "male") return "남성";
    if (g === "female") return "여성";
    return g;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">나레이션 음성</CardTitle>
        <CardDescription>음성을 선택하고 미리 들어보세요. ElevenLabs 계정의 모든 음성이 표시됩니다.</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasApiKey ? (
          <p className="text-sm text-muted-foreground">ElevenLabs API 키를 먼저 등록해주세요.</p>
        ) : voicesLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            음성 목록을 불러오는 중...
          </div>
        ) : voices.length === 0 ? (
          <p className="text-sm text-muted-foreground">사용 가능한 음성이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[400px] overflow-y-auto pr-1">
            {voices.map((voice) => {
              const isSelected = selectedVoiceId === voice.id;
              const isPlaying = playingVoiceId === voice.id;
              return (
                <div
                  key={voice.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                    isSelected
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50 hover:bg-muted/50"
                  }`}
                  onClick={() => onSelect(voice.id)}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); playPreview(voice); }}
                    disabled={loadingVoiceId === voice.id}
                    className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                      isPlaying
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted hover:bg-primary/20"
                    }`}
                  >
                    {loadingVoiceId === voice.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : isPlaying ? (
                      <Square className="w-3.5 h-3.5" />
                    ) : (
                      <Play className="w-4 h-4 ml-0.5" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{voice.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {[formatGender(voice.gender), voice.accent, voice.description].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {isSelected && (
                    <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
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
        <CardDescription>썸네일과 영상에 표시될 채널 로고 이미지를 업로드하세요</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          {logoUrl ? (
            <div className="relative w-20 h-20 rounded-lg border border-border overflow-hidden bg-muted flex-shrink-0">
              <img
                src={`${API_BASE}${logoUrl}`}
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

function ChannelCharacterSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: characterData } = useQuery<{ characterUrl: string | null }>({
    queryKey: ["channel-character"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/character`);
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
      formData.append("character", file);
      const res = await fetch(`${API_BASE}/upload-character`, { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      queryClient.invalidateQueries({ queryKey: ["channel-character"] });
      toast({ title: "업로드 완료", description: "채널 캐릭터가 저장되었습니다." });
    } catch {
      toast({ title: "업로드 실패", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async () => {
    try {
      await fetch(`${API_BASE}/character`, { method: "DELETE" });
      queryClient.invalidateQueries({ queryKey: ["channel-character"] });
      toast({ title: "삭제 완료", description: "채널 캐릭터가 삭제되었습니다." });
    } catch {
      toast({ title: "삭제 실패", variant: "destructive" });
    }
  };

  const characterUrl = characterData?.characterUrl;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">채널 캐릭터</CardTitle>
          <Badge variant="outline" className="text-xs">선택</Badge>
        </div>
        <CardDescription>"캐릭터" 비주얼 스타일 선택 시, 이 캐릭터가 매 섹션 이미지에 등장합니다</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          {characterUrl ? (
            <div className="relative w-20 h-20 rounded-lg border border-border overflow-hidden bg-white flex-shrink-0">
              <img
                src={`${API_BASE}${characterUrl}`}
                alt="채널 캐릭터"
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
              {characterUrl ? "캐릭터 변경" : "캐릭터 업로드"}
            </Button>
            {characterUrl && (
              <Button variant="ghost" size="sm" onClick={handleDelete} className="text-destructive hover:text-destructive">
                <Trash2 className="w-4 h-4 mr-2" />
                삭제
              </Button>
            )}
            <p className="text-xs text-muted-foreground">PNG 권장 (투명 배경), 최대 5MB</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
