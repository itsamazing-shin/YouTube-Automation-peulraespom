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

async function updateProgress(projectId: number, progress: number, message: string) {
  await db.update(projects).set({
    progress,
    progressMessage: message,
    updatedAt: new Date(),
  }).where(eq(projects.id, projectId));
}

interface ScriptSection {
  narration: string;
  imagePrompt: string;
  subtitleHighlight: string;
  duration: number;
}

interface VideoScript {
  title: string;
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
): Promise<VideoScript> {
  const isShorts = videoType === "shorts";

  const sectionCount = isShorts ? 3 : duration === "1min" ? 4 : duration === "5min" ? 8 : duration === "10min" ? 12 : 16;

  const toneMap: Record<string, string> = {
    calm: "차분하고 설득력 있는 톤으로, 시청자가 깊이 생각하게 만드는",
    energetic: "활기차고 열정적인 톤으로, 에너지 넘치는",
    serious: "진지하고 전문적인 톤으로, 신뢰감을 주는",
    friendly: "친근하고 편안한 톤으로, 친구에게 이야기하듯",
  };

  const styleMap: Record<string, string> = {
    cinematic: "Cinematic photorealistic scene. Dramatic film lighting, professional composition, shallow depth of field.",
    "simple-character": "Korean 'Jollaman' (졸라맨) stick figure style illustration. Simple round head with dot eyes, thin stick body and limbs. Clean colored background (not white). Comic/manhwa speech bubbles with bold Korean text. Exaggerated emotional expressions through simple body language. Similar to Korean YouTube channel '이상한경제' or '침착맨' animation style. Include scene-relevant props drawn in same minimalist style.",
    infographic: "Clean modern infographic style. Data charts, graphs, icons, flat design, bold typography, organized layout with clear visual hierarchy.",
    webtoon: "Korean webtoon illustration style. Vibrant saturated colors, expressive characters, dynamic poses, manhwa-inspired art with clean lines.",
  };

  const systemPrompt = `당신은 창의적인 유튜브 영상 대본 작가입니다. ${toneMap[tone] || toneMap.calm} 스타일로 대본을 작성합니다.
${isShorts ? "쇼츠 영상이므로 첫 문장부터 강렬한 후킹으로 시작하세요. 짧고 임팩트 있는 문장을 사용하고, 긴박감과 호기심을 유발하세요. '이거 모르면 손해입니다', '충격적인 사실' 같은 표현을 적극 활용하세요." : ""}
매번 완전히 새로운 시각과 독창적인 구성으로 대본을 작성하세요. 같은 주제라도 이전과 다른 앵글, 다른 예시, 다른 스토리라인으로 접근하세요. 뻔한 서론 대신 의외의 사실이나 충격적인 통계로 시작하세요.
반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.`;

  const userPrompt = `주제: "${topic}"
${referenceUrl ? `참고 영상 URL: ${referenceUrl}\n(위 영상은 주제와 톤의 방향성만 참고하세요. 대본 내용, 문장, 구성은 절대 복제하지 마세요. 100% 독창적인 새로운 대본을 작성해야 합니다. 유튜브 저작권 정책을 준수하세요.)` : ""}

${sectionCount}개 섹션으로 구성된 ${isShorts ? "유튜브 쇼츠(세로형 60초)" : "유튜브 롱폼 영상"} 대본을 작성하세요.

이미지 프롬프트는 "${styleMap[visualStyle] || styleMap.cinematic}" 스타일로 작성하세요.

JSON 형식:
{
  "title": "영상 제목",
  "sections": [
    {
      "narration": "나레이션 텍스트 (반드시 3~5문장, 각 문장이 구체적이고 내용이 풍부하게. 총 80~150자 이상)",
      "imagePrompt": "English-only image prompt for this scene. IMPORTANT: Do NOT include any Korean text, letters, signs, or writing in the image. No text overlay. Visual scene only. Style: ${styleMap[visualStyle] || styleMap.cinematic}",
      "subtitleHighlight": "핵심 자막 (짧은 문구)",
      "duration": ${isShorts ? 15 : 30}
    }
  ],
  "thumbnailPrompt": "YouTube thumbnail, ultra eye-catching. Requirements: 1) dramatic facial expression or shocking visual related to the topic, 2) bold large Korean title text (max 5 words) with yellow/white outline and drop shadow, 3) high contrast saturated colors with red/yellow accent, 4) clean composition with subject on one side leaving space for text, 5) slight zoom-in effect for urgency. Style: MrBeast/Korean top YouTuber thumbnail quality."
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

  const response = await fetch(
    `${geminiBaseUrl}/v1beta/models/gemini-2.5-flash-image:generateContent?key=${geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
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
    );

    await db.update(projects).set({
      scriptJson: script as any,
      title: script.title || project.title,
      progress: 15,
      progressMessage: "대본 생성 완료. TTS 음성 생성 중...",
      updatedAt: new Date(),
    }).where(eq(projects.id, projectId));

    const sectionVideos: string[] = [];

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
      await generateImage(section.imagePrompt, imagePath, openaiKey, isVertical, openaiBaseUrl);

      await updateProgress(projectId, Math.round(pctBase + 20), `섹션 ${i + 1}/${script.sections.length}: 영상 합성 중...`);
      const sectionPath = path.join(projectDir, `section_${i}.mp4`);
      await composeSectionVideo(imagePath, audioPath, sectionPath, audioDuration, isVertical, section.narration, whisperSegments);

      sectionVideos.push(sectionPath);
    }

    await updateProgress(projectId, 88, "섹션 합치는 중...");
    const finalPath = path.join(projectDir, `final_${projectId}.mp4`);
    await concatenateVideos(sectionVideos, finalPath);

    await updateProgress(projectId, 95, "썸네일 생성 중...");
    const thumbPath = path.join(projectDir, `thumbnail_${projectId}.png`);
    try {
      await generateImage(script.thumbnailPrompt, thumbPath, openaiKey, false, openaiBaseUrl, "medium");
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
    await db.update(projects).set({
      status: "error",
      errorMessage: err.message || "Video generation failed",
      updatedAt: new Date(),
    }).where(eq(projects.id, projectId));
  }
}
