import { Router } from "express";
import { db } from "@workspace/db";
import { settings } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

const ALLOWED_KEYS = new Set(["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "XAI_API_KEY", "PEXELS_API_KEY", "YOUTUBE_API_KEY", "ELEVENLABS_VOICE_ID", "CHANNEL_NAME"]);
const NON_SECRET_KEYS = new Set(["ELEVENLABS_VOICE_ID", "CHANNEL_NAME"]);

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

router.get("/voices", async (_req, res) => {
  try {
    const allSettings = await db.select().from(settings);
    const settingsMap: Record<string, string> = {};
    for (const s of allSettings) settingsMap[s.key] = s.value;

    const apiKey = settingsMap.ELEVENLABS_API_KEY;
    if (!apiKey) return res.status(400).json({ error: "ElevenLabs API 키가 설정되지 않았습니다." });

    try {
      const response = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": apiKey },
      });

      if (response.ok) {
        const data = await response.json() as { voices: Array<{ voice_id: string; name: string; labels?: Record<string, string>; preview_url?: string; category?: string }> };
        const voices = data.voices.map((v) => ({
          id: v.voice_id,
          name: v.name,
          gender: v.labels?.gender || "",
          accent: v.labels?.accent || "",
          description: v.labels?.description || "",
          useCase: v.labels?.use_case || "",
          previewUrl: v.preview_url || null,
          category: v.category || "",
        }));
        return res.json(voices);
      }
    } catch {}

    const defaultVoices = [
      { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", gender: "남성", accent: "american", description: "깊고 차분한 목소리", useCase: "narration", previewUrl: null, category: "premade" },
      { id: "ErXwobaYiN019PkySvjV", name: "Antoni", gender: "남성", accent: "american", description: "부드럽고 따뜻한 목소리", useCase: "narration", previewUrl: null, category: "premade" },
      { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", gender: "남성", accent: "american", description: "강하고 힘 있는 목소리", useCase: "narration", previewUrl: null, category: "premade" },
      { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", gender: "여성", accent: "american", description: "차분하고 전문적인 목소리", useCase: "narration", previewUrl: null, category: "premade" },
      { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", gender: "여성", accent: "american", description: "활기차고 밝은 목소리", useCase: "narration", previewUrl: null, category: "premade" },
      { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", gender: "여성", accent: "american", description: "부드럽고 자연스러운 목소리", useCase: "narration", previewUrl: null, category: "premade" },
      { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", gender: "여성", accent: "american", description: "젊고 가벼운 목소리", useCase: "narration", previewUrl: null, category: "premade" },
      { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", gender: "남성", accent: "american", description: "젊고 에너지 넘치는 목소리", useCase: "narration", previewUrl: null, category: "premade" },
      { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam", gender: "남성", accent: "american", description: "따뜻하고 친근한 목소리", useCase: "narration", previewUrl: null, category: "premade" },
      { id: "jBpfuIE2acCO8z3wKNLl", name: "Gigi", gender: "여성", accent: "american", description: "밝고 활발한 목소리", useCase: "narration", previewUrl: null, category: "premade" },
    ];
    res.json(defaultVoices);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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

    const sampleText = "안녕하세요.";

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
      const errText = await response.text();
      if (response.status === 401) {
        try {
          const parsed = JSON.parse(errText);
          if (parsed?.detail?.status === "quota_exceeded" || errText.includes("quota")) {
            return res.status(402).json({ error: "ElevenLabs 문자 할당량이 초과되었습니다. 플랜을 업그레이드하거나 다음 달까지 기다려주세요." });
          }
        } catch {}
        return res.status(401).json({ error: "ElevenLabs API 키가 유효하지 않습니다." });
      }
      if (response.status === 402) {
        return res.status(402).json({ error: "ElevenLabs 문자 할당량이 초과되었습니다. 플랜을 업그레이드하거나 다음 달까지 기다려주세요." });
      }
      return res.status(response.status).json({ error: `ElevenLabs 오류: ${errText}` });
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
