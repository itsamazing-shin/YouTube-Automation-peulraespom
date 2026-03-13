import { db } from "@workspace/db";
import { projects, settings } from "@workspace/db/schema";
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
      let logoFilePath: string | undefined;
      const [logoRow] = await db.select().from(settings).where(eq(settings.key, "CHANNEL_LOGO"));
      if (logoRow?.value) {
        const lp = path.join(OUTPUT_DIR, logoRow.value.replace("/files/", ""));
        if (fs.existsSync(lp)) logoFilePath = lp;
      }
      await overlayTextOnImage(thumbRawPath, thumbPath, thumbnailText, false, logoFilePath);
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

async function searchLatestNews(
  topic: string,
  apiKey: string,
  baseUrl: string = "https://api.openai.com/v1",
): Promise<string> {
  try {
    const today = new Date();
    const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;

    const responsesUrl = baseUrl.replace(/\/v1\/?$/, "/v1/responses");

    const response = await fetch(responsesUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        tools: [{ type: "web_search_preview" }],
        input: `오늘은 ${dateStr}입니다. "${topic}" 관련 최신 뉴스와 이슈를 검색해서 정리해주세요.

반드시 지켜야 할 규칙:
- 최근 1~3개월 이내의 가장 핫한 뉴스와 사건만 정리
- 구체적인 날짜, 수치, 관련 인물/국가를 포함
- 현재 진행 중이거나 최근 발생한 이슈 중심
- 오래된 과거 사건은 제외
- 500자 이내로 핵심만 간결하게 정리
- 한국어로 작성`,
      }),
    });

    if (!response.ok) {
      console.warn("Responses API 실패, Chat Completions 폴백 시도");
      const fallbackResponse = await fetch(`${baseUrl}/chat/completions`, {
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
              content: `오늘은 ${dateStr}입니다. 당신은 최신 뉴스 리서처입니다. 주어진 주제에 대해 가장 최근의 뉴스, 이슈, 사건을 정리해주세요.
반드시 2024년~2026년 사이의 최신 사건을 중심으로 작성하세요.
오래된 과거 사건이 아닌, 현재 진행 중이거나 최근에 발생한 이슈를 다루세요.
구체적인 날짜, 수치, 관련 인물/국가를 포함하세요.
500자 이내로 핵심만 정리하세요.`,
            },
            {
              role: "user",
              content: `"${topic}" 관련 최신 뉴스와 이슈를 정리해주세요. 특히 최근 1~3개월 이내의 가장 핫한 이슈를 중심으로 알려주세요.`,
            },
          ],
          temperature: 0.3,
          max_tokens: 800,
        }),
      });

      if (!fallbackResponse.ok) return "";
      const fallbackData = await fallbackResponse.json();
      return fallbackData.choices?.[0]?.message?.content || "";
    }

    const data = await response.json();

    let newsContent = "";
    if (data.output) {
      for (const item of data.output) {
        if (item.type === "message" && item.content) {
          for (const c of item.content) {
            if (c.type === "output_text") {
              newsContent += c.text;
            }
          }
        }
      }
    }

    if (!newsContent && data.choices?.[0]?.message?.content) {
      newsContent = data.choices[0].message.content;
    }

    console.log("최신 뉴스 검색 결과:", newsContent.substring(0, 200));
    return newsContent;
  } catch (e) {
    console.warn("최신 뉴스 검색 실패:", e);
    return "";
  }
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
  latestNewsContext: string = "",
): Promise<VideoScript> {
  const isShorts = videoType === "shorts";

  const sectionCount = isShorts ? 3 : duration === "1min" ? 4 : duration === "5min" ? 8 : duration === "10min" ? 12 : 16;

  const narrationGuide = isShorts
    ? "반드시 2~3문장, 총 50~80자. 짧고 임팩트 있게."
    : duration === "1min"
    ? "반드시 3~5문장, 총 80~150자."
    : duration === "5min"
    ? "반드시 6~10문장, 총 200~350자. 구체적 사례와 수치를 포함하여 풍부하게 서술."
    : duration === "10min"
    ? "반드시 10~15문장, 총 350~500자. 깊이 있는 분석과 구체적 사례, 배경 설명, 수치, 전문가 의견 등을 포함하여 매우 풍부하고 상세하게 서술. 하나의 소주제를 충분히 깊게 파고들어야 합니다."
    : "반드시 10~15문장, 총 350~500자. 깊이 있는 분석과 구체적 사례, 배경 설명, 수치, 전문가 의견 등을 포함하여 매우 풍부하고 상세하게 서술. 하나의 소주제를 충분히 깊게 파고들어야 합니다.";

  const targetDurationPerSection = isShorts ? 15 : duration === "1min" ? 15 : duration === "5min" ? 35 : duration === "10min" ? 50 : 55;

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

  const totalTargetSeconds = isShorts ? 60 : duration === "1min" ? 60 : duration === "5min" ? 300 : duration === "10min" ? 600 : 900;
  const totalTargetMin = Math.round(totalTargetSeconds / 60);

  const systemPrompt = `당신은 한국 유튜브 조회수 폭발 전문 대본 작가입니다. ${toneMap[tone] || toneMap.calm} 스타일로 대본을 작성합니다.
${isShorts ? "쇼츠 영상이므로 첫 문장부터 강렬한 후킹으로 시작하세요. 짧고 임팩트 있는 문장을 사용하고, 긴박감과 호기심을 유발하세요." : ""}

⏱️ 영상 총 목표 길이: 약 ${totalTargetMin}분 (${totalTargetSeconds}초)
- 총 ${sectionCount}개 섹션, 섹션당 약 ${targetDurationPerSection}초씩
- 한국어 TTS는 약 1초에 5~6자를 읽으므로, 섹션당 나레이션은 최소 ${Math.round(targetDurationPerSection * 5)}자 이상 필요합니다
- 나레이션이 짧으면 영상이 목표 길이보다 훨씬 짧아지니 반드시 충분한 분량을 작성하세요
- ${narrationGuide}

🔥 제목 & 썸네일 텍스트 작성 핵심 규칙:
- title: 유튜브 검색/추천에 노출될 전체 제목 (20~40자). 큰따옴표로 핵심 문구를 감싸서 강조. 예: "중국 경제 완전 붕괴" 14억 대륙의 충격적 최후
- thumbnailText: 썸네일 이미지 위에 표시될 2줄 후킹 문구. 반드시 \\n으로 줄바꿈하여 2줄로 작성. 각 줄 8~12자. 윗줄=노란색, 아랫줄=흰색. 예시:
  * "중국 경제\n완전 붕괴"
  * "일본 국채 위기\n충격적 최후"
  * "천궁-II 96%\n요격 성공"
  * "14억 대륙\n파멸의 최후"
  * "트럼프의 소름\n돋는 실체"
- 핵심: 위기감, 충격, 긴박감, 궁금증을 자극하는 단어 사용. "폭락", "붕괴", "충격", "미친", "실체", "최후", "끝났다" 등

🖼️ 썸네일 이미지 프롬프트 핵심 규칙:
- thumbnailPrompt는 영상 주제를 직접적으로 보여주는 구체적 장면을 영어로 작성
- 주제와 관련 없는 일반적인 사람 얼굴이나 표정만으로 구성하지 말 것
- 예시: "호르무즈 해협 봉쇄" → 해협을 막는 군함과 불타는 유조선 장면, "중국 경제 붕괴" → 무너지는 중국 도시 건물과 하락 화살표
- 주제의 핵심 키워드를 시각적 요소로 변환하여 보는 사람이 즉시 무슨 주제인지 알 수 있어야 함
- 텍스트/글자는 절대 포함하지 말 것 — 텍스트는 나중에 별도로 오버레이됨

매번 완전히 새로운 시각과 독창적인 구성으로 대본을 작성하세요. 같은 주제라도 이전과 다른 앵글, 다른 예시, 다른 스토리라인으로 접근하세요. 뻔한 서론 대신 의외의 사실이나 충격적인 통계로 시작하세요.
반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.`;

  const userPrompt = `주제: "${topic}"
${latestNewsContext ? `\n📰 최신 뉴스/이슈 (반드시 이 내용을 기반으로 대본을 작성하세요!):\n${latestNewsContext}\n\n⚠️ 위 최신 뉴스를 대본의 핵심 내용으로 사용하세요. 오래된 과거 사건이 아닌, 위에 정리된 최신 이슈를 중심으로 대본을 구성해야 합니다. 구체적인 날짜, 수치, 최근 사건을 반드시 포함하세요.\n` : ""}
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
  "thumbnailText": "썸네일 후킹 문구를 반드시 2줄로 작성. 줄바꿈은 \\n으로 구분. 각 줄 8~12자. 예: '중국 경제\\n완전 붕괴', '14억 대륙\\n파멸의 최후', '트럼프의 소름\\n돋는 실체'. 윗줄은 노란색, 아랫줄은 흰색으로 표시됨",
  "sections": [
    {
      "narration": "나레이션 텍스트 (${narrationGuide})",
      "imagePrompt": "English-only image prompt for this scene. CRITICAL: Do NOT include ANY text, letters, words, signs, labels, speech bubbles with text, or writing of ANY language in the image. The image must be purely visual with ZERO text elements. Leave empty speech bubbles or blank signs if needed — text will be added separately. Style: ${styleMap[visualStyle] || styleMap.cinematic}",
      "subtitleHighlight": "핵심 자막 (짧은 문구)",
      "duration": ${targetDurationPerSection}
    }
  ],
  "thumbnailPrompt": "이 필드에 영상 주제에 딱 맞는 구체적인 썸네일 이미지 프롬프트를 영어로 작성하세요. 반드시 지켜야 할 규칙: 1) 영상 주제의 핵심 내용을 시각적으로 보여주는 구체적 장면을 묘사 (예: 호르무즈 해협 봉쇄 → 해협을 막고 있는 전함과 불타는 유조선, 중국 경제 붕괴 → 무너지는 중국 도시 스카이라인과 하락하는 그래프를 형상화한 배경). 2) 단순히 사람 얼굴만 넣지 말 것 — 주제를 상징하는 배경/소품/상황이 반드시 포함되어야 함. 3) 텍스트/글자/문자 절대 포함하지 말 것. 4) 고대비 채도 높은 색상, 빨강/노랑/주황 강조. 5) 구도: 주요 피사체를 오른쪽에, 왼쪽 40%는 텍스트 오버레이 공간으로 비워둘 것. 6) 긴박감 있는 줌인 효과. Style: MrBeast/한국 탑 유튜버 썸네일 퀄리티."
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
  voiceId: string = "pNInz6obpgDQGcFmaJgB",
): Promise<void> {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
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

async function fetchPexelsImages(
  query: string,
  count: number,
  outputDir: string,
  prefix: string,
  pexelsApiKey: string,
  isVertical: boolean = false,
): Promise<string[]> {
  if (!pexelsApiKey) return [];
  const orientation = isVertical ? "portrait" : "landscape";
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count * 2}&orientation=${orientation}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: pexelsApiKey },
    });
    if (!res.ok) {
      console.warn(`Pexels API error: ${res.status}`);
      return [];
    }
    const data: any = await res.json();
    const photos = data.photos || [];
    const downloaded: string[] = [];

    for (let i = 0; i < Math.min(count, photos.length); i++) {
      const photo = photos[i];
      const imgUrl = isVertical ? (photo.src.portrait || photo.src.large) : (photo.src.landscape || photo.src.large);
      try {
        const imgRes = await fetch(imgUrl);
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          const outPath = path.join(outputDir, `${prefix}_pexels_${i}.jpg`);
          fs.writeFileSync(outPath, buf);
          downloaded.push(outPath);
        }
      } catch (e) {
        console.warn(`Pexels image download failed:`, e);
      }
    }
    return downloaded;
  } catch (e) {
    console.warn("Pexels fetch failed:", e);
    return [];
  }
}

async function extractPexelsKeyword(
  narration: string,
  apiKey: string,
  baseUrl: string = "https://api.openai.com/v1",
): Promise<string> {
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "주어진 한국어 나레이션의 핵심 주제를 Pexels 이미지 검색에 적합한 영어 키워드 1~3개로 변환하세요. 키워드만 출력하세요. 예: 'economy crisis', 'military ship ocean', 'stock market crash'" },
          { role: "user", content: narration.slice(0, 200) },
        ],
        max_tokens: 20,
        temperature: 0.3,
      }),
    });
    if (!res.ok) return "";
    const data: any = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || "";
  } catch {
    return "";
  }
}

async function composeMultiImageSectionVideo(
  imagePaths: string[],
  audioPath: string,
  outputPath: string,
  audioDuration: number,
  isVertical: boolean,
  narrationText: string,
  whisperSegments?: WhisperSegment[],
  logoPath?: string,
): Promise<void> {
  if (imagePaths.length <= 1) {
    return composeSectionVideo(imagePaths[0], audioPath, outputPath, audioDuration, isVertical, narrationText, whisperSegments, logoPath);
  }

  const width = isVertical ? 1080 : 1920;
  const height = isVertical ? 1920 : 1080;
  const totalDur = audioDuration + 1;
  const fontSize = isVertical ? 72 : 62;
  const boxPadding = isVertical ? 20 : 16;
  const subtitleY = isVertical ? "h-h/5" : "h-h/6";
  const fontPath = path.resolve(process.cwd(), "..", "..", "assets", "fonts", "NotoSansCJKkr-Bold.otf");
  const safeFontPath = fontPath.replace(/:/g, "\\:").replace(/\\/g, "/");

  const subtitles = whisperSegments && whisperSegments.length > 0
    ? whisperSegmentsToSubtitles(whisperSegments, isVertical)
    : splitNarrationToSubtitles(narrationText, audioDuration, isVertical);

  const hasLogo = logoPath && fs.existsSync(logoPath);
  const logoSize = isVertical ? 160 : 200;
  const imgCount = imagePaths.length;
  const clipDur = totalDur / imgCount;

  const inputs: string[] = ["-y"];
  for (const img of imagePaths) {
    inputs.push("-loop", "1", "-t", clipDur.toFixed(3), "-i", img);
  }
  inputs.push("-i", audioPath);
  if (hasLogo) inputs.push("-i", logoPath!);

  const audioIdx = imgCount;
  const logoIdx = hasLogo ? imgCount + 1 : -1;

  let filterParts: string[] = [];
  for (let i = 0; i < imgCount; i++) {
    filterParts.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
      `setsar=1,format=yuv420p,fps=24[clip${i}]`
    );
  }

  const concatInputs = imagePaths.map((_, i) => `[clip${i}]`).join("");
  filterParts.push(`${concatInputs}concat=n=${imgCount}:v=1:a=0[merged]`);

  let lastLabel = "[merged]";
  if (hasLogo) {
    filterParts.push(`[${logoIdx}:v]scale=${logoSize}:${logoSize}:force_original_aspect_ratio=decrease,format=rgba[logo]`);
    filterParts.push(`${lastLabel}[logo]overlay=15:15[withlogo]`);
    lastLabel = "[withlogo]";
  }

  let subtitleFilter = "";
  for (const sub of subtitles) {
    const safeText = sanitizeForFFmpeg(sub.text);
    const startT = sub.start.toFixed(3);
    const endT = sub.end.toFixed(3);
    subtitleFilter +=
      `,drawtext=text='${safeText}':fontfile='${safeFontPath}':fontsize=${fontSize}` +
      `:fontcolor=white:borderw=3:bordercolor=black` +
      `:box=1:boxcolor=black@0.6:boxborderw=${boxPadding}` +
      `:x=(w-text_w)/2:y=${subtitleY}` +
      `:enable='between(t\\,${startT}\\,${endT})'`;
  }

  if (subtitleFilter) {
    filterParts.push(`${lastLabel}${subtitleFilter.slice(1)}[vout]`);
  } else {
    filterParts.push(`${lastLabel}copy[vout]`);
  }

  const filterComplex = filterParts.join(";");

  await execFileAsync("ffmpeg", [
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", "[vout]", "-map", `${audioIdx}:a`,
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
    "-r", "24",
    "-c:a", "aac", "-b:a", "128k",
    "-t", String(totalDur),
    "-shortest",
    "-threads", "2",
    outputPath,
  ], { timeout: 300000 });
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
  logoPath?: string,
): Promise<void> {
  const width = isVertical ? 1080 : 1920;
  const height = isVertical ? 1920 : 1080;
  const totalDur = audioDuration + 1;
  const fontSize = isVertical ? 72 : 62;
  const boxPadding = isVertical ? 20 : 16;
  const subtitleY = isVertical ? "h-h/5" : "h-h/6";

  const fontPath = path.resolve(process.cwd(), "..", "..", "assets", "fonts", "NotoSansCJKkr-Bold.otf");
  const safeFontPath = fontPath.replace(/:/g, "\\:").replace(/\\/g, "/");

  const subtitles = whisperSegments && whisperSegments.length > 0
    ? whisperSegmentsToSubtitles(whisperSegments, isVertical)
    : splitNarrationToSubtitles(narrationText, audioDuration, isVertical);

  const hasLogo = logoPath && fs.existsSync(logoPath);
  const logoSize = isVertical ? 160 : 200;

  let filterComplex =
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
    `setsar=1,format=yuv420p`;

  if (hasLogo) {
    filterComplex += `[scene];[2:v]scale=${logoSize}:${logoSize}:force_original_aspect_ratio=decrease,format=rgba[logo];[scene][logo]overlay=15:15`;
  }

  for (const sub of subtitles) {
    const safeText = sanitizeForFFmpeg(sub.text);
    const startT = sub.start.toFixed(3);
    const endT = sub.end.toFixed(3);
    filterComplex +=
      `,drawtext=text='${safeText}':fontfile='${safeFontPath}':fontsize=${fontSize}` +
      `:fontcolor=white:borderw=3:bordercolor=black` +
      `:box=1:boxcolor=black@0.6:boxborderw=${boxPadding}` +
      `:x=(w-text_w)/2:y=${subtitleY}` +
      `:enable='between(t\\,${startT}\\,${endT})'`;
  }

  filterComplex += "[vout]";

  const inputs = [
    "-y",
    "-loop", "1", "-framerate", "24", "-i", imagePath,
    "-i", audioPath,
  ];
  if (hasLogo) {
    inputs.push("-i", logoPath!);
  }

  await execFileAsync("ffmpeg", [
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", "[vout]", "-map", "1:a",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
    "-r", "24",
    "-c:a", "aac", "-b:a", "128k",
    "-t", String(totalDur),
    "-shortest",
    "-threads", "2",
    outputPath,
  ], { timeout: 300000 });
}

async function overlayTextOnImage(
  inputPath: string,
  outputPath: string,
  text: string,
  isVertical: boolean,
  logoPath?: string,
): Promise<void> {
  const fontPath = path.resolve(process.cwd(), "..", "..", "assets", "fonts", "NotoSansCJKkr-Bold.otf");
  const safeFontPath = fontPath.replace(/:/g, "\\:").replace(/\\/g, "/");

  const { line1, line2 } = splitThumbnailTwoLines(text);
  const line1FontSize = isVertical ? 100 : 120;
  const line2FontSize = isVertical ? 85 : 100;
  const borderW1 = Math.max(8, Math.round(line1FontSize * 0.1));
  const borderW2 = Math.max(7, Math.round(line2FontSize * 0.1));
  const line2LineHeight = Math.round(line2FontSize * 1.25);
  const line1LineHeight = Math.round(line1FontSize * 1.25);
  const bottomMargin = isVertical ? 100 : 70;
  const line2Y = `h-${bottomMargin}`;
  const line1Y = `h-${bottomMargin + line2LineHeight + 10}`;
  const gradientH = bottomMargin + line2LineHeight + line1LineHeight + 80;

  const hasLogo = logoPath && fs.existsSync(logoPath);
  const logoW = isVertical ? 180 : 220;
  const logoH = isVertical ? 140 : 170;

  const safeLine1 = sanitizeForFFmpeg(line1);
  const safeLine2 = sanitizeForFFmpeg(line2);

  let inputs = ["-y", "-i", inputPath];
  let filterParts: string[] = [];

  const textFilters =
    `drawtext=text='${safeLine1}':fontfile='${safeFontPath}':fontsize=${line1FontSize}` +
    `:fontcolor=black:x=(w-text_w)/2+4:y=${line1Y}+4,` +
    `drawtext=text='${safeLine1}':fontfile='${safeFontPath}':fontsize=${line1FontSize}` +
    `:fontcolor=#FFFF00:borderw=${borderW1}:bordercolor=black` +
    `:shadowcolor=black@0.9:shadowx=4:shadowy=4` +
    `:x=(w-text_w)/2:y=${line1Y},` +
    `drawtext=text='${safeLine2}':fontfile='${safeFontPath}':fontsize=${line2FontSize}` +
    `:fontcolor=black:x=(w-text_w)/2+3:y=${line2Y}+3,` +
    `drawtext=text='${safeLine2}':fontfile='${safeFontPath}':fontsize=${line2FontSize}` +
    `:fontcolor=#FFFFFF:borderw=${borderW2}:bordercolor=black` +
    `:shadowcolor=black@0.9:shadowx=3:shadowy=3` +
    `:x=(w-text_w)/2:y=${line2Y}`;

  if (hasLogo) {
    inputs.push("-i", logoPath!);
    filterParts.push(
      `[1:v]scale=${logoW}:-1:force_original_aspect_ratio=decrease[logo]`,
      `[0:v]drawbox=y=ih-${gradientH}:width=iw:height=${gradientH}:color=black@0.55:t=fill[bg]`,
      `[bg][logo]overlay=20:20:format=auto[withlogo]`,
      `[withlogo]${textFilters}`,
    );
  } else {
    filterParts.push(
      `[0:v]drawbox=y=ih-${gradientH}:width=iw:height=${gradientH}:color=black@0.55:t=fill,` +
      textFilters,
    );
  }

  const filterComplex = filterParts.join(";");

  await execFileAsync("ffmpeg", [
    ...inputs,
    hasLogo ? "-filter_complex" : "-vf", filterComplex,
    outputPath,
  ], { timeout: 30000 });
}

function splitThumbnailTwoLines(text: string): { line1: string; line2: string } {
  const cleaned = text.replace(/"/g, "").trim();

  const nlIdx = cleaned.indexOf("\n");
  if (nlIdx > 0) {
    return {
      line1: cleaned.substring(0, nlIdx).trim(),
      line2: cleaned.substring(nlIdx + 1).trim(),
    };
  }

  if (cleaned.length <= 10) {
    return { line1: cleaned, line2: "" };
  }

  const mid = Math.ceil(cleaned.length / 2);
  let splitAt = mid;
  const spaceLeft = cleaned.lastIndexOf(" ", mid);
  const spaceRight = cleaned.indexOf(" ", mid);
  if (spaceLeft > cleaned.length * 0.25) {
    splitAt = spaceLeft;
  } else if (spaceRight > 0 && spaceRight < cleaned.length * 0.75) {
    splitAt = spaceRight;
  }

  return {
    line1: cleaned.substring(0, splitAt).trim(),
    line2: cleaned.substring(splitAt).trim(),
  };
}


async function createSubscribeImage(
  outputPath: string,
  isVertical: boolean,
  openaiKey: string,
  openaiBaseUrl: string = "https://api.openai.com/v1",
): Promise<void> {
  const prompt = isVertical
    ? "A vibrant, eye-catching YouTube subscribe and notification bell graphic. Dark gradient background. Center: a large glowing golden bell icon with sparkle effects. Below: a big red YouTube subscribe button with white play icon, and a bell icon with 'ON' indicator. Modern neon glow style, professional YouTube channel art. Energetic and exciting mood with particle effects. Vertical 9:16 format. NO text, NO letters, NO words anywhere in the image."
    : "A vibrant, eye-catching YouTube subscribe and notification bell graphic. Dark gradient background (dark blue to black). Center composition: a large glowing golden notification bell with sparkle/particle effects on the left, and a big red YouTube subscribe button with white play triangle icon on the right. Modern neon glow style, professional YouTube channel art quality. Energetic and exciting mood with light rays and bokeh effects. Horizontal 16:9 format. NO text, NO letters, NO words anywhere in the image.";

  try {
    await generateImageOpenAI(prompt, outputPath, openaiKey, isVertical, openaiBaseUrl, "low");
  } catch (e) {
    console.warn("AI subscribe image failed, using fallback:", e);
    const w = isVertical ? 1080 : 1920;
    const h = isVertical ? 1920 : 1080;
    const { createCanvas } = await import("canvas").catch(() => ({ createCanvas: null }));
    if (createCanvas) {
      const cvs = createCanvas(w, h);
      const ctx = cvs.getContext("2d");
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#0a0a2e");
      grad.addColorStop(1, "#1a0a3e");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#FF0000";
      const btnW = 300, btnH = 80;
      ctx.fillRect(w / 2 - btnW / 2, h / 2 - btnH / 2, btnW, btnH);
      ctx.fillStyle = "#FFD700";
      ctx.font = "bold 120px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("\u{1F514}", w / 2, h / 2 - 100);
      fs.writeFileSync(outputPath, cvs.toBuffer("image/png"));
    }
  }
}

const SUBSCRIBE_NARRATION = "이 영상을 보면서 로또에 당첨되고 싶다면, 지금 바로 구독과 알림 설정 누르세요! 당첨 확률이 올라간다는 소문이 있습니다.";

async function createSubscribeSectionVideo(
  projectDir: string,
  isVertical: boolean,
  elevenlabsKey: string,
  openaiKey: string,
  openaiBaseUrl: string = "https://api.openai.com/v1",
  logoPath?: string,
  voiceId: string = "pNInz6obpgDQGcFmaJgB",
): Promise<string> {
  const subscribeImgPath = path.join(projectDir, "subscribe_img.png");
  const subscribeAudioPath = path.join(projectDir, "subscribe_audio.mp3");
  const subscribeVideoPath = path.join(projectDir, "subscribe_section.mp4");

  await createSubscribeImage(subscribeImgPath, isVertical, openaiKey, openaiBaseUrl);
  await generateTTS(SUBSCRIBE_NARRATION, subscribeAudioPath, elevenlabsKey, voiceId);

  const audioDuration = await getAudioDuration(subscribeAudioPath);

  await composeSectionVideo(
    subscribeImgPath,
    subscribeAudioPath,
    subscribeVideoPath,
    audioDuration,
    isVertical,
    SUBSCRIBE_NARRATION,
    undefined,
    logoPath,
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
      "-c", "copy",
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
  const elevenlabsVoiceId = settingsMap.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB";
  const isVertical = project.videoType === "shorts";

  let videoLogoPath: string | undefined;
  if (settingsMap.CHANNEL_LOGO) {
    const lp = path.join(OUTPUT_DIR, settingsMap.CHANNEL_LOGO.replace("/files/", ""));
    if (fs.existsSync(lp)) videoLogoPath = lp;
  }

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

    await updateProgress(projectId, 3, "최신 뉴스 검색 중...");
    let latestNewsContext = "";
    try {
      latestNewsContext = await searchLatestNews(project.topic, openaiKey, openaiBaseUrl);
    } catch (e) {
      console.warn("최신 뉴스 검색 실패, 건너뜀:", e);
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
      latestNewsContext,
    );

    await db.update(projects).set({
      scriptJson: script as any,
      title: script.title || project.title,
      progress: 15,
      progressMessage: "대본 생성 완료. TTS 음성 생성 중...",
      updatedAt: new Date(),
    }).where(eq(projects.id, projectId));

    const sectionVideos: string[] = [];
    const insertSubscribeAfter = !isVertical ? Math.floor(script.sections.length / 2) - 1 : -1;
    const usePexels = project.visualStyle === "cinematic" && !!settingsMap.PEXELS_API_KEY;
    const pexelsKey = settingsMap.PEXELS_API_KEY || process.env.PEXELS_API_KEY || "";

    for (let i = 0; i < script.sections.length; i++) {
      const section = script.sections[i];
      const pctBase = 15 + ((i / script.sections.length) * 70);

      await updateProgress(projectId, Math.round(pctBase), `섹션 ${i + 1}/${script.sections.length}: TTS 생성 중...`);
      const audioPath = path.join(projectDir, `audio_${i}.mp3`);
      await generateTTS(section.narration, audioPath, elevenlabsKey, elevenlabsVoiceId);

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

      let sectionImagePaths = [imagePath];

      if (usePexels && audioDuration > 20) {
        await updateProgress(projectId, Math.round(pctBase + 15), `섹션 ${i + 1}/${script.sections.length}: 보조 이미지 검색 중...`);
        try {
          const keyword = await extractPexelsKeyword(section.narration, openaiKey, openaiBaseUrl);
          if (keyword) {
            const pexelsCount = audioDuration > 40 ? 2 : 1;
            const pexelsImages = await fetchPexelsImages(keyword, pexelsCount, projectDir, `sec${i}`, pexelsKey, isVertical);
            if (pexelsImages.length > 0) {
              const interleaved: string[] = [imagePath];
              for (const pi of pexelsImages) {
                interleaved.push(pi);
              }
              sectionImagePaths = interleaved;
              console.log(`섹션 ${i + 1}: Pexels 보조 이미지 ${pexelsImages.length}장 추가 (키워드: ${keyword})`);
            }
          }
        } catch (e) {
          console.warn(`Pexels fetch failed for section ${i}, using AI image only:`, e);
        }
      }

      await updateProgress(projectId, Math.round(pctBase + 20), `섹션 ${i + 1}/${script.sections.length}: 영상 합성 중...`);
      const sectionPath = path.join(projectDir, `section_${i}.mp4`);
      try {
        console.log(`섹션 ${i + 1} 영상 합성 시작 (duration: ${audioDuration}s, images: ${sectionImagePaths.length})`);
        if (sectionImagePaths.length > 1) {
          await composeMultiImageSectionVideo(sectionImagePaths, audioPath, sectionPath, audioDuration, isVertical, section.narration, whisperSegments, videoLogoPath);
        } else {
          await composeSectionVideo(imagePath, audioPath, sectionPath, audioDuration, isVertical, section.narration, whisperSegments, videoLogoPath);
        }
        console.log(`섹션 ${i + 1} 영상 합성 완료`);
      } catch (composeErr: any) {
        console.error(`섹션 ${i + 1} 영상 합성 실패:`, composeErr.message);
        if (composeErr.stderr) console.error("FFmpeg stderr:", composeErr.stderr.substring(0, 500));
        throw composeErr;
      }

      sectionVideos.push(sectionPath);

      if (i === insertSubscribeAfter) {
        await updateProgress(projectId, Math.round(pctBase + 25), "구독 유도 섹션 생성 중...");
        try {
          const subscribeVideoPath = await createSubscribeSectionVideo(projectDir, isVertical, elevenlabsKey, openaiKey, openaiBaseUrl, videoLogoPath, elevenlabsVoiceId);
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

      let logoFilePath: string | undefined;
      const logoSetting = settingsMap.CHANNEL_LOGO;
      if (logoSetting) {
        const lp = path.join(OUTPUT_DIR, logoSetting.replace("/files/", ""));
        if (fs.existsSync(lp)) logoFilePath = lp;
      }

      await overlayTextOnImage(thumbRawPath, thumbPath, script.thumbnailText || script.title, false, logoFilePath);
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
    } else if (koreanError.includes("quota_exceeded") || koreanError.includes("insufficient_quota") || koreanError.includes("billing")) {
      koreanError = "API 크레딧이 부족합니다. ElevenLabs 크레딧을 확인하거나 새 API 키를 입력해주세요.";
    } else if (koreanError.includes("Invalid API Key") || (koreanError.includes("401") && !koreanError.includes("quota"))) {
      koreanError = "API 키가 유효하지 않습니다. 설정에서 올바른 키를 입력해주세요.";
    }
    await db.update(projects).set({
      status: "error",
      errorMessage: koreanError,
      updatedAt: new Date(),
    }).where(eq(projects.id, projectId));
  }
}
