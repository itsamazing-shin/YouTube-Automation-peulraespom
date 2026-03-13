import { Router } from "express";
import { db } from "@workspace/db";
import { projects, settings } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { generateVideo } from "../lib/pipeline";

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
    const { title, topic, videoType, visualStyle, duration, tone, referenceUrl } = req.body;
    if (!topic?.trim()) return res.status(400).json({ error: "Topic is required" });

    const [project] = await db.insert(projects).values({
      title: title || topic,
      topic,
      videoType: videoType || "longform",
      visualStyle: visualStyle || "cinematic",
      duration: duration || "10min",
      tone: tone || "calm",
      referenceUrl: referenceUrl || null,
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
