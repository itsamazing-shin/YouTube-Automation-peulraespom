import { writeFile } from "fs/promises";
import { execSync } from "child_process";
import { join } from "path";
import { existsSync } from "fs";

const OUTPUT_DIR = join(process.cwd(), "test-video-output");
const FONT_DIR = join(process.cwd(), "assets", "fonts");
const RES = { w: 1920, h: 1080 };
const FPS = 30;

function getDur(path: string): number {
  try {
    return parseFloat(
      execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${path}" 2>/dev/null`).toString().trim()
    ) || 8;
  } catch { return 8; }
}

function fmtAss(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function exec(cmd: string) {
  try {
    execSync(cmd, { stdio: "pipe" });
  } catch (e: any) {
    const stderr = e.stderr?.toString() || "";
    console.error(`  FFmpeg error: ${stderr.slice(-200)}`);
    throw e;
  }
}

async function main() {
  console.log("=== 영상 합성 (모든 섹션 재생성) ===\n");

  const audioFiles = [1,2,3,4,5,6].map(i => join(OUTPUT_DIR, `audio_${i}.wav`)).filter(existsSync);
  const imageFiles = [1,2,3,4,5,6].map(i => join(OUTPUT_DIR, `image_${i}.png`)).filter(existsSync);
  const numSections = Math.min(audioFiles.length, imageFiles.length);

  console.log(`오디오: ${audioFiles.length}개, 이미지: ${imageFiles.length}개`);
  const durations = audioFiles.map(getDur);
  console.log(`길이: ${durations.map(d => d.toFixed(1) + "s").join(", ")}`);

  const silencePath = join(OUTPUT_DIR, "silence.wav");
  exec(`ffmpeg -y -f lavfi -i anullsrc=r=24000:cl=mono -t 0.3 "${silencePath}"`);

  const audioListPath = join(OUTPUT_DIR, "audio_list.txt");
  let audioList = "";
  for (let i = 0; i < numSections; i++) {
    audioList += `file '${audioFiles[i]}'\n`;
    if (i < numSections - 1) audioList += `file '${silencePath}'\n`;
  }
  await writeFile(audioListPath, audioList, "utf-8");
  exec(`ffmpeg -y -f concat -safe 0 -i "${audioListPath}" -c copy "${join(OUTPUT_DIR, "concat_audio.wav")}"`);
  console.log("✓ 오디오 병합");

  console.log("\n--- 슬라이드쇼 (Ken Burns, 30fps) ---");
  const sectionVideos: string[] = [];

  for (let i = 0; i < numSections; i++) {
    const dur = durations[i] + 0.3;
    const frames = Math.ceil(dur * FPS);
    const sectionPath = join(OUTPUT_DIR, `section_${i}.mp4`);

    const zoomDir = i % 2 === 0 ? "1.0+0.0008*on" : "1.08-0.0005*on";
    const xExpr = i % 3 === 0 ? `iw/4` : i % 3 === 1 ? `iw/4+iw/8*on/${frames}` : `iw/4-iw/8*on/${frames}`;
    const yExpr = i % 2 === 0 ? `ih/4` : `ih/4+ih/8*on/${frames}`;

    exec(
      `ffmpeg -y -loop 1 -i "${imageFiles[i]}" -vf "scale=${2*RES.w}:${2*RES.h},zoompan=z='${zoomDir}':x='${xExpr}':y='${yExpr}':d=${frames}:s=${RES.w}x${RES.h}:fps=${FPS},format=yuv420p" -t ${dur} -c:v libx264 -preset ultrafast -pix_fmt yuv420p "${sectionPath}"`
    );
    sectionVideos.push(sectionPath);
    console.log(`  ✓ 섹션 ${i + 1} (${dur.toFixed(1)}s, ${frames} frames)`);
  }

  console.log("\n--- 페이드 전환 ---");
  let filterComplex = "";
  let concatInputs = "";
  for (let i = 0; i < numSections; i++) {
    concatInputs += `-i "${sectionVideos[i]}" `;
    filterComplex += `[${i}:v]setpts=PTS-STARTPTS[v${i}];`;
  }

  const fadeDur = 0.5;
  const videoDurations = durations.map(d => d + 0.3);
  let lastLabel = "v0";
  for (let i = 1; i < numSections; i++) {
    const offset = videoDurations.slice(0, i).reduce((a, b) => a + b, 0) - i * fadeDur;
    const outLabel = i < numSections - 1 ? `xf${i}` : "vout";
    filterComplex += `[${lastLabel}][v${i}]xfade=transition=fade:duration=${fadeDur}:offset=${offset.toFixed(2)}[${outLabel}];`;
    lastLabel = outLabel;
  }

  const slideshowPath = join(OUTPUT_DIR, "slideshow.mp4");
  exec(
    `ffmpeg -y ${concatInputs} -filter_complex "${filterComplex.slice(0, -1)}" -map "[vout]" -c:v libx264 -preset ultrafast -pix_fmt yuv420p "${slideshowPath}"`
  );
  console.log("✓ 페이드 전환 완료");

  const concatAudioPath = join(OUTPUT_DIR, "concat_audio.wav");
  const videoWithAudioPath = join(OUTPUT_DIR, "video_with_audio.mp4");
  exec(
    `ffmpeg -y -i "${slideshowPath}" -i "${concatAudioPath}" -c:v libx264 -preset ultrafast -c:a aac -b:a 192k -shortest -pix_fmt yuv420p "${videoWithAudioPath}"`
  );
  console.log("✓ 오디오 합성 완료");

  const script = JSON.parse(
    execSync(`cat "${join(OUTPUT_DIR, "script.json")}"`).toString()
  );

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

  for (let i = 0; i < numSections; i++) {
    const section = script.sections[i];
    const duration = durations[i];
    assContent += `Dialogue: 0,${fmtAss(currentTime)},${fmtAss(currentTime + duration)},Main,,0,0,0,,${section.narration.replace(/\n/g, "\\N")}\n`;
    if (section.subtitleHighlight) {
      assContent += `Dialogue: 1,${fmtAss(currentTime + 0.5)},${fmtAss(currentTime + duration - 0.3)},Highlight,,0,0,0,,${section.subtitleHighlight}\n`;
    }
    currentTime += duration + 0.3;
  }

  const assPath = join(OUTPUT_DIR, "subtitles.ass");
  await writeFile(assPath, assContent, "utf-8");

  const finalVideoPath = join(OUTPUT_DIR, "final_video.mp4");
  const fontFile = join(FONT_DIR, "NotoSansCJKkr-Bold.otf");

  if (existsSync(fontFile)) {
    try {
      exec(
        `ffmpeg -y -i "${videoWithAudioPath}" -vf "ass=${assPath}:fontsdir=${FONT_DIR}" -c:v libx264 -preset ultrafast -c:a copy -pix_fmt yuv420p "${finalVideoPath}"`
      );
      console.log("✓ 자막 합성 완료");
    } catch {
      execSync(`cp "${videoWithAudioPath}" "${finalVideoPath}"`);
      console.log("⚠ 자막 합성 실패");
    }
  } else {
    execSync(`cp "${videoWithAudioPath}" "${finalVideoPath}"`);
  }

  console.log("\n=== 완료! ===");
  console.log(execSync(`ls -lh "${finalVideoPath}"`).toString().trim());
  const totalDur = getDur(finalVideoPath);
  console.log(`길이: ${totalDur.toFixed(1)}초 (${Math.floor(totalDur/60)}분 ${Math.floor(totalDur%60)}초)`);
  console.log(`경로: ${finalVideoPath}`);
}

main().catch(console.error);
