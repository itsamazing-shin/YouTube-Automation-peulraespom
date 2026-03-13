import { Router } from "express";
import { db } from "@workspace/db";
import { projects, settings } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { generateVideo, regenerateThumbnail } from "../lib/pipeline";
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

router.get("/projects", async (_req, res) => {
  try {
    const allProjects = await db.select().from(projects).orderBy(desc(projects.createdAt));
    res.json(allProjects);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

router.get("/projects/:id", async (req, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, parseInt(req.params.id)));
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch project" });
  }
});

router.post("/projects", async (req, res) => {
  try {
    const { title, topic, videoType, visualStyle, duration, tone, referenceUrl, referenceImageUrl } = req.body;
    if (!topic?.trim()) return res.status(400).json({ error: "Topic is required" });

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

router.post("/projects/:id/generate", async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (project.status === "generating") return res.status(409).json({ error: "이미 생성 중입니다. 잠시 기다려주세요." });

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
      return res.status(400).json({ error: "OpenAI API 키가 설정되지 않았습니다. Settings에서 등록해주세요." });
    }
    if (!settingsMap.ELEVENLABS_API_KEY) {
      return res.status(400).json({ error: "ElevenLabs API 키가 설정되지 않았습니다. Settings에서 등록해주세요." });
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

router.post("/projects/:id/regenerate-thumbnail", async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const { prompt } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: "썸네일 프롬프트를 입력해주세요." });

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) return res.status(404).json({ error: "Project not found" });

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
      return res.status(400).json({ error: "OpenAI API 키가 설정되지 않았습니다." });
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

router.post("/projects/:id/upload-thumbnail", upload.single("thumbnail"), async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    if (!req.file) return res.status(400).json({ error: "썸네일 이미지 파일이 필요합니다." });

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) return res.status(404).json({ error: "Project not found" });

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

router.post("/upload-reference-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "이미지 파일이 필요합니다." });
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

router.post("/upload-logo", logoUpload.single("logo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "로고 파일이 필요합니다." });
    const relativePath = `/files/logos/${req.file.filename}`;
    await db.insert(settings).values({ key: "CHANNEL_LOGO", value: relativePath })
      .onConflictDoUpdate({ target: settings.key, set: { value: relativePath } });
    res.json({ success: true, logoUrl: relativePath });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "로고 업로드 실패" });
  }
});

router.get("/logo", async (_req, res) => {
  try {
    const [row] = await db.select().from(settings).where(eq(settings.key, "CHANNEL_LOGO"));
    res.json({ logoUrl: row?.value || null });
  } catch {
    res.json({ logoUrl: null });
  }
});

router.delete("/logo", async (_req, res) => {
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

router.delete("/projects/:id", async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    await db.delete(projects).where(eq(projects.id, projectId));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete project" });
  }
});

export default router;
