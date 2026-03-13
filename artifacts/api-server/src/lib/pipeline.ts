import { db } from "@workspace/db";
import { projects } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { Project } from "@workspace/db/schema";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const OUTPUT_DIR = path.join(process.cwd(), "output");
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

export async function regenerateThumbnail(
  projectId: number,
  customPrompt: string,
  openaiKey: string,
  openaiBaseUrl: string = "https://api.openai.com/v1",
): Promise<string | null> {
  const projectDir = path.join(OUTPUT_DIR, `project_${projectId}`);
  if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  const scriptData = project?.scriptJson as any;
  const thumbnailText = scriptData?.thumbnailText || project?.title || "";

  const thumbRawPath = path.join(projectDir, `thumbnail_raw_${projectId}.png`);
  const thumbPath = path.join(projectDir, `thumbnail_${projectId}.png`);

  const noTextPrompt = customPrompt + " CRITICAL: Do NOT include any text, letters, or words in the image. Leave space for text overlay.";
  await generateImage(noTextPrompt, thumbRawPath, openaiKey, false, openaiBaseUrl, "medium");

  if (fs.existsSync(thumbRawPath)) {
    try {
      await overlayTextOnImage(thumbRawPath, thumbPath, thumbnailText, false);
    } catch (e) {
      console.warn("Text overlay failed, using raw image:", e);
      fs.copyFileSync(thumbRawPath, thumbPath);
    }

    const relativePath = `/files/project_${projectId}/thumbnail_${projectId}.png`;
    await db.update(projects).set({
      thumbnailUrl: relativePath,
      updatedAt: new Date(),
    }).where(eq(projects.id, projectId));
    return relativePath;
  }
  return null;
}

async function analyzeReferenceImage(
  imagePath: string,
  apiKey: string,
  baseUrl: string = "https://api.openai.com/v1",
): Promise<string> {
  const imageData = fs.readFileSync(imagePath);
  const base64 = imageData.toString("base64");
  const mimeType = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert visual style analyst for AI image generation. Analyze the given image and output a PRECISE, REUSABLE style description that can be directly prepended to any image generation prompt. Format: 'Style: [art technique], [line work], [color palette specifics], [character design details if any], [rendering method], [mood/lighting].' Be extremely specific about visual characteristics (e.g. 'thick black outlines 3px', 'flat cel-shaded colors', 'round simple dot-eyes characters', 'saturated red/yellow/blue palette'). Output in English only. Max 4 sentences. The description must be concrete enough that a different AI can reproduce the exact same visual style.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this reference image's visual style. Describe the art style, colors, line work, character design, and overall aesthetic so that new images can be generated in the same style." },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
      max_tokens: 300,
      temperature: 0.3,
    }),
  });

  if (!response.ok) throw new Error(`Vision API failed: ${response.status}`);
  const data: any = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

async function updateProgress(projectId: number, progress: number, message: string) {
  await db.update(projects).set({
    progress,
    progressMessage: message,
    updatedAt: new Date(),
  }).where(eq(projects.id, projectId));
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function fetchYouTubeComments(
  videoUrl: string,
  youtubeApiKey: string,
): Promise<string[]> {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) return [];

  try {
    const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=100&order=relevance&textFormat=plainText&key=${youtubeApiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn("YouTube comments fetch failed:", res.status);
      return [];
    }
    const data = await res.json();
    const comments: string[] = [];
    for (const item of data.items || []) {
      const text = item.snippet?.topLevelComment?.snippet?.textDisplay;
      if (text) comments.push(text);
    }
    return comments;
  } catch (e) {
    console.warn("YouTube comments fetch error:", e);
    return [];
  }
}

async function analyzeComments(
  comments: string[],
  topic: string,
  apiKey: string,
  baseUrl: string,
): Promise<string> {
  if (comments.length === 0) return "";

  const commentsText = comments.slice(0, 80).map((c, i) => `${i + 1}. ${c}`).join("\n");

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "당신은 유튜브 댓글 분석 전문가입니다. 댓글을 분석해서 시청자들의 핵심 관심 포인트를 요약해주세요.",
        },
        {
          role: "user",
          content: `주제: "${topic}"

아래는 관련 유튜브 영상의 댓글들입니다. 이 댓글들을 분석해서:
1. 시청자들이 가장 관심 있어하는 포인트 (3~5개)
2. 시청자들이 공감하는 감정/반응
3. 시청자들이 더 알고 싶어하는 내용
4. 댓글에서 자주 언급되는 키워드

간결하게 요약해주세요 (300자 이내):

${commentsText}`,
        },
      ],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    console.warn("Comment analysis failed:", res.status);
    return "";
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

interface ScriptSection {
  narration: string;
  imagePrompt: string;
  subtitleHighlight: string;
  duration: number;
}

interface VideoScript {
  title: string;
  thumbnailText: string;
  sections: ScriptSection[];
  thumbnailPrompt: string;
}

async function generateScript(
  topic: string,
  videoType: string,
  duration: string,
  tone: string,
  visualStyle: string,
  referenceUrl: string | null,
  apiKey: string,
  baseUrl: string = "https://api.openai.com/v1",
  commentAnalysis: string = "",
  referenceStyleDesc: string = "",
): Promise<VideoScript> {
  const isShorts = videoType === "shorts";

  const sectionCount = isShorts ? 3 : duration === "1min" ? 4 : duration === "5min" ? 8 : duration === "10min" ? 12 : 16;

  const toneMap: Record<string, string> = {
    calm: "차분하고 설득력 있는 톤으로, 시청자가 깊이 생각하게 만드는",
    energetic: "활기차고 열정적인 톤으로, 에너지 넘치는",
    serious: "진지하고 전문적인 톤으로, 신뢰감을 주는",
    friendly: "친근하고 편안한 톤으로, 친구에게 이야기하듯",
    crisis: "충격적이고 긴박한 톤으로, 위기감과 긴장감을 극대화하는. 첫 문장부터 '지금 이 순간에도 벌어지고 있습니다', '이거 모르면 큰일납니다', '충격적인 사실이 밝혀졌습니다' 같은 강렬한 후킹으로 시작. 중간중간 '더 심각한 문제는 따로 있습니다', '그런데 진짜 무서운 건 이겁니다' 같은 전환으로 긴장감을 유지. 마치 뉴스 속보를 전하듯 긴박하게 전달하되, 구체적인 수치와 팩트로 신뢰감을 확보",
  };

  const styleMap: Record<string, string> = {
    cinematic: "Cinematic photorealistic scene. Dramatic film lighting, professional composition, shallow depth of field.",
    "simple-character": "Simple cartoon character illustration in the style of Korean YouTube channels like '이상한경제'. Characters have: perfectly round white/light circle head, very simple dot eyes and small line mouth, NO nose, minimal facial features but EXTREMELY exaggerated emotional expressions (crying rivers of tears, steam coming from ears when angry, sparkling eyes when excited, jaw dropping in shock). Body is simple but wearing recognizable clothes (suits, casual wear). Characters interact with oversized props related to the scene (giant money bags, huge documents, oversized coins, large arrows pointing up/down). Background should be a relevant scene setting (city street, office, home). The overall style is cute, humorous, and immediately conveys the emotion of the scene. Similar to 졸라맨/이상한경제 art style. Bold thick outlines, flat colors, clean vector-like quality.",
    infographic: "Clean modern infographic style. Data charts, graphs, icons, flat design, bold typography, organized layout with clear visual hierarchy.",
    webtoon: "Korean webtoon illustration style. Vibrant saturated colors, expressive characters, dynamic poses, manhwa-inspired art with clean lines.",
  };

  const systemPrompt = `당신은 한국 유튜브 조회수 폭발 전문 대본 작가입니다. ${toneMap[tone] || toneMap.calm} 스타일로 대본을 작성합니다.
${isShorts ? "쇼츠 영상이므로 첫 문장부터 강렬한 후킹으로 시작하세요. 짧고 임팩트 있는 문장을 사용하고, 긴박감과 호기심을 유발하세요." : ""}

🔥 제목 & 썸네일 텍스트 작성 핵심 규칙:
- title: 유튜브 검색/추천에 노출될 전체 제목 (20~40자). 큰따옴표로 핵심 문구를 감싸서 강조. 예: "중국 경제 완전 붕괴" 14억 대륙의 충격적 최후
- thumbnailText: 썸네일 이미지 위에 표시될 짧고 강렬한 후킹 문구 (최대 15~20자). 클릭을 유도하는 충격적이고 자극적인 짧은 문구. 예시:
  * "중국 경제 폭락"
  * "일본 국채 위기"  
  * "천궁-II 96% 요격"
  * "그들의 시대는 끝났다"
  * "14억 대륙 파멸의 최후"
  * "트럼프의 소름 돋는 실체"
- 핵심: 위기감, 충격, 긴박감, 궁금증을 자극하는 단어 사용. "폭락", "붕괴", "충격", "미친", "실체", "최후", "끝났다" 등

매번 완전히 새로운 시각과 독창적인 구성으로 대본을 작성하세요. 같은 주제라도 이전과 다른 앵글, 다른 예시, 다른 스토리라인으로 접근하세요. 뻔한 서론 대신 의외의 사실이나 충격적인 통계로 시작하세요.
반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.`;

  const userPrompt = `주제: "${topic}"
${referenceUrl ? `참고 영상 URL: ${referenceUrl}\n(위 영상은 주제와 톤의 방향성만 참고하세요. 대본 내용, 문장, 구성은 절대 복제하지 마세요. 100% 독창적인 새로운 대본을 작성해야 합니다. 유튜브 저작권 정책을 준수하세요.)` : ""}
${commentAnalysis ? `\n📊 시청자 댓글 분석 결과:\n${commentAnalysis}\n\n위 댓글 분석을 적극 반영하세요. 시청자들이 가장 관심 있어하는 포인트를 중심으로 대본을 구성하고, 댓글에서 나온 공감 포인트나 궁금증을 대본에 녹여내세요. 이렇게 하면 시청자 반응이 좋은 영상이 됩니다.\n` : ""}
${sectionCount}개 섹션으로 구성된 ${isShorts ? "유튜브 쇼츠(세로형 60초)" : "유튜브 롱폼 영상"} 대본을 작성하세요.

이미지 프롬프트는 "${styleMap[visualStyle] || styleMap.cinematic}" 스타일로 작성하세요.
${referenceStyleDesc ? `\n🎨 참조 이미지 스타일 (최우선 적용 — 모든 섹션 이미지에 반드시 이 스타일을 따르세요!):\n${referenceStyleDesc}\n\n⚠️ 중요: 위 참조 스타일이 기본 스타일보다 우선합니다. 모든 이미지 프롬프트의 맨 앞에 참조 스타일의 핵심 특징을 명시하세요. 참조 이미지와 동일한 화풍, 색감, 선 스타일, 캐릭터 디자인으로 통일하세요. 프롬프트 시작을 "In the exact style of the reference: [핵심특징]..." 으로 시작하세요.\n` : ""}

⚠️ 이미지 프롬프트 품질 규칙:
- 프롬프트는 영어로, 핵심 장면을 구체적으로 묘사하세요
- 분위기/조명/구도를 명확하게 지정하세요
- 인물이 있다면 표정, 자세, 의상을 구체적으로 묘사하세요
- 배경을 반드시 포함하세요 (도시, 사무실, 전쟁터, 국회의사당 등)
- "professional digital illustration", "high detail", "dramatic lighting" 같은 품질 키워드를 포함하세요
- 절대 텍스트/글자/문자를 이미지에 포함하지 마세요

JSON 형식:
{
  "title": "유튜브 검색/추천용 전체 제목 (20~40자, 큰따옴표로 핵심 강조)",
  "thumbnailText": "썸네일 후킹 문구 (15~20자 이내, 극도로 짧고 강렬하게. 예: 중국 경제 완전 붕괴, 일본의 충격적 최후)",
  "sections": [
    {
      "narration": "나레이션 텍스트 (반드시 3~5문장, 각 문장이 구체적이고 내용이 풍부하게. 총 80~150자 이상)",
      "imagePrompt": "English-only image prompt for this scene. CRITICAL: Do NOT include ANY text, letters, words, signs, labels, speech bubbles with text, or writing of ANY language in the image. The image must be purely visual with ZERO text elements. Leave empty speech bubbles or blank signs if needed — text will be added separately. Style: ${styleMap[visualStyle] || styleMap.cinematic}",
      "subtitleHighlight": "핵심 자막 (짧은 문구)",
      "duration": ${isShorts ? 15 : 30}
    }
  ],
  "thumbnailPrompt": "YouTube thumbnail, ultra eye-catching. Requirements: 1) dramatic facial expression or shocking visual related to the topic, 2) DO NOT include any text or letters in the image — leave clean space on the left side for text overlay to be added later, 3) high contrast saturated colors with red/yellow accent, 4) clean composition with subject on the right side leaving the left 40% empty for text, 5) slight zoom-in effect for urgency. Style: MrBeast/Korean top YouTuber thumbnail quality. CRITICAL: absolutely NO text, NO letters, NO words in the image."
}`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 1.0,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;
  return JSON.parse(content);
}

async function generateTTS(
  text: string,
  outputPath: string,
  apiKey: string,
): Promise<void> {
  const response = await fetch("https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJgB", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} - ${err}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
}

interface WhisperSegment {
  text: string;
  start: number;
  end: number;
}

async function transcribeWithWhisper(
  audioPath: string,
  apiKey: string,
  baseUrl: string = "https://api.openai.com/v1",
): Promise<WhisperSegment[]> {
  const formData = new FormData();
  const audioBuffer = fs.readFileSync(audioPath);
  const audioBlob = new Blob([audioBuffer], { type: "audio/mpeg" });
  formData.append("file", audioBlob, path.basename(audioPath));
  formData.append("model", "whisper-1");
  formData.append("language", "ko");
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "segment");

  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    console.warn("Whisper transcription failed, falling back to estimation:", await response.text());
    return [];
  }

  const data = await response.json();
  if (data.segments && Array.isArray(data.segments)) {
    return data.segments.map((seg: any) => ({
      text: seg.text.trim(),
      start: seg.start,
      end: seg.end,
    }));
  }
  return [];
}

async function generateImageGemini(
  prompt: string,
  outputPath: string,
  isVertical: boolean,
): Promise<void> {
  const geminiBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const geminiApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;

  if (!geminiBaseUrl || !geminiApiKey) {
    throw new Error("Gemini AI integration not configured");
  }

  const aspectRatio = isVertical ? "9:16" : "16:9";
  const enhancedPrompt = `Generate a high-quality illustration. ${prompt}. The image should be vivid, detailed, and suitable for a YouTube video frame at ${isVertical ? "1080x1920" : "1920x1080"} resolution.`;

  const response = await fetch(
    `${geminiBaseUrl}/v1beta/models/gemini-2.5-flash-image:generateContent?key=${geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: enhancedPrompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
          imageGenerationConfig: {
            aspectRatio,
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini image generation error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  const candidates = data.candidates;
  if (candidates && candidates[0]?.content?.parts) {
    for (const part of candidates[0].content.parts) {
      if (part.inlineData) {
        fs.writeFileSync(outputPath, Buffer.from(part.inlineData.data, "base64"));
        return;
      }
    }
  }
  throw new Error("Gemini returned no image data");
}

async function generateImageOpenAI(
  prompt: string,
  outputPath: string,
  apiKey: string,
  isVertical: boolean,
  baseUrl: string = "https://api.openai.com/v1",
  quality: "low" | "medium" | "high" = "low",
): Promise<void> {
  const response = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt,
      n: 1,
      size: isVertical ? "1024x1536" : "1536x1024",
      quality,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Image generation error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  const b64 = data.data[0].b64_json;
  if (b64) {
    fs.writeFileSync(outputPath, Buffer.from(b64, "base64"));
  } else if (data.data[0].url) {
    const imgRes = await fetch(data.data[0].url);
    fs.writeFileSync(outputPath, Buffer.from(await imgRes.arrayBuffer()));
  }
}

async function generateImage(
  prompt: string,
  outputPath: string,
  apiKey: string,
  isVertical: boolean,
  baseUrl: string = "https://api.openai.com/v1",
  quality: "low" | "medium" | "high" = "low",
): Promise<void> {
  try {
    await generateImageGemini(prompt, outputPath, isVertical);
  } catch (e) {
    console.warn("Gemini image generation failed, falling back to OpenAI:", (e as Error).message);
    await generateImageOpenAI(prompt, outputPath, apiKey, isVertical, baseUrl, quality);
  }
}

async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-i", filePath,
      "-show_entries", "format=duration",
      "-v", "quiet",
      "-of", "csv=p=0",
    ]);
    return parseFloat(stdout.trim()) || 10;
  } catch {
    return 10;
  }
}

function sanitizeForFFmpeg(text: string): string {
  return text
    .replace(/\n/g, " ")
    .replace(/\r/g, "")
    .replace(/'/g, "\u2019")
    .replace(/"/g, "\u201D")
    .replace(/\\/g, "")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/%/g, "%%");
}

function splitNarrationToSubtitles(narration: string, totalDuration: number, isVertical: boolean = false): Array<{ text: string; start: number; end: number }> {
  const maxCharsPerLine = isVertical ? 12 : 20;

  const sentences = narration
    .replace(/([.!?。！？])\s*/g, "$1\n")
    .split("\n")
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (sentences.length === 0) return [{ text: narration, start: 0, end: totalDuration }];

  const totalChars = sentences.reduce((sum, s) => sum + s.length, 0);
  const subtitles: Array<{ text: string; start: number; end: number }> = [];
  let currentTime = 0;

  for (let i = 0; i < sentences.length; i++) {
    const proportion = sentences[i].length / totalChars;
    const duration = proportion * totalDuration;
    const sentence = sentences[i];

    const lines: string[] = [];
    if (sentence.length > maxCharsPerLine) {
      let remaining = sentence;
      while (remaining.length > maxCharsPerLine) {
        let splitPos = -1;
        const commaPos = remaining.lastIndexOf(",", maxCharsPerLine);
        const spacePos = remaining.lastIndexOf(" ", maxCharsPerLine);
        if (commaPos > maxCharsPerLine * 0.3) {
          splitPos = commaPos + 1;
        } else if (spacePos > maxCharsPerLine * 0.3) {
          splitPos = spacePos;
        } else {
          splitPos = maxCharsPerLine;
        }
        lines.push(remaining.slice(0, splitPos).trim());
        remaining = remaining.slice(splitPos).trim();
      }
      if (remaining.length > 0) lines.push(remaining);
    } else {
      lines.push(sentence);
    }

    const chunkDur = duration / lines.length;
    for (const line of lines) {
      subtitles.push({
        text: line,
        start: currentTime,
        end: currentTime + chunkDur,
      });
      currentTime += chunkDur;
    }
  }

  return subtitles;
}

function whisperSegmentsToSubtitles(segments: WhisperSegment[], isVertical: boolean): Array<{ text: string; start: number; end: number }> {
  const maxCharsPerLine = isVertical ? 12 : 20;
  const result: Array<{ text: string; start: number; end: number }> = [];

  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;

    if (text.length <= maxCharsPerLine) {
      result.push({ text, start: seg.start, end: seg.end });
    } else {
      const segDur = seg.end - seg.start;
      const lines: string[] = [];
      let remaining = text;
      while (remaining.length > maxCharsPerLine) {
        const spacePos = remaining.lastIndexOf(" ", maxCharsPerLine);
        const splitPos = spacePos > maxCharsPerLine * 0.3 ? spacePos : maxCharsPerLine;
        lines.push(remaining.slice(0, splitPos).trim());
        remaining = remaining.slice(splitPos).trim();
      }
      if (remaining.length > 0) lines.push(remaining);
      const lineDur = segDur / lines.length;
      for (let j = 0; j < lines.length; j++) {
        result.push({
          text: lines[j],
          start: seg.start + j * lineDur,
          end: seg.start + (j + 1) * lineDur,
        });
      }
    }
  }
  return result;
}

async function composeSectionVideo(
  imagePath: string,
  audioPath: string,
  outputPath: string,
  audioDuration: number,
  isVertical: boolean,
  narrationText: string,
  whisperSegments?: WhisperSegment[],
): Promise<void> {
  const width = isVertical ? 1080 : 1920;
  const height = isVertical ? 1920 : 1080;
  const totalDur = audioDuration + 1;
  const frames = Math.ceil(totalDur * 30);
  const fontSize = isVertical ? 56 : 46;
  const boxPadding = isVertical ? 16 : 12;
  const subtitleY = isVertical ? "h-h/5" : "h-h/6";

  const fontPath = path.resolve(process.cwd(), "..", "..", "assets", "fonts", "NotoSansCJKkr-Bold.otf");
  const safeFontPath = fontPath.replace(/:/g, "\\:").replace(/\\/g, "/");

  const subtitles = whisperSegments && whisperSegments.length > 0
    ? whisperSegmentsToSubtitles(whisperSegments, isVertical)
    : splitNarrationToSubtitles(narrationText, audioDuration, isVertical);

  let filterComplex =
    `[0:v]scale=${Math.round(width * 1.15)}:${Math.round(height * 1.15)},` +
    `zoompan=z='min(zoom+0.0003,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=30,` +
    `setsar=1,format=yuv420p`;

  for (const sub of subtitles) {
    const safeText = sanitizeForFFmpeg(sub.text);
    const startT = sub.start.toFixed(3);
    const endT = sub.end.toFixed(3);
    filterComplex +=
      `,drawtext=text='${safeText}':fontfile='${safeFontPath}':fontsize=${fontSize}` +
      `:fontcolor=white:borderw=2:bordercolor=black` +
      `:box=1:boxcolor=black@0.6:boxborderw=${boxPadding}` +
      `:x=(w-text_w)/2:y=${subtitleY}` +
      `:enable='between(t\\,${startT}\\,${endT})'`;
  }

  filterComplex += "[vout]";

  await execFileAsync("ffmpeg", [
    "-y",
    "-loop", "1", "-i", imagePath,
    "-i", audioPath,
    "-filter_complex", filterComplex,
    "-map", "[vout]", "-map", "1:a",
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-t", String(totalDur),
    "-shortest",
    outputPath,
  ], { timeout: 120000 });
}

async function overlayTextOnImage(
  inputPath: string,
  outputPath: string,
  text: string,
  isVertical: boolean,
): Promise<void> {
  const fontPath = path.resolve(process.cwd(), "..", "..", "assets", "fonts", "NotoSansCJKkr-Bold.otf");
  const safeFontPath = fontPath.replace(/:/g, "\\:").replace(/\\/g, "/");

  const imgW = isVertical ? 1080 : 1024;
  const imgH = isVertical ? 1920 : 1024;

  const { mainLines, subText } = splitThumbnailText(text);

  const maxTextHeight = imgH * 0.45;
  const lineSpacing = 1.15;
  let mainFontSize = isVertical ? 90 : 80;
  let totalNeeded = mainLines.length * mainFontSize * lineSpacing;
  while (totalNeeded > maxTextHeight && mainFontSize > 40) {
    mainFontSize -= 4;
    totalNeeded = mainLines.length * mainFontSize * lineSpacing;
  }

  const longestLine = Math.max(...mainLines.map(l => l.length));
  const maxFontForWidth = Math.floor((imgW * 0.9) / (longestLine * 0.6));
  mainFontSize = Math.min(mainFontSize, maxFontForWidth);

  const subFontSize = Math.round(mainFontSize * 0.4);
  const lineHeight = Math.round(mainFontSize * lineSpacing);
  const totalMainHeight = mainLines.length * lineHeight;
  const bottomMargin = Math.round(imgH * 0.05);
  const mainStartY = imgH - totalMainHeight - bottomMargin;

  const gradientStart = Math.max(0, mainStartY - (subText ? subFontSize + 30 : 20));
  const gradientRatio = (gradientStart / imgH).toFixed(2);

  const colors = ["#FFFF00", "#FFFFFF", "#FF4444", "#FFFF00"];
  const borderW = Math.max(4, Math.round(mainFontSize * 0.07));

  let filterComplex = `[0:v]drawbox=y=ih*${gradientRatio}:width=iw:height=ih*(1-${gradientRatio}):color=black@0.5:t=fill[bg];[bg]`;

  if (subText) {
    const safeSubText = sanitizeForFFmpeg(subText);
    const subY = mainStartY - subFontSize - 15;
    filterComplex +=
      `drawtext=text='${safeSubText}':fontfile='${safeFontPath}':fontsize=${subFontSize}` +
      `:fontcolor=white:borderw=2:bordercolor=black@0.9` +
      `:shadowcolor=black@0.7:shadowx=2:shadowy=2` +
      `:x=(w-text_w)/2:y=${Math.max(10, subY)},`;
  }

  for (let i = 0; i < mainLines.length; i++) {
    const safeText = sanitizeForFFmpeg(mainLines[i]);
    const yPos = mainStartY + (i * lineHeight);
    const color = colors[i % colors.length];

    filterComplex +=
      `drawtext=text='${safeText}':fontfile='${safeFontPath}':fontsize=${mainFontSize}` +
      `:fontcolor=black:x=(w-text_w)/2+2:y=${yPos}+2,`;

    filterComplex +=
      `drawtext=text='${safeText}':fontfile='${safeFontPath}':fontsize=${mainFontSize}` +
      `:fontcolor=${color}:borderw=${borderW}:bordercolor=black` +
      `:shadowcolor=black@0.9:shadowx=3:shadowy=3` +
      `:x=(w-text_w)/2:y=${yPos}`;

    if (i < mainLines.length - 1) filterComplex += ",";
  }

  await execFileAsync("ffmpeg", [
    "-y",
    "-i", inputPath,
    "-vf", filterComplex || "null",
    outputPath,
  ], { timeout: 30000 });
}

function splitThumbnailText(text: string): { mainLines: string[]; subText: string | null } {
  const parts = text.split(/[—\-|]/);
  let mainText = text;
  let subText: string | null = null;

  if (parts.length >= 2) {
    const first = parts[0].trim();
    const rest = parts.slice(1).join(" ").trim();
    if (first.length <= 15 && rest.length > 0) {
      subText = `"${first}"`;
      mainText = rest;
    } else if (rest.length <= 15 && first.length > 0) {
      subText = `"${rest}"`;
      mainText = first;
    }
  }

  const maxChars = 12;
  const lines: string[] = [];
  let remaining = mainText;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      lines.push(remaining);
      break;
    }
    let splitIdx = maxChars;
    const spaceIdx = remaining.lastIndexOf(" ", maxChars);
    if (spaceIdx > maxChars * 0.3) splitIdx = spaceIdx;
    lines.push(remaining.substring(0, splitIdx).trim());
    remaining = remaining.substring(splitIdx).trim();
  }

  if (lines.length > 3) {
    const merged: string[] = [];
    for (let i = 0; i < lines.length; i += 2) {
      if (i + 1 < lines.length) {
        merged.push(lines[i] + " " + lines[i + 1]);
      } else {
        merged.push(lines[i]);
      }
    }
    return { mainLines: merged.slice(0, 3), subText };
  }

  return { mainLines: lines.slice(0, 3), subText };
}


async function createSubscribeImage(
  outputPath: string,
  isVertical: boolean,
): Promise<void> {
  const w = isVertical ? 1080 : 1920;
  const h = isVertical ? 1920 : 1080;
  const fontPath = path.resolve(process.cwd(), "..", "..", "assets", "fonts", "NotoSansCJKkr-Bold.otf");
  const safeFontPath = fontPath.replace(/:/g, "\\:").replace(/\\/g, "/");

  const bellSize = isVertical ? 120 : 160;
  const bellY = isVertical ? Math.round(h * 0.22) : Math.round(h * 0.12);
  const titleFontSize = isVertical ? 60 : 80;
  const subFontSize = isVertical ? 36 : 48;
  const titleY = bellY + bellSize + 30;
  const subY = titleY + titleFontSize + 20;
  const btnW = isVertical ? 500 : 600;
  const btnH = isVertical ? 80 : 90;
  const btnY = subY + subFontSize + 50;
  const btnX = Math.round((w - btnW) / 2);
  const btnFontSize = isVertical ? 40 : 50;
  const bellBtnW = isVertical ? 420 : 500;
  const bellBtnH = isVertical ? 70 : 80;
  const bellBtnY = btnY + btnH + 25;
  const bellBtnX = Math.round((w - bellBtnW) / 2);
  const bellBtnFontSize = isVertical ? 34 : 44;

  let filterComplex =
    `color=c=#1a1a2e:s=${w}x${h}:d=1[bg];` +
    `[bg]drawbox=x=${Math.round(w/2 - bellSize/2)}:y=${bellY}:w=${bellSize}:h=${bellSize}:color=#FFD700:t=fill,` +
    `drawtext=text='\\🔔':fontsize=${bellSize - 20}:fontcolor=#1a1a2e:x=(w-text_w)/2:y=${bellY + 10},` +
    `drawtext=text='구독과 알림 설정':fontfile='${safeFontPath}':fontsize=${titleFontSize}:fontcolor=#FFFFFF:borderw=3:bordercolor=black:x=(w-text_w)/2:y=${titleY},` +
    `drawtext=text='잊지 마세요!':fontfile='${safeFontPath}':fontsize=${subFontSize}:fontcolor=#AAAAAA:x=(w-text_w)/2:y=${subY},` +
    `drawbox=x=${btnX}:y=${btnY}:w=${btnW}:h=${btnH}:color=#FF0000:t=fill,` +
    `drawtext=text='♥ 구독':fontfile='${safeFontPath}':fontsize=${btnFontSize}:fontcolor=white:borderw=2:bordercolor=#CC0000:x=(w-text_w)/2:y=${btnY + Math.round((btnH - btnFontSize) / 2)},` +
    `drawbox=x=${bellBtnX}:y=${bellBtnY}:w=${bellBtnW}:h=${bellBtnH}:color=#333333:t=fill,` +
    `drawtext=text='🔔 알림 설정':fontfile='${safeFontPath}':fontsize=${bellBtnFontSize}:fontcolor=#FFD700:borderw=2:bordercolor=black:x=(w-text_w)/2:y=${bellBtnY + Math.round((bellBtnH - bellBtnFontSize) / 2)}`;

  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", `color=c=#1a1a2e:s=${w}x${h}:d=1`,
    "-vf",
    `drawbox=x=${Math.round(w/2 - bellSize/2)}:y=${bellY}:w=${bellSize}:h=${bellSize}:color=#FFD700:t=fill,` +
    `drawtext=text='구독과 알림 설정':fontfile='${safeFontPath}':fontsize=${titleFontSize}:fontcolor=#FFFFFF:borderw=3:bordercolor=black:x=(w-text_w)/2:y=${titleY},` +
    `drawtext=text='잊지 마세요!':fontfile='${safeFontPath}':fontsize=${subFontSize}:fontcolor=#AAAAAA:x=(w-text_w)/2:y=${subY},` +
    `drawbox=x=${btnX}:y=${btnY}:w=${btnW}:h=${btnH}:color=#FF0000:t=fill,` +
    `drawtext=text='구독':fontfile='${safeFontPath}':fontsize=${btnFontSize}:fontcolor=white:borderw=2:bordercolor=#CC0000:x=(w-text_w)/2:y=${btnY + Math.round((btnH - btnFontSize) / 2)},` +
    `drawbox=x=${bellBtnX}:y=${bellBtnY}:w=${bellBtnW}:h=${bellBtnH}:color=#333333:t=fill,` +
    `drawtext=text='알림 설정':fontfile='${safeFontPath}':fontsize=${bellBtnFontSize}:fontcolor=#FFD700:borderw=2:bordercolor=black:x=(w-text_w)/2:y=${bellBtnY + Math.round((bellBtnH - bellBtnFontSize) / 2)}`,
    "-frames:v", "1",
    outputPath,
  ], { timeout: 30000 });
}

const SUBSCRIBE_NARRATION = "이 영상을 보면서 로또에 당첨되고 싶다면, 지금 바로 구독과 알림 설정 누르세요! 당첨 확률이 올라간다는 소문이 있습니다.";

async function createSubscribeSectionVideo(
  projectDir: string,
  isVertical: boolean,
  elevenlabsKey: string,
): Promise<string> {
  const subscribeImgPath = path.join(projectDir, "subscribe_img.png");
  const subscribeAudioPath = path.join(projectDir, "subscribe_audio.mp3");
  const subscribeVideoPath = path.join(projectDir, "subscribe_section.mp4");

  await createSubscribeImage(subscribeImgPath, isVertical);
  await generateTTS(SUBSCRIBE_NARRATION, subscribeAudioPath, elevenlabsKey);

  const audioDuration = await getAudioDuration(subscribeAudioPath);

  await composeSectionVideo(
    subscribeImgPath,
    subscribeAudioPath,
    subscribeVideoPath,
    audioDuration,
    isVertical,
    SUBSCRIBE_NARRATION,
  );

  return subscribeVideoPath;
}

async function concatenateVideos(
  videoPaths: string[],
  outputPath: string,
): Promise<void> {
  const listPath = outputPath.replace(".mp4", "_list.txt");
  const listContent = videoPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(listPath, listContent);

  try {
    await execFileAsync("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0",
      "-i", listPath,
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      outputPath,
    ], { timeout: 600000 });
  } finally {
    if (fs.existsSync(listPath)) fs.unlinkSync(listPath);
  }
}

export async function generateVideo(
  projectId: number,
  project: Project,
  settingsMap: Record<string, string>,
): Promise<void> {
  const projectDir = path.join(OUTPUT_DIR, `project_${projectId}`);
  if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

  const openaiKey = settingsMap.OPENAI_API_KEY;
  const openaiBaseUrl = settingsMap.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const elevenlabsKey = settingsMap.ELEVENLABS_API_KEY;
  const isVertical = project.videoType === "shorts";

  try {
    let commentAnalysis = "";
    const youtubeApiKey = settingsMap.YOUTUBE_API_KEY;
    if (project.referenceUrl && youtubeApiKey) {
      await updateProgress(projectId, 2, "레퍼런스 영상 댓글 분석 중...");
      try {
        const comments = await fetchYouTubeComments(project.referenceUrl, youtubeApiKey);
        if (comments.length > 0) {
          commentAnalysis = await analyzeComments(comments, project.topic, openaiKey, openaiBaseUrl);
          console.log(`댓글 ${comments.length}개 분석 완료`);
        }
      } catch (e) {
        console.warn("댓글 분석 실패, 건너뜀:", e);
      }
    }

    let referenceStyleDesc = "";
    if (project.referenceImageUrl) {
      const refImgPath = path.join(OUTPUT_DIR, project.referenceImageUrl.replace("/files/", ""));
      if (fs.existsSync(refImgPath)) {
        await updateProgress(projectId, 3, "참조 이미지 스타일 분석 중...");
        try {
          referenceStyleDesc = await analyzeReferenceImage(refImgPath, openaiKey, openaiBaseUrl);
          console.log("참조 이미지 스타일 분석 완료:", referenceStyleDesc.substring(0, 100));
        } catch (e) {
          console.warn("참조 이미지 분석 실패, 건너뜀:", e);
        }
      }
    }

    await updateProgress(projectId, 5, "AI 대본 생성 중...");
    const script = await generateScript(
      project.topic,
      project.videoType,
      project.duration,
      project.tone,
      project.visualStyle,
      project.referenceUrl,
      openaiKey,
      openaiBaseUrl,
      commentAnalysis,
      referenceStyleDesc,
    );

    await db.update(projects).set({
      scriptJson: script as any,
      title: script.title || project.title,
      progress: 15,
      progressMessage: "대본 생성 완료. TTS 음성 생성 중...",
      updatedAt: new Date(),
    }).where(eq(projects.id, projectId));

    const sectionVideos: string[] = [];
    const insertSubscribeAfter = !isShorts ? Math.floor(script.sections.length / 2) - 1 : -1;

    for (let i = 0; i < script.sections.length; i++) {
      const section = script.sections[i];
      const pctBase = 15 + ((i / script.sections.length) * 70);

      await updateProgress(projectId, Math.round(pctBase), `섹션 ${i + 1}/${script.sections.length}: TTS 생성 중...`);
      const audioPath = path.join(projectDir, `audio_${i}.mp3`);
      await generateTTS(section.narration, audioPath, elevenlabsKey);

      const audioDuration = await getAudioDuration(audioPath);

      await updateProgress(projectId, Math.round(pctBase + 5), `섹션 ${i + 1}/${script.sections.length}: 자막 타이밍 분석 중...`);
      let whisperSegments: WhisperSegment[] = [];
      try {
        whisperSegments = await transcribeWithWhisper(audioPath, openaiKey, openaiBaseUrl);
      } catch (e) {
        console.warn(`Whisper failed for section ${i}, using estimation:`, e);
      }

      await updateProgress(projectId, Math.round(pctBase + 10), `섹션 ${i + 1}/${script.sections.length}: 이미지 생성 중...`);
      const imagePath = path.join(projectDir, `image_${i}.png`);
      try {
        await generateImage(section.imagePrompt, imagePath, openaiKey, isVertical, openaiBaseUrl);
      } catch (imgErr: any) {
        console.warn(`이미지 생성 실패 (섹션 ${i + 1}), 기본 이미지 사용:`, imgErr.message);
        const { createCanvas } = await import("canvas").catch(() => ({ createCanvas: null }));
        if (createCanvas) {
          const w = isVertical ? 1080 : 1920;
          const h = isVertical ? 1920 : 1080;
          const cvs = createCanvas(w, h);
          const ctx = cvs.getContext("2d");
          ctx.fillStyle = "#1a1a2e";
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = "#e0e0e0";
          ctx.font = `bold ${isVertical ? 48 : 64}px sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(`섹션 ${i + 1}`, w / 2, h / 2);
          fs.writeFileSync(imagePath, cvs.toBuffer("image/png"));
        } else {
          const placeholderBuf = Buffer.alloc(100, 0);
          fs.writeFileSync(imagePath, placeholderBuf);
        }
      }

      await updateProgress(projectId, Math.round(pctBase + 20), `섹션 ${i + 1}/${script.sections.length}: 영상 합성 중...`);
      const sectionPath = path.join(projectDir, `section_${i}.mp4`);
      await composeSectionVideo(imagePath, audioPath, sectionPath, audioDuration, isVertical, section.narration, whisperSegments);

      sectionVideos.push(sectionPath);

      if (i === insertSubscribeAfter) {
        await updateProgress(projectId, Math.round(pctBase + 25), "구독 유도 섹션 생성 중...");
        try {
          const subscribeVideoPath = await createSubscribeSectionVideo(projectDir, isVertical, elevenlabsKey);
          sectionVideos.push(subscribeVideoPath);
          console.log("구독 유도 섹션 삽입 완료");
        } catch (subErr: any) {
          console.warn("구독 유도 섹션 생성 실패, 건너뜀:", subErr.message);
        }
      }
    }

    await updateProgress(projectId, 88, "섹션 합치는 중...");
    const finalPath = path.join(projectDir, `final_${projectId}.mp4`);
    await concatenateVideos(sectionVideos, finalPath);

    await updateProgress(projectId, 95, "썸네일 생성 중...");
    const thumbPath = path.join(projectDir, `thumbnail_${projectId}.png`);
    try {
      const thumbRawPath = path.join(projectDir, `thumbnail_raw_${projectId}.png`);
      await generateImage(script.thumbnailPrompt, thumbRawPath, openaiKey, false, openaiBaseUrl, "medium");
      await overlayTextOnImage(thumbRawPath, thumbPath, script.thumbnailText || script.title, false);
    } catch (e) {
      console.warn("Thumbnail generation failed, skipping:", e);
    }

    const relativeVideoPath = `/files/project_${projectId}/final_${projectId}.mp4`;
    const relativeThumbnailPath = fs.existsSync(thumbPath)
      ? `/files/project_${projectId}/thumbnail_${projectId}.png`
      : null;

    await db.update(projects).set({
      status: "completed",
      progress: 100,
      progressMessage: "완료!",
      videoUrl: relativeVideoPath,
      thumbnailUrl: relativeThumbnailPath,
      updatedAt: new Date(),
    }).where(eq(projects.id, projectId));

  } catch (err: any) {
    console.error("Pipeline error:", err);
    let koreanError = err.message || "영상 생성에 실패했습니다";
    if (koreanError.includes("moderation_blocked") || koreanError.includes("safety system")) {
      koreanError = "이미지 생성이 안전 정책에 의해 차단되었습니다. 다른 주제나 프롬프트로 다시 시도해주세요.";
    } else if (koreanError.includes("rate limit") || koreanError.includes("429")) {
      koreanError = "API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.";
    } else if (koreanError.includes("insufficient_quota") || koreanError.includes("billing")) {
      koreanError = "API 크레딧이 부족합니다. 설정에서 API 키를 확인해주세요.";
    } else if (koreanError.includes("Invalid API Key") || koreanError.includes("401")) {
      koreanError = "API 키가 유효하지 않습니다. 설정에서 올바른 키를 입력해주세요.";
    }
    await db.update(projects).set({
      status: "error",
      errorMessage: koreanError,
      updatedAt: new Date(),
    }).where(eq(projects.id, projectId));
  }
}
