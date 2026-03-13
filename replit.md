# Workspace

## Overview

YouTube Video Automation Dashboard (VideoForge) — pnpm workspace monorepo using TypeScript. Users input their own API keys and auto-generate complete YouTube videos via AI pipeline: GPT script → ElevenLabs TTS → gpt-image-1 images → Ken Burns slides → FFmpeg synthesis → downloadable MP4.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Frontend**: React + Vite + Shadcn UI + TanStack Query + Wouter
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **Video**: FFmpeg (Ken Burns, subtitles, concatenation)
- **AI APIs**: OpenAI (GPT-4o + gpt-image-1), ElevenLabs TTS, xAI Grok (optional)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   │   └── src/
│   │       ├── routes/     # API routes (health, settings, projects)
│   │       └── lib/        # Video generation pipeline
│   └── youtube-automation/ # React frontend dashboard
│       └── src/
│           ├── pages/      # Dashboard, CreateVideo, ProjectDetail, Settings
│           └── components/ # Shadcn UI components
├── lib/
│   └── db/                 # Drizzle ORM schema + DB connection
│       └── src/schema/     # projects, settings tables
├── scripts/                # Utility scripts
├── assets/fonts/           # NotoSansCJKkr-Bold.otf for Korean subtitles
└── output/                 # Generated video files (per project)
```

## Database Tables

- **projects**: Video generation jobs (id, title, topic, status, videoType, visualStyle, duration, tone, scriptJson, videoUrl, progress, etc.)
- **settings**: User API keys storage (key-value pairs: OPENAI_API_KEY, ELEVENLABS_API_KEY, XAI_API_KEY, PEXELS_API_KEY)

## API Endpoints

- `GET /api/healthz` — Health check
- `GET /api/settings` — List all settings
- `PUT /api/settings` — Save settings (bulk update)
- `GET /api/projects` — List all projects
- `POST /api/projects` — Create new project
- `GET /api/projects/:id` — Get project details
- `POST /api/projects/:id/generate` — Start video generation
- `DELETE /api/projects/:id` — Delete project
- `GET /api/files/*` — Serve generated video/image files

## Video Generation Pipeline

1. **Script Generation** (GPT-4o): Topic → structured JSON script with sections
2. **TTS** (ElevenLabs): Per-section narration audio generation
3. **Subtitle Timing** (Whisper): Accurate speech-to-text timing via OpenAI Whisper
4. **Image Generation** (Gemini → OpenAI fallback): Per-section scene images via Gemini 2.5 Flash Image, falls back to gpt-image-1
5. **Video Composition** (FFmpeg): Ken Burns effect + timed subtitle overlay per section
6. **Concatenation** (FFmpeg): Merge all sections into final MP4
7. **Thumbnail** (gpt-image-1): Auto-generated YouTube-style thumbnail (medium quality)

## Key Design Decisions

- **Sales model**: Users provide their own API keys (stored in DB settings table)
- **Dark theme**: Default dark mode with purple accent (HSL 243 75% 59%)
- **Korean UI**: All interface text in Korean
- **Supported formats**: Long-form (1920x1080) and Shorts (1080x1920)
- **Visual styles**: Cinematic, Simple Character (stickman), Infographic, Webtoon
- **Korean subtitles**: Uses NotoSansCJKkr-Bold.otf font (assets/fonts/) via FFmpeg drawtext fontfile parameter
- **Ken Burns**: Gentle zoom (0.0003/frame, max 1.12x) with 1.15x pre-scale for smooth motion
- **Vite proxy**: Frontend proxies /api/* requests to API server (port 8080) for video/file serving
- **Section counts**: 1min=4, 5min=8, 10min=12, 15min=16 sections (Shorts=3)
- **Narration**: Each section 3-5 sentences, 80-150+ characters for rich content
- **Grok/xAI**: Optional (requires XAI_API_KEY with credits), falls back to gpt-image-1
