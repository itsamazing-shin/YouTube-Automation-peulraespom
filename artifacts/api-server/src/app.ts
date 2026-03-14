import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import router from "./routes";
import { objectStorageClient } from "./lib/objectStorage";

const app: Express = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

const outputDir = path.join(process.cwd(), "output");
app.use("/api/files", express.static(outputDir));

app.get("/api/storage/{*storagePath}", async (req: Request, res: Response) => {
  try {
    const rawPath = (req.params as any).storagePath;
    const storagePath = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;

    if (!storagePath.startsWith("videos/")) {
      res.status(403).json({ error: "접근이 거부되었습니다." });
      return;
    }

    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;

    const tryLocalFallback = () => {
      const localPath = path.join(outputDir, storagePath.replace("videos/", ""));
      if (fs.existsSync(localPath)) {
        const ext = path.extname(localPath).toLowerCase();
        const mimeMap: Record<string, string> = { ".mp4": "video/mp4", ".png": "image/png", ".jpg": "image/jpeg" };
        res.setHeader("Content-Type", mimeMap[ext] || "application/octet-stream");
        fs.createReadStream(localPath).pipe(res);
        return true;
      }
      return false;
    };

    if (!bucketId) {
      if (!tryLocalFallback()) {
        res.status(404).json({ error: "파일을 찾을 수 없습니다." });
      }
      return;
    }

    try {
      const bucket = objectStorageClient.bucket(bucketId);
      const file = bucket.file(storagePath);
      const [exists] = await file.exists();
      if (!exists) {
        if (!tryLocalFallback()) {
          res.status(404).json({ error: "파일을 찾을 수 없습니다." });
        }
        return;
      }
      const [metadata] = await file.getMetadata();
      const contentType = (metadata.contentType as string) || "application/octet-stream";
      const fileSize = Number(metadata.size || 0);

      res.setHeader("Content-Type", contentType);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "public, max-age=3600");

      const range = req.headers.range;
      if (range && fileSize > 0) {
        const match = range.match(/bytes=(\d*)-(\d*)/);
        if (!match) {
          res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
          return;
        }
        let start = match[1] ? parseInt(match[1], 10) : 0;
        let end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        if (!match[1] && match[2]) {
          start = Math.max(0, fileSize - parseInt(match[2], 10));
          end = fileSize - 1;
        }
        if (start >= fileSize || end >= fileSize || start > end) {
          res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
          return;
        }
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
        res.setHeader("Content-Length", String(end - start + 1));
        file.createReadStream({ start, end }).pipe(res);
      } else {
        if (fileSize) res.setHeader("Content-Length", String(fileSize));
        file.createReadStream().pipe(res);
      }
    } catch (gcsErr: any) {
      console.error("GCS error, trying local fallback:", gcsErr.message);
      if (!res.headersSent && !tryLocalFallback()) {
        res.status(500).json({ error: "파일 제공 실패" });
      }
    }
  } catch (err: any) {
    console.error("Storage serve error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "파일 제공 실패" });
    }
  }
});

app.use("/api", router);

const frontendDist = path.join(process.cwd(), "..", "youtube-automation", "dist", "public");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

export default app;
