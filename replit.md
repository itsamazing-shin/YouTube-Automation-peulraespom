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
- **AI APIs**: Gemini 2.5 Flash (대본 생성, 실시간 검색), OpenAI (GPT-4o 폴백 + gpt-image-1), ElevenLabs TTS, Pexels (스톡 이미지), xAI Grok (optional)

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

1. **Script Generation** (GPT-4o): Topic → structured JSON script with sections, dynamic narration length per duration
2. **TTS** (ElevenLabs): Per-section narration audio generation
3. **Subtitle Timing** (Whisper): Accurate speech-to-text timing via OpenAI Whisper
4. **Image Generation** (gpt-image-1): Per-section scene images; for cinematic style, supplemented with Pexels stock images
5. **Pexels Integration** (cinematic only): GPT-4o-mini extracts keywords → Pexels API fetches 1-2 supplementary images per section → multi-image composition with Ken Burns
6. **Video Composition** (FFmpeg): Static image + audio mux with scale/pad filter only (no drawtext, no zoompan — removed for production reliability). Uses `spawn` for FFmpeg process management (no buffer overflow). 24fps, ultrafast preset, CRF 28.
7. **Subtitles**: Generated as SRT files per section (not hardcoded into video via drawtext — too CPU-heavy for production). SRT available for download/embedding.
8. **Channel Logo Overlay**: Logo displayed top-left on all video sections and thumbnails (200px landscape / 160px portrait)
9. **Subscribe CTA** (auto): At ~50% mark of long-form videos, a subscribe/bell section is auto-inserted with TTS narration + visual overlay (skipped for Shorts)
10. **Concatenation** (FFmpeg): Merge all sections into final MP4 with `-c copy` (no re-encode)
11. **Thumbnail**: User can upload custom thumbnail or AI-generate with gpt-image-1; text overlay (line1=yellow 120px, line2=white 100px). Font path uses multi-candidate resolution for dev/prod compatibility.

## Key Design Decisions

- **Sales model**: Users provide their own API keys (stored in DB settings table)
- **Dark theme**: Default dark mode with purple accent (HSL 243 75% 59%)
- **Korean UI**: All interface text in Korean
- **Supported formats**: Long-form (1920x1080) and Shorts (1080x1920)
- **Visual styles**: Cinematic, Simple Character (stickman), Infographic, Webtoon
- **FFmpeg production constraints**: No drawtext chains (hangs on limited CPU), no zoompan (too slow). Only scale+pad for video, drawtext only for single-image thumbnail. Uses `spawn` instead of `execFile` (buffer overflow prevention).
- **Font path**: Multi-candidate resolution (`cwd/assets`, `cwd/../assets`, `cwd/../../assets`, absolute fallback) for dev/prod compatibility
- **Vite proxy**: Frontend proxies /api/* requests to API server (port 8080) for video/file serving
- **Section counts**: 1min=4, 5min=8, 10min=12, 15min=16 sections (Shorts=3)
- **Narration length**: Dynamic per duration — 1min: 80-150자, 5min: 200-350자, 10min: 350-500자, 15min: 350-500자
- **Pexels supplementary images**: Only for cinematic style; other styles (character, infographic, webtoon) use AI images only to avoid style mismatch
- **Thumbnail upload**: Users can upload custom thumbnails via `/projects/:id/upload-thumbnail`
- **Grok/xAI**: Optional (requires XAI_API_KEY with credits), falls back to gpt-image-1
