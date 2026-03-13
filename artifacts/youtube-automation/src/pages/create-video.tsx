import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Sparkles, Loader2, Upload, X, ImageIcon } from "lucide-react";
import { Link } from "wouter";

const API_BASE = `${import.meta.env.BASE_URL}api`.replace(/\/+/g, '/');

export default function CreateVideo() {
  const [, navigate] = useLocation();
  const [topic, setTopic] = useState("");
  const [videoType, setVideoType] = useState("longform");
  const [visualStyle, setVisualStyle] = useState("cinematic");
  const [duration, setDuration] = useState("10min");
  const [tone, setTone] = useState("calm");
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [referenceImagePreview, setReferenceImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleVideoTypeChange = (type: string) => {
    setVideoType(type);
    if (type === "shorts") {
      setDuration("1min");
    } else {
      if (duration === "1min") {
        setDuration("10min");
      }
    }
  };
  const [referenceUrl, setReferenceUrl] = useState("");

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setReferenceImagePreview(URL.createObjectURL(file));
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch(`${API_BASE}/upload-reference-image`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setReferenceImageUrl(data.imageUrl);
    } catch {
      setReferenceImagePreview(null);
      setReferenceImageUrl(null);
    } finally {
      setUploading(false);
    }
  };

  const removeReferenceImage = () => {
    setReferenceImageUrl(null);
    setReferenceImagePreview(null);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          title: topic,
          videoType,
          visualStyle,
          duration,
          tone,
          referenceUrl: referenceUrl || undefined,
          referenceImageUrl: referenceImageUrl || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to create");
      return res.json();
    },
    onSuccess: (data) => {
      navigate(`/project/${data.id}`);
    },
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">새 영상 만들기</h1>
          <p className="text-muted-foreground mt-1">주제를 입력하면 AI가 자동으로 영상을 만들어줍니다</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">영상 설정</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="topic">주제 / 키워드 *</Label>
            <Textarea
              id="topic"
              placeholder="예: 영끌족의 현실, 부동산 버블의 심리학, MZ세대 재테크..."
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>영상 타입</Label>
              <Select value={videoType} onValueChange={handleVideoTypeChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="longform">롱폼 (5~15분)</SelectItem>
                  <SelectItem value="shorts">쇼츠 (30~60초)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>비주얼 스타일</Label>
              <Select value={visualStyle} onValueChange={setVisualStyle}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cinematic">시네마틱 사실화</SelectItem>
                  <SelectItem value="simple-character">심플 캐릭터 (졸라맨풍)</SelectItem>
                  <SelectItem value="infographic">인포그래픽</SelectItem>
                  <SelectItem value="webtoon">만화/웹툰풍</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>분량</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {videoType === "shorts" ? (
                    <SelectItem value="1min">약 30~60초</SelectItem>
                  ) : (
                    <>
                      <SelectItem value="1min">약 1분 (테스트)</SelectItem>
                      <SelectItem value="5min">약 5분</SelectItem>
                      <SelectItem value="10min">약 10분</SelectItem>
                      <SelectItem value="15min">약 15분</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>톤 & 분위기</Label>
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="calm">차분하고 설득력 있는</SelectItem>
                  <SelectItem value="energetic">활기차고 열정적인</SelectItem>
                  <SelectItem value="serious">진지하고 전문적인</SelectItem>
                  <SelectItem value="friendly">친근하고 편안한</SelectItem>
                  <SelectItem value="crisis">충격/위기감 (후킹 강화)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reference">레퍼런스 영상 URL (선택)</Label>
            <Input
              id="reference"
              placeholder="https://youtube.com/watch?v=..."
              value={referenceUrl}
              onChange={(e) => setReferenceUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">참고할 유튜브 영상의 URL을 입력하면 스타일을 분석합니다</p>
          </div>

          <div className="space-y-2">
            <Label>참조 이미지 (선택)</Label>
            <p className="text-xs text-muted-foreground mb-2">원하는 스타일의 이미지를 업로드하면, AI가 분석해서 비슷한 화풍으로 이미지를 생성합니다</p>
            {referenceImagePreview ? (
              <div className="relative inline-block">
                <img
                  src={referenceImagePreview}
                  alt="참조 이미지"
                  className="w-40 h-28 object-cover rounded-lg border border-border"
                />
                {uploading && (
                  <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-white" />
                  </div>
                )}
                <button
                  onClick={removeReferenceImage}
                  className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 hover:bg-destructive/80"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors">
                <ImageIcon className="w-8 h-8 text-muted-foreground mb-2" />
                <span className="text-sm text-muted-foreground">클릭하여 이미지 업로드</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageUpload}
                />
              </label>
            )}
          </div>
        </CardContent>
      </Card>

      <Button
        className="w-full h-12 text-base"
        onClick={() => createMutation.mutate()}
        disabled={!topic.trim() || createMutation.isPending}
      >
        {createMutation.isPending ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Sparkles className="w-4 h-4 mr-2" />
        )}
        AI 영상 생성 시작
      </Button>
    </div>
  );
}
