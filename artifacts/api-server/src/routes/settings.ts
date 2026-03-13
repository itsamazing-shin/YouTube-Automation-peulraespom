import { Router } from "express";
import { db } from "@workspace/db";
import { settings } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

const ALLOWED_KEYS = new Set(["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "XAI_API_KEY", "PEXELS_API_KEY", "YOUTUBE_API_KEY", "ELEVENLABS_VOICE_ID"]);
const NON_SECRET_KEYS = new Set(["ELEVENLABS_VOICE_ID"]);

function maskApiKey(value: string): string {
  if (!value || value.length < 8) return "••••••••";
  return value.substring(0, 4) + "••••" + value.substring(value.length - 4);
}

router.get("/settings", async (_req, res) => {
  try {
    const allSettings = await db.select().from(settings);
    const masked = allSettings
      .filter((s) => ALLOWED_KEYS.has(s.key))
      .map((s) => ({
        key: s.key,
        value: NON_SECRET_KEYS.has(s.key) ? s.value : maskApiKey(s.value),
        label: s.label,
        hasValue: !!s.value?.trim(),
      }));
    res.json(masked);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const { settings: settingsData } = req.body as { settings: Record<string, string> };
    if (!settingsData || typeof settingsData !== "object") {
      return res.status(400).json({ error: "Invalid settings data" });
    }

    for (const [key, value] of Object.entries(settingsData)) {
      if (!ALLOWED_KEYS.has(key)) continue;
      if (!value || !value.trim()) {
        if (NON_SECRET_KEYS.has(key)) continue;
        continue;
      }

      const existing = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
      if (existing.length > 0) {
        await db.update(settings).set({ value: value.trim(), updatedAt: new Date() }).where(eq(settings.key, key));
      } else {
        await db.insert(settings).values({ key, value: value.trim() });
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to save settings" });
  }
});

router.post("/voice-preview", async (req, res) => {
  try {
    const { voiceId } = req.body as { voiceId: string };
    if (!voiceId) return res.status(400).json({ error: "voiceId required" });

    const allSettings = await db.select().from(settings);
    const settingsMap: Record<string, string> = {};
    for (const s of allSettings) settingsMap[s.key] = s.value;

    const apiKey = settingsMap.ELEVENLABS_API_KEY;
    if (!apiKey) return res.status(400).json({ error: "ElevenLabs API 키가 설정되지 않았습니다." });

    const sampleText = "안녕하세요, 이 음성은 미리듣기 샘플입니다. 영상에서 이 목소리로 나레이션이 생성됩니다.";

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text: sampleText,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: `ElevenLabs error: ${err}` });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.set("Content-Type", "audio/mpeg");
    res.set("Content-Length", String(buffer.length));
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
