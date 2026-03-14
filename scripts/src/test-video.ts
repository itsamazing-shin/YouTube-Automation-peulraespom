import OpenAI from "openai";
import { writeFile, mkdir, readFile } from "fs/promises";
import { execSync } from "child_process";
import { join } from "path";
import { existsSync } from "fs";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY!,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL!,
});

const OUTPUT_DIR = join(process.cwd(), "test-video-output");
const FONT_DIR = join(process.cwd(), "assets", "fonts");
const FONT_FILE = "NotoSansCJKkr-Bold.otf";
const RES = { w: 1920, h: 1080 };

interface ScriptSection {
  id: number;
  narration: string;
  imagePrompt: string;
  subtitleHighlight: string;
}

interface GeneratedScript {
  title: string;
  sections: ScriptSection[];
}

async function step1_generateScript(): Promise<GeneratedScript> {
  console.log("\n━━━ STEP 1: AI 대본 생성 ━━━");

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 4096,
    messages: [
      {
        role: "system",
        content: `당신은 유튜브 경제/심리학 채널의 전문 대본 작가입니다.
"경제 심리학" 채널 스타일: 차분하고 설득력 있는 톤, 스토리텔링 구조, 시청자를 끌어당기는 후킹.
대본은 한국어로 작성합니다.`,
      },
      {
        role: "user",
        content: `"영끌족의 현실"이라는 주제로 약 1분 30초 분량의 짧은 유튜브 영상 대본을 작성해주세요.

다음 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{
  "title": "영상 제목",
  "sections": [
    {
      "id": 1,
      "narration": "나레이션 텍스트 (2-3문장, 자연스러운 한국어)",
      "imagePrompt": "이 구간의 배경 이미지를 위한 상세한 영어 프롬프트. Cinematic, dark moody atmosphere, 16:9 aspect ratio, professional photography style.",
      "subtitleHighlight": "화면에 표시할 핵심 키워드 (3-5단어)"
    }
  ]
}

섹션은 5-6개로:
1. 인트로 후킹 (충격적인 사실/질문으로 시작)
2-4. 본론 (영끌족의 심리, 현실, 결과)
5-6. 결론 (교훈, 마무리)

imagePrompt는 실사 느낌의 고퀄리티 이미지를 생성할 수 있도록 구체적으로 작성해주세요.`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content || "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Failed to parse script JSON");

  const script: GeneratedScript = JSON.parse(jsonMatch[0]);
  console.log(`  ✓ 제목: ${script.title}`);
  console.log(`  ✓ 섹션: ${script.sections.length}개`);

  await writeFile(join(OUTPUT_DIR, "script.json"), JSON.stringify(script, null, 2));
  return script;
}

async function step2_generateTTS(script: GeneratedScript): Promise<string[]> {
  console.log("\n━━━ STEP 2: TTS 나레이션 생성 ━━━");

  const audioFiles: string[] = [];

  for (const section of script.sections) {
    console.log(`  섹션 ${section.id} 음성 생성 중...`);

    const response = await openai.chat.completions.create({
      model: "gpt-audio",
      modalities: ["text", "audio"],
      audio: { voice: "nova", format: "wav" },
      messages: [
        {
          role: "system",
          content:
            "You are a professional Korean narrator for YouTube documentaries. Read the given Korean text in a calm, warm, authoritative, and engaging tone. Speak at a natural pace — not too fast, not too slow. Do NOT add any extra words — read EXACTLY what is given.",
        },
        {
          role: "user",
          content: `다음 텍스트를 정확히 읽어주세요:\n\n${section.narration}`,
        },
      ],
    });

    const audioData = (response.choices[0]?.message as any)?.audio?.data ?? "";
    if (!audioData) {
      console.log(`  ✗ 섹션 ${section.id} 음성 생성 실패`);
      continue;
    }

    const audioPath = join(OUTPUT_DIR, `audio_${section.id}.wav`);
    await writeFile(audioPath, Buffer.from(audioData, "base64"));
    audioFiles.push(audioPath);

    const dur = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}" 2>/dev/null`
    ).toString().trim();
    console.log(`  ✓ 섹션 ${section.id}: ${parseFloat(dur).toFixed(1)}초`);
  }

  return audioFiles;
}

async function generateSingleImage(section: ScriptSection): Promise<string> {
  const imagePath = join(OUTPUT_DIR, `image_${section.id}.png`);

  if (existsSync(imagePath)) {
    const stat = execSync(`stat -c%s "${imagePath}" 2>/dev/null`).toString().trim();
    if (parseInt(stat) > 50000) {
      console.log(`  ✓ 섹션 ${section.id} 이미지 캐시 사용`);
      return imagePath;
    }
  }

  try {
    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt: `${section.imagePrompt}. Style: Cinematic dark mood, professional stock photo quality, 16:9 widescreen composition, shallow depth of field, dramatic lighting, no text or watermarks.`,
      size: "1536x1024",
    });

    const base64 = response.data?.[0]?.b64_json ?? "";
    if (base64) {
      const rawPath = join(OUTPUT_DIR, `image_${section.id}_raw.png`);
      await writeFile(rawPath, Buffer.from(base64, "base64"));
      execSync(
        `ffmpeg -y -i "${rawPath}" -vf "scale=${RES.w}:${RES.h}:force_original_aspect_ratio=increase,crop=${RES.w}:${RES.h}" "${imagePath}" 2>/dev/null`
      );
      console.log(`  ✓ 섹션 ${section.id} AI 이미지 완료`);
      return imagePath;
    }
    throw new Error("No image data");
  } catch (err: any) {
    console.log(`  ✗ 섹션 ${section.id} 실패: ${err.message}`);
    execSync(
      `ffmpeg -y -f lavfi -i "color=c=0x1a1a2e:s=${RES.w}x${RES.h}:d=1" -frames:v 1 "${imagePath}" 2>/dev/null`
    );
    return imagePath;
  }
}

async function step3_generateImages(script: GeneratedScript): Promise<string[]> {
  console.log("\n━━━ STEP 3: AI 이미지 생성 (gpt-image-1, 병렬) ━━━");

  const results = await Promise.all(
    script.sections.map((section) => generateSingleImage(section))
  );

  return results;
}

function getAudioDuration(audioPath: string): number {
  try {
    return parseFloat(
      execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}" 2>/dev/null`)
        .toString().trim()
    ) || 8;
  } catch {
    return 8;
  }
}

async function step4_generateSubtitles(
  script: GeneratedScript,
  audioFiles: string[]
): Promise<string> {
  console.log("\n━━━ STEP 4: 자막 생성 (ASS) ━━━");

  let currentTime = 0;
  const fontName = "NotoSansCJKkr-Bold";

  let assContent = `[Script Info]
Title: ${script.title}
ScriptType: v4.00+
WrapStyle: 0
PlayResX: ${RES.w}
PlayResY: ${RES.h}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,${fontName},42,&H00FFFFFF,&H000000FF,&H00000000,&HC0000000,-1,0,0,0,100,100,1,0,1,3,2,2,60,60,50,1
Style: Highlight,${fontName},60,&H0000E5FF,&H000000FF,&H00000000,&HC0000000,-1,0,0,0,100,100,2,0,1,4,3,8,60,60,180,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  for (let i = 0; i < script.sections.length; i++) {
    const section = script.sections[i];
    const duration = audioFiles[i] ? getAudioDuration(audioFiles[i]) : 8;

    const start = fmtAss(currentTime);
    const end = fmtAss(currentTime + duration);
    const hlStart = fmtAss(currentTime + 0.5);
    const hlEnd = fmtAss(currentTime + duration - 0.3);

    assContent += `Dialogue: 0,${start},${end},Main,,0,0,0,,${section.narration.replace(/\n/g, "\\N")}\n`;

    if (section.subtitleHighlight) {
      assContent += `Dialogue: 1,${hlStart},${hlEnd},Highlight,,0,0,0,,${section.subtitleHighlight}\n`;
    }

    currentTime += duration + 0.3;
  }

  const assPath = join(OUTPUT_DIR, "subtitles.ass");
  await writeFile(assPath, assContent, "utf-8");
  console.log(`  ✓ 자막 파일: ${assPath}`);
  return assPath;
}

function fmtAss(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

async function step5_composeVideo(
  script: GeneratedScript,
  audioFiles: string[],
  imageFiles: string[],
  subtitlePath: string
): Promise<string> {
  console.log("\n━━━ STEP 5: FFmpeg 영상 합성 ━━━");

  const durations = audioFiles.map(getAudioDuration);

  const concatAudioPath = join(OUTPUT_DIR, "concat_audio.wav");
  const silencePath = join(OUTPUT_DIR, "silence.wav");
  execSync(`ffmpeg -y -f lavfi -i anullsrc=r=24000:cl=mono -t 0.3 "${silencePath}" 2>/dev/null`);

  const audioListPath = join(OUTPUT_DIR, "audio_list.txt");
  let audioList = "";
  for (let i = 0; i < audioFiles.length; i++) {
    audioList += `file '${audioFiles[i]}'\n`;
    if (i < audioFiles.length - 1) {
      audioList += `file '${silencePath}'\n`;
    }
  }
  await writeFile(audioListPath, audioList, "utf-8");
  execSync(`ffmpeg -y -f concat -safe 0 -i "${audioListPath}" -c copy "${concatAudioPath}" 2>/dev/null`);
  console.log("  ✓ 오디오 병합 완료");

  const totalDuration = durations.reduce((a, b) => a + b, 0) + (durations.length - 1) * 0.3;

  const kenBurnsEffects = [
    `scale=2*${RES.w}:2*${RES.h},zoompan=z='1.05+0.0005*on':x='iw/4-iw/4*on/${"%FRAMES%"}':y='ih/4':d=${"%FRAMES%"}:s=${RES.w}x${RES.h}:fps=30`,
    `scale=2*${RES.w}:2*${RES.h},zoompan=z='1.08-0.0003*on':x='iw/4+iw/8*on/${"%FRAMES%"}':y='ih/4':d=${"%FRAMES%"}:s=${RES.w}x${RES.h}:fps=30`,
    `scale=2*${RES.w}:2*${RES.h},zoompan=z='1.0+0.001*on':x='iw/4':y='ih/4-ih/8*on/${"%FRAMES%"}':d=${"%FRAMES%"}:s=${RES.w}x${RES.h}:fps=30`,
    `scale=2*${RES.w}:2*${RES.h},zoompan=z='1.1-0.0005*on':x='iw/4':y='ih/4+ih/8*on/${"%FRAMES%"}':d=${"%FRAMES%"}:s=${RES.w}x${RES.h}:fps=30`,
    `scale=2*${RES.w}:2*${RES.h},zoompan=z='1.03+0.0008*on':x='iw/4+iw/6*on/${"%FRAMES%"}':y='ih/4-ih/8*on/${"%FRAMES%"}':d=${"%FRAMES%"}:s=${RES.w}x${RES.h}:fps=30`,
    `scale=2*${RES.w}:2*${RES.h},zoompan=z='1.06-0.0004*on':x='iw/4-iw/6*on/${"%FRAMES%"}':y='ih/4+ih/6*on/${"%FRAMES%"}':d=${"%FRAMES%"}:s=${RES.w}x${RES.h}:fps=30`,
  ];

  const sectionVideos: string[] = [];
  for (let i = 0; i < imageFiles.length; i++) {
    const dur = durations[i] + 0.3;
    const frames = Math.ceil(dur * 30);
    const effect = kenBurnsEffects[i % kenBurnsEffects.length].replace(/%FRAMES%/g, String(frames));
    const sectionPath = join(OUTPUT_DIR, `section_${i}.mp4`);

    execSync(
      `ffmpeg -y -loop 1 -i "${imageFiles[i]}" -vf "${effect},format=yuv420p" -t ${dur} -c:v libx264 -preset fast -pix_fmt yuv420p "${sectionPath}" 2>/dev/null`
    );
    sectionVideos.push(sectionPath);
    console.log(`  ✓ 섹션 ${i + 1} Ken Burns 효과 적용`);
  }

  const numSections = sectionVideos.length;
  let filterComplex = "";
  let concatInputs = "";

  for (let i = 0; i < numSections; i++) {
    concatInputs += `-i "${sectionVideos[i]}" `;
  }

  if (numSections >= 2) {
    for (let i = 0; i < numSections; i++) {
      filterComplex += `[${i}:v]setpts=PTS-STARTPTS[v${i}];`;
    }

    let lastLabel = "v0";
    for (let i = 1; i < numSections; i++) {
      const offset = durations.slice(0, i).reduce((a, b) => a + b, 0) + i * 0.3 - 0.5;
      const outLabel = i < numSections - 1 ? `xf${i}` : "vout";
      filterComplex += `[${lastLabel}][v${i}]xfade=transition=fade:duration=0.5:offset=${offset.toFixed(2)}[${outLabel}];`;
      lastLabel = outLabel;
    }

    const slideshowPath = join(OUTPUT_DIR, "slideshow.mp4");
    execSync(
      `ffmpeg -y ${concatInputs} -filter_complex "${filterComplex.slice(0, -1)}" -map "[vout]" -c:v libx264 -preset fast -pix_fmt yuv420p "${slideshowPath}" 2>/dev/null`
    );
    console.log("  ✓ 페이드 전환 적용 완료");

    const videoWithAudioPath = join(OUTPUT_DIR, "video_with_audio.mp4");
    execSync(
      `ffmpeg -y -i "${slideshowPath}" -i "${concatAudioPath}" -c:v libx264 -c:a aac -b:a 192k -shortest -pix_fmt yuv420p "${videoWithAudioPath}" 2>/dev/null`
    );
    console.log("  ✓ 오디오 합성 완료");

    const finalVideoPath = join(OUTPUT_DIR, "final_video.mp4");
    const fontDir = FONT_DIR;

    if (existsSync(join(fontDir, FONT_FILE)) && existsSync(subtitlePath)) {
      try {
        execSync(
          `ffmpeg -y -i "${videoWithAudioPath}" -vf "ass=${subtitlePath}:fontsdir=${fontDir}" -c:v libx264 -preset fast -c:a copy -pix_fmt yuv420p "${finalVideoPath}" 2>/dev/null`
        );
        console.log("  ✓ 자막 합성 완료");
      } catch {
        execSync(`cp "${videoWithAudioPath}" "${finalVideoPath}"`);
        console.log("  ⚠ 자막 합성 실패, 자막 없이 진행");
      }
    } else {
      execSync(`cp "${videoWithAudioPath}" "${finalVideoPath}"`);
      console.log("  ⚠ 폰트 없음, 자막 없이 진행");
    }

    return finalVideoPath;
  }

  const finalVideoPath = join(OUTPUT_DIR, "final_video.mp4");
  execSync(
    `ffmpeg -y -i "${sectionVideos[0]}" -i "${concatAudioPath}" -c:v libx264 -c:a aac -shortest -pix_fmt yuv420p "${finalVideoPath}" 2>/dev/null`
  );
  return finalVideoPath;
}

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  YouTube 테스트 영상 자동 생성 시스템     ║");
  console.log("║  주제: 영끌족의 현실                      ║");
  console.log("║  스타일: 경제 심리학 채널 참고             ║");
  console.log("╚══════════════════════════════════════════╝");

  await mkdir(OUTPUT_DIR, { recursive: true });

  const script = await step1_generateScript();

  console.log("\n  TTS와 이미지를 병렬로 생성합니다...");
  const [audioFiles, imageFiles] = await Promise.all([
    step2_generateTTS(script),
    step3_generateImages(script),
  ]);

  if (audioFiles.length === 0) {
    console.error("\n✗ 음성 파일이 생성되지 않았습니다.");
    return;
  }
  if (imageFiles.length === 0) {
    console.error("\n✗ 이미지 파일이 생성되지 않았습니다.");
    return;
  }

  const subtitlePath = await step4_generateSubtitles(script, audioFiles);

  const finalVideoPath = await step5_composeVideo(
    script,
    audioFiles,
    imageFiles,
    subtitlePath
  );

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║           영상 생성 완료!                 ║");
  console.log("╚══════════════════════════════════════════╝");

  const stat = execSync(`ls -lh "${finalVideoPath}"`).toString().trim();
  console.log(`  파일: ${stat}`);

  try {
    const dur = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${finalVideoPath}" 2>/dev/null`
    ).toString().trim();
    console.log(`  길이: ${parseFloat(dur).toFixed(1)}초`);
  } catch {}

  console.log(`\n  경로: ${finalVideoPath}`);
}

main().catch(console.error);
