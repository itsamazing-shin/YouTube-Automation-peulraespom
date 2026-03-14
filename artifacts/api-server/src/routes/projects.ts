import { Router } from "express";
import { db } from "@workspace/db";
import { projects, settings } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { generateVideo, regenerateThumbnail, recomposeVideo } from "../lib/pipeline";
import { objectStorageClient, signObjectURL } from "../lib/objectStorage";
import multer from "multer";
import path from "path";
import fs from "fs";

const OUTPUT_DIR = path.join(process.cwd(), "output");
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const refDir = path.join(OUTPUT_DIR, "reference_images");
      if (!fs.existsSync(refDir)) fs.mkdirSync(refDir, { recursive: true });
      cb(null, refDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".png";
      cb(null, `ref_${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("이미지 파일만 업로드 가능합니다."));
  },
});

const router = Router();

router.get("/projects", async (_req, res): Promise<void> => {
  try {
    const allProjects = await db.select().from(projects).orderBy(desc(projects.createdAt));
    res.json(allProjects);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, parseInt(req.params.id)));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch project" });
  }
});

router.post("/projects", async (req, res): Promise<void> => {
  try {
    const { title, topic, videoType, visualStyle, duration, tone, referenceUrl, referenceImageUrl } = req.body;
    if (!topic?.trim()) { res.status(400).json({ error: "Topic is required" }); return; }

    const [project] = await db.insert(projects).values({
      title: title || topic,
      topic,
      videoType: videoType || "longform",
      visualStyle: visualStyle || "cinematic",
      duration: duration || "10min",
      tone: tone || "calm",
      referenceUrl: referenceUrl || null,
      referenceImageUrl: referenceImageUrl || null,
      status: "draft",
    }).returning();

    res.json(project);
  } catch (err) {
    res.status(500).json({ error: "Failed to create project" });
  }
});

router.post("/projects/:id/generate", async (req, res): Promise<void> => {
  try {
    const projectId = parseInt(req.params.id);
    if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (project.status === "generating") { res.status(409).json({ error: "이미 생성 중입니다. 잠시 기다려주세요." }); return; }

    const allSettings = await db.select().from(settings);
    const settingsMap: Record<string, string> = {};
    for (const s of allSettings) {
      settingsMap[s.key] = s.value;
    }

    if (!settingsMap.OPENAI_API_KEY) {
      settingsMap.OPENAI_API_KEY = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
    }
    if (!settingsMap.ELEVENLABS_API_KEY) {
      settingsMap.ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
    }
    if (!settingsMap.XAI_API_KEY) {
      settingsMap.XAI_API_KEY = process.env.XAI_API_KEY || "";
    }
    if (!settingsMap.PEXELS_API_KEY) {
      settingsMap.PEXELS_API_KEY = process.env.PEXELS_API_KEY || "";
    }

    if (!settingsMap.OPENAI_API_KEY) {
      res.status(400).json({ error: "OpenAI API 키가 설정되지 않았습니다. Settings에서 등록해주세요." }); return;
    }
    if (!settingsMap.ELEVENLABS_API_KEY) {
      res.status(400).json({ error: "ElevenLabs API 키가 설정되지 않았습니다. Settings에서 등록해주세요." }); return;
    }

    if (!settingsMap.OPENAI_BASE_URL) {
      settingsMap.OPENAI_BASE_URL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com/v1";
    }

    await db.update(projects).set({
      status: "generating",
      progress: 0,
      progressMessage: "생성 준비 중...",
      errorMessage: null,
      updatedAt: new Date(),
    }).where(eq(projects.id, projectId));

    res.json({ success: true, message: "Generation started" });

    generateVideo(projectId, project, settingsMap).catch((err) => {
      console.error("Video generation failed:", err);
      db.update(projects).set({
        status: "error",
        errorMessage: err.message || "Unknown error occurred",
        updatedAt: new Date(),
      }).where(eq(projects.id, projectId)).catch(console.error);
    });

  } catch (err) {
    res.status(500).json({ error: "Failed to start generation" });
  }
});

router.post("/projects/:id/regenerate-thumbnail", async (req, res): Promise<void> => {
  try {
    const projectId = parseInt(req.params.id);
    const { prompt } = req.body;
    if (!prompt?.trim()) { res.status(400).json({ error: "썸네일 프롬프트를 입력해주세요." }); return; }

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    const allSettings = await db.select().from(settings);
    const settingsMap: Record<string, string> = {};
    for (const s of allSettings) settingsMap[s.key] = s.value;

    if (!settingsMap.OPENAI_API_KEY) {
      settingsMap.OPENAI_API_KEY = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
    }
    if (!settingsMap.OPENAI_BASE_URL) {
      settingsMap.OPENAI_BASE_URL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com/v1";
    }

    if (!settingsMap.OPENAI_API_KEY) {
      res.status(400).json({ error: "OpenAI API 키가 설정되지 않았습니다." }); return;
    }

    const thumbnailUrl = await regenerateThumbnail(projectId, prompt, settingsMap.OPENAI_API_KEY, settingsMap.OPENAI_BASE_URL);
    if (thumbnailUrl) {
      res.json({ success: true, thumbnailUrl });
    } else {
      res.status(500).json({ error: "썸네일 생성에 실패했습니다." });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to regenerate thumbnail" });
  }
});

router.post("/projects/:id/upload-thumbnail", upload.single("thumbnail"), async (req, res): Promise<void> => {
  try {
    const projectId = parseInt(req.params.id as string);
    if (!req.file) { res.status(400).json({ error: "썸네일 이미지 파일이 필요합니다." }); return; }

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    const projectDir = path.join(OUTPUT_DIR, `project_${projectId}`);
    if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

    const ext = path.extname(req.file.originalname) || ".png";
    const thumbFilename = `thumbnail_${projectId}${ext}`;
    const thumbPath = path.join(projectDir, thumbFilename);

    fs.copyFileSync(req.file.path, thumbPath);
    fs.unlinkSync(req.file.path);

    const relativePath = `/files/project_${projectId}/${thumbFilename}`;
    await db.update(projects).set({
      thumbnailUrl: relativePath,
      updatedAt: new Date(),
    }).where(eq(projects.id, projectId));

    res.json({ success: true, thumbnailUrl: relativePath });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "썸네일 업로드 실패" });
  }
});

router.post("/upload-reference-image", upload.single("image"), async (req, res): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ error: "이미지 파일이 필요합니다." }); return; }
    const relativePath = `/files/reference_images/${req.file.filename}`;
    res.json({ success: true, imageUrl: relativePath });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "업로드 실패" });
  }
});

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const logoDir = path.join(OUTPUT_DIR, "logos");
      if (!fs.existsSync(logoDir)) fs.mkdirSync(logoDir, { recursive: true });
      cb(null, logoDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".png";
      cb(null, `channel_logo${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.post("/upload-logo", logoUpload.single("logo"), async (req, res): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ error: "로고 파일이 필요합니다." }); return; }
    const relativePath = `/files/logos/${req.file.filename}`;
    await db.insert(settings).values({ key: "CHANNEL_LOGO", value: relativePath })
      .onConflictDoUpdate({ target: settings.key, set: { value: relativePath } });
    res.json({ success: true, logoUrl: relativePath });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "로고 업로드 실패" });
  }
});

router.get("/logo", async (_req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(settings).where(eq(settings.key, "CHANNEL_LOGO"));
    res.json({ logoUrl: row?.value || null });
  } catch {
    res.json({ logoUrl: null });
  }
});

router.delete("/logo", async (_req, res): Promise<void> => {
  try {
    await db.delete(settings).where(eq(settings.key, "CHANNEL_LOGO"));
    const logoDir = path.join(OUTPUT_DIR, "logos");
    if (fs.existsSync(logoDir)) {
      for (const f of fs.readdirSync(logoDir)) fs.unlinkSync(path.join(logoDir, f));
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const sectionVideoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const projectDir = path.join(OUTPUT_DIR, `project_${req.params.id}`);
      if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });
      cb(null, projectDir);
    },
    filename: (req, _file, cb) => {
      cb(null, `custom_section_${req.params.sectionIndex}.mp4`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/")) cb(null, true);
    else cb(new Error("동영상 파일만 업로드 가능합니다."));
  },
});

router.post("/projects/:id/section-video/:sectionIndex", sectionVideoUpload.single("video"), async (req, res): Promise<void> => {
  try {
    const projectId = parseInt(req.params.id as string);
    const sectionIndex = parseInt(req.params.sectionIndex as string);
    if (!req.file) { res.status(400).json({ error: "동영상 파일이 필요합니다." }); return; }

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) {
      if (req.file) fs.unlinkSync(req.file.path);
      res.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });
      return;
    }

    const script = project.scriptJson as any;
    if (script?.sections && (sectionIndex < 0 || sectionIndex >= script.sections.length)) {
      if (req.file) fs.unlinkSync(req.file.path);
      res.status(400).json({ error: "유효하지 않은 섹션 번호입니다." });
      return;
    }

    res.json({ success: true, sectionIndex, filename: req.file.filename });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "섹션 영상 업로드 실패" });
  }
});

router.delete("/projects/:id/section-video/:sectionIndex", async (req, res): Promise<void> => {
  try {
    const projectId = parseInt(req.params.id);
    const sectionIndex = parseInt(req.params.sectionIndex);
    const filePath = path.join(OUTPUT_DIR, `project_${projectId}`, `custom_section_${sectionIndex}.mp4`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/projects/:id/section-videos", async (req, res): Promise<void> => {
  try {
    const projectId = parseInt(req.params.id);
    const projectDir = path.join(OUTPUT_DIR, `project_${projectId}`);
    const customSections: Record<number, { filename: string; size: number }> = {};

    if (fs.existsSync(projectDir)) {
      const files = fs.readdirSync(projectDir).filter(f => f.startsWith("custom_section_") && f.endsWith(".mp4"));
      for (const f of files) {
        const match = f.match(/custom_section_(\d+)\.mp4/);
        if (match) {
          const stat = fs.statSync(path.join(projectDir, f));
          customSections[parseInt(match[1])] = { filename: f, size: stat.size };
        }
      }
    }

    res.json(customSections);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/projects/:id/recompose", async (req, res): Promise<void> => {
  try {
    const projectId = parseInt(req.params.id);
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) { res.status(404).json({ error: "프로젝트를 찾을 수 없습니다." }); return; }
    if (project.status !== "completed") { res.status(400).json({ error: "완료된 프로젝트만 재합성할 수 있습니다." }); return; }

    const allSettings = await db.select().from(settings);
    const settingsMap: Record<string, string> = {};
    for (const s of allSettings) settingsMap[s.key] = s.value;

    await db.update(projects).set({
      status: "generating",
      progress: 85,
      progressMessage: "커스텀 영상으로 재합성 중...",
      updatedAt: new Date(),
    }).where(eq(projects.id, projectId));

    res.json({ success: true });

    recomposeVideo(projectId, project, settingsMap).catch((err) => {
      console.error("Recompose failed:", err);
      db.update(projects).set({
        status: "completed",
        progressMessage: "재합성 실패: " + err.message,
        updatedAt: new Date(),
      }).where(eq(projects.id, projectId)).catch(console.error);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/projects/:id", async (req, res): Promise<void> => {
  try {
    const projectId = parseInt(req.params.id);
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));

    await db.delete(projects).where(eq(projects.id, projectId));

    const projectDir = path.join(OUTPUT_DIR, `project_${projectId}`);
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }

    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (bucketId) {
      try {
        const bucket = objectStorageClient.bucket(bucketId);
        const [files] = await bucket.getFiles({ prefix: `videos/project_${projectId}/` });
        if (files.length > 0) {
          await Promise.all(files.map(f => f.delete().catch(() => {})));
        }
      } catch (e) {
        console.warn("Object Storage 파일 삭제 실패:", e);
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete project" });
  }
});

router.post("/projects/migrate-to-storage", async (_req, res): Promise<void> => {
  try {
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucketId) {
      res.status(400).json({ error: "Object Storage가 설정되지 않았습니다." });
      return;
    }

    const allProjects = await db.select().from(projects).where(eq(projects.status, "completed"));
    let migrated = 0;

    for (const project of allProjects) {
      if (project.videoUrl?.startsWith("/storage/")) continue;

      const projectDir = path.join(OUTPUT_DIR, `project_${project.id}`);
      const finalVideoPath = path.join(projectDir, `final_${project.id}.mp4`);

      if (!fs.existsSync(finalVideoPath)) continue;

      try {
        const bucket = objectStorageClient.bucket(bucketId);
        const storageDest = `videos/project_${project.id}/final_${project.id}.mp4`;
        await bucket.upload(finalVideoPath, {
          destination: storageDest,
          metadata: { contentType: "video/mp4" },
        });

        const updates: any = {
          videoUrl: `/storage/${storageDest}`,
          updatedAt: new Date(),
        };

        const thumbPath = path.join(projectDir, `thumbnail_${project.id}.png`);
        if (project.thumbnailUrl && !project.thumbnailUrl.startsWith("/storage/") && fs.existsSync(thumbPath)) {
          const thumbDest = `videos/project_${project.id}/thumbnail_${project.id}.png`;
          await bucket.upload(thumbPath, {
            destination: thumbDest,
            metadata: { contentType: "image/png" },
          });
          updates.thumbnailUrl = `/storage/${thumbDest}`;
        }

        await db.update(projects).set(updates).where(eq(projects.id, project.id));
        migrated++;
        console.log(`프로젝트 ${project.id} 마이그레이션 완료`);
      } catch (err: any) {
        console.error(`프로젝트 ${project.id} 마이그레이션 실패:`, err.message);
      }
    }

    res.json({ success: true, migrated, total: allProjects.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function parseRange(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
  const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!match) return null;

  const hasStart = match[1] !== "";
  const hasEnd = match[2] !== "";
  let start: number;
  let end: number;

  if (!hasStart && hasEnd) {
    const suffixLen = parseInt(match[2], 10);
    start = Math.max(0, fileSize - suffixLen);
    end = fileSize - 1;
  } else if (hasStart && !hasEnd) {
    start = parseInt(match[1], 10);
    end = fileSize - 1;
  } else if (hasStart && hasEnd) {
    start = parseInt(match[1], 10);
    end = parseInt(match[2], 10);
  } else {
    return null;
  }

  if (start < 0 || end < 0 || start > end || start >= fileSize) return null;
  end = Math.min(end, fileSize - 1);
  return { start, end };
}

function streamRange(
  res: import("express").Response,
  fileSize: number,
  rangeHeader: string | undefined,
  createStream: (opts?: { start: number; end: number }) => NodeJS.ReadableStream,
): void {
  if (rangeHeader && fileSize > 0) {
    const parsed = parseRange(rangeHeader, fileSize);
    if (!parsed) {
      res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
      return;
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${parsed.start}-${parsed.end}/${fileSize}`);
    res.setHeader("Content-Length", String(parsed.end - parsed.start + 1));
    createStream(parsed).pipe(res);
  } else {
    if (fileSize) res.setHeader("Content-Length", String(fileSize));
    createStream().pipe(res);
  }
}

async function serveProjectFile(
  res: import("express").Response,
  req: import("express").Request,
  storagePath: string,
  localPath: string,
  contentType: string,
): Promise<void> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;

  if (bucketId) {
    try {
      const bucket = objectStorageClient.bucket(bucketId);
      const file = bucket.file(storagePath);
      const [exists] = await file.exists();
      if (exists) {
        const [metadata] = await file.getMetadata();
        const fileSize = Number(metadata.size || 0);
        res.setHeader("Content-Type", contentType);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "public, max-age=3600");

        streamRange(res, fileSize, req.headers.range, (opts) =>
          opts ? file.createReadStream({ start: opts.start, end: opts.end }) : file.createReadStream()
        );
        return;
      }
    } catch (e) {
      console.warn("GCS serve error, trying local:", e);
    }
  }

  if (fs.existsSync(localPath)) {
    res.setHeader("Content-Type", contentType);
    const stat = fs.statSync(localPath);
    const fileSize = stat.size;
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=3600");

    streamRange(res, fileSize, req.headers.range, (opts) =>
      opts ? fs.createReadStream(localPath, { start: opts.start, end: opts.end }) : fs.createReadStream(localPath)
    );
    return;
  }

  res.status(404).json({ error: "파일을 찾을 수 없습니다." });
}

router.get("/projects/:id/video-url", async (req, res): Promise<void> => {
  try {
    const projectId = parseInt(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      res.status(400).json({ error: "잘못된 프로젝트 ID입니다." });
      return;
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) {
      res.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });
      return;
    }

    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    const objectName = `videos/project_${projectId}/final_${projectId}.mp4`;

    if (bucketId) {
      try {
        const bucket = objectStorageClient.bucket(bucketId);
        const file = bucket.file(objectName);
        const [exists] = await file.exists();
        if (exists) {
          const signedUrl = await signObjectURL({
            bucketName: bucketId,
            objectName,
            method: "GET",
            ttlSec: 3600,
          });
          res.json({ url: signedUrl, expiresIn: 3600 });
          return;
        }
      } catch (e) {
        console.warn("Signed URL failed:", e);
      }
    }

    res.json({ url: `/api/projects/${projectId}/video`, expiresIn: null });
  } catch (err: any) {
    if (!res.headersSent) res.status(500).json({ error: "영상 URL 생성 실패" });
  }
});

router.get("/projects/:id/video", async (req, res): Promise<void> => {
  try {
    const projectId = parseInt(req.params.id);
    const objectName = `videos/project_${projectId}/final_${projectId}.mp4`;
    const localPath = path.join(OUTPUT_DIR, `project_${projectId}`, `final_${projectId}.mp4`);
    await serveProjectFile(res, req, objectName, localPath, "video/mp4");
  } catch (err: any) {
    if (!res.headersSent) res.status(500).json({ error: "영상 파일 제공 실패" });
  }
});

router.get("/projects/:id/thumbnail-file", async (req, res): Promise<void> => {
  try {
    const projectId = parseInt(req.params.id);
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));

    let storagePath = `videos/project_${projectId}/thumbnail_${projectId}.png`;
    let localPath = path.join(OUTPUT_DIR, `project_${projectId}`, `thumbnail_${projectId}.png`);
    let contentType = "image/png";

    if (project?.thumbnailUrl) {
      const urlPath = project.thumbnailUrl.replace(/^\/storage\//, "");
      const ext = path.extname(urlPath).toLowerCase();
      if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
      else if (ext === ".webp") contentType = "image/webp";
      storagePath = urlPath;
      localPath = path.join(OUTPUT_DIR, `project_${projectId}`, path.basename(urlPath));
    }

    await serveProjectFile(res, req, storagePath, localPath, contentType);
  } catch (err: any) {
    if (!res.headersSent) res.status(500).json({ error: "썸네일 파일 제공 실패" });
  }
});

export default router;
