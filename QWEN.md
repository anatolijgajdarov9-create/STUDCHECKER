# StudChecker (АСПСР) — QWEN Context

## Project Overview

**StudChecker** (product name: **АСПСР**) — an Electron desktop application powered by a local `llama-server` for AI-based assessment of student works. The system automates grading of academic papers (courseworks, essays, lab reports, etc.) using locally-run LLM models in GGUF format, eliminating the need for cloud APIs.

### Architecture

```
┌─────────────────────────────────────────────────┐
│  Electron Main Process (TypeScript)             │
│  - llama-server lifecycle (start/stop/switch)   │
│  - IPC handlers (llama, fs, http proxy)         │
│  - File system access (aimodels/, temp/)        │
└──────────────┬──────────────────────────────────┘
               │  IPC (contextBridge)
┌──────────────▼──────────────────────────────────┐
│  Preload Script                                 │
│  - electronAPI exposed to renderer              │
└──────────────┬──────────────────────────────────┘
               │  contextBridge
┌──────────────▼──────────────────────────────────┐
│  React Renderer (TypeScript + Tailwind CSS)     │
│  - Components: FileUpload, ModelSelector,       │
│    RubricPanel, AnalysisCenter, LogConsole,     │
│    SourcesPanel, ModelJournal, StatsHistory,    │
│    KnowledgeBasePanel, ResultsModal, etc.       │
│  - State: Zustand (persisted to localStorage)   │
│  - Services: llamaApi, fileParser,              │
│    imageAnalyzer, plagiarismChecker, ragService │
└─────────────────────────────────────────────────┘
```

### Key Features

- **Local LLM inference** — uses `llama-server.exe` (bundled in `temp/`) with GGUF models from `aimodels/`
- **Multi-file support** — PDF, DOCX, TXT, MD, and source code files (parsed via `pdfjs-dist`, `mammoth`, `marked`)
- **Custom rubrics** — user-definable grading rubrics with weighted criteria; default rubric included
- **Rubric generator** — AI-powered rubric creation based on assignment description
- **Expert-step workflow** — multi-stage evaluation where each criterion can use different models
- **Plagiarism checking** — URL-level originality verification via native HTTP proxy (bypasses CORS)
- **RAG knowledge base** — stores past results for contextual reference
- **Request journal** — logs every model prompt/response for auditability
- **Light & dark UI themes** — two complete UI prototypes exist (`Def.txt.txt` = dark, `UI.txt.txt` = light); current implementation uses light theme with Tailwind CSS
- **NSIS installer** — Windows distribution with custom branding (icons, sidebar, header)

### Tech Stack

| Layer        | Technology                          |
|--------------|-------------------------------------|
| Runtime      | Electron 29, Node.js                |
| Frontend     | React 18, TypeScript, Vite 5        |
| Styling      | Tailwind CSS 3, PostCSS, Autoprefixer |
| State Mgmt   | Zustand 4 (with persist middleware) |
| Charts       | Chart.js 4 + react-chartjs-2        |
| File Parsing | pdfjs-dist, mammoth, marked         |
| Build        | electron-vite, electron-builder     |
| Installer    | NSIS (Windows)                      |

---

## Project Structure

```
studchecker/
├── electron/
│   ├── main/index.ts          # Electron main process, llama-server IPC
│   └── preload/index.ts       # Preload script, contextBridge API
├── src/
│   ├── components/            # React UI components (16 files)
│   ├── services/              # Business logic services
│   │   ├── fileParser.ts      # PDF/DOCX/TXT parsing + document stats
│   │   ├── imageAnalyzer.ts   # Image extraction & vision analysis
│   │   ├── llamaApi.ts        # llama-server HTTP API client (domain-aware)
│   │   ├── modelSelector.ts   # AI model selection + capability estimation
│   │   ├── plagiarismChecker.ts  # Plagiarism detection with caching
│   │   ├── ragService.ts      # RAG knowledge base (TF-IDF + cosine)
│   │   ├── promptTemplates.ts # Domain-adapted prompt templates (NEW)
│   │   └── scoringNormalizer.ts # Score normalization & outlier detection (NEW)
│   ├── store/
│   │   └── useStore.ts        # Zustand global state (persisted)
│   ├── types/
│   │   └── index.ts           # TypeScript interfaces
│   ├── App.tsx                # Root component, 3-column layout
│   ├── main.tsx               # React entry point
│   └── index.css              # Global styles
├── scripts/
│   ├── build.js               # Runs electron-vite build
│   ├── dev.js                 # Runs electron-vite dev
│   ├── pack.js                # Windows packaging script
│   └── generate-bitmaps.js    # Generates bitmap resources
├── aimodels/                  # GGUF model files (git-ignored)
├── temp/                      # llama-server.exe (git-ignored)
├── build/                     # Installer resources (git-ignored)
├── dist/                      # Build output (git-ignored)
├── docs/                      # Documentation (git-ignored)
├── Def.txt.txt                # Dark theme UI prototype (reference)
├── UI.txt.txt                 # Light theme UI prototype (reference)
├── installer_template.txt     # Inno Setup installer template
├── electron.vite.config.ts    # Vite config for electron
├── tailwind.config.js         # Tailwind configuration
├── package.json               # Dependencies + electron-builder config
└── tsconfig.json              # TypeScript project references
```

---

## Building and Running

### Prerequisites

- Node.js 18+
- `temp/llama-server.exe` — llama-server binary (place in `temp/`)
- GGUF models in `aimodels/` directory

### Development

```bash
npm install          # Install dependencies
npm run dev          # Start Electron in dev mode (with hot reload)
```

### Production Build

```bash
npm run build        # Build all bundles (main, preload, renderer)
npm run build:win    # Build + create Windows NSIS installer
npm run pack:win     # Build + package as Windows .exe installer
```

### Dev Server

- Vite dev server runs on `127.0.0.1:5173`
- Electron loads from the dev server URL when `ELECTRON_RENDERER_URL` env var is set

---

## Development Conventions

### State Management
- All application state lives in `src/store/useStore.ts` using Zustand
- Persisted keys: `config`, `rubrics`, `selectedRubricId`, `history`
- Use the store for shared state; local component state for UI-only concerns

### TypeScript
- Strict mode enabled via project-referenced tsconfigs
- All types defined in `src/types/index.ts`
- Use explicit return types in IPC handlers

### IPC Communication
- Main process exposes handlers via `ipcMain.handle()`
- Preload script bridges via `contextBridge.exposeInMainWorld('electronAPI', ...)`
- Renderer accesses Electron APIs through `window.electronAPI`

### UI Patterns
- Three-column responsive layout (3-6-3 grid on lg screens)
- Tab-based navigation in center and right columns
- Glassmorphism card styling with backdrop blur
- All icons from Font Awesome (`fa-solid`)
- Toast notifications for user feedback

### Logging
- Use `addLog(message, type)` from store (`type`: `'info' | 'success' | 'error' | 'warning'`)
- Request-level logs stored in `requestLogs` (model prompt/response/duration)
- Console UI in `LogConsole.tsx` component

### llama-server Integration
- Default port: `8080` (configurable via `config.llamaPort`)
- Models loaded from `aimodels/` directory (`.gguf` files only)
- Server auto-starts when analysis begins if not already running
- 2-minute timeout for server readiness check
- GPU acceleration disabled globally (`app.disableHardwareAcceleration()`)

---

## Key IPC Channels

| Channel              | Direction     | Description                          |
|----------------------|---------------|--------------------------------------|
| `llama:start`        | Renderer→Main | Start llama-server with model+port   |
| `llama:switch`       | Renderer→Main | Stop current, load new model         |
| `llama:stop`         | Renderer→Main | Stop llama-server                    |
| `llama:status`       | Renderer→Main | Check if server is running           |
| `dialog:open-model`  | Renderer→Main | Open file dialog for .gguf selection |
| `fs:list-aimodels`   | Renderer→Main | List .gguf files in aimodels/        |
| `http:fetch`         | Renderer→Main | Native HTTP GET (CORS bypass)        |
| `update-progress`    | Main→Renderer | Progress updates (event)             |

---

## Notes

- **GPU disabled**: `app.disableHardwareAcceleration()` and `--disable-gpu` flags are set to prevent crashes on incompatible GPUs
- **Context isolation**: Enabled with sandbox mode; `nodeIntegration` is `false`
- **Web security**: Disabled (`webSecurity: false`) to allow local file access
- **Response limits**: HTTP proxy caps responses at 2MB
- **Log limits**: Application logs capped at 200 entries; request logs at 300
- **History limit**: Stored results capped at 30 entries

---

## Improvements Applied (April 2026)

### 1. `promptTemplates.ts` — Domain-Adapted Prompt System
- **What**: Centralized prompt template engine that adapts evaluation prompts to:
  - Work type (реферат, курсовая, лаб. работа, эссе, диплом, etc.)
  - Domain (technical/STEM, humanities, business, mixed)
  - Text complexity (sentence length + keyword density)
- **Why**: 8B models respond much better when prompts include domain-specific guidance and scoring examples relevant to the work type
- **Key exports**: `buildCriterionPrompt()`, `getDomainFewShotExamples()`, `detectWorkTypeWithConfidence()`, `getOptimalTemperature()`, `getOptimalMaxTokens()`

### 2. `llamaApi.ts` — Domain-Aware Evaluation
- **What**: `evaluateCriterion()` now uses:
  - Auto-detected domain from content analysis
  - Domain-specific few-shot examples (technical vs humanities vs business)
  - Dynamic temperature (lower for technical, slightly higher for humanities)
  - Dynamic maxTokens based on criterion complexity
  - Score scale injection per work type
- **Why**: 8B models need explicit guidance on scoring standards for each domain

### 3. `modelSelector.ts` — Architecture-Aware Capability Estimation
- **What**: `estimateCapability()` now considers both file size AND model architecture
- **How**: Uses `ARCHITECTURE_MULTIPLIER` table with 20+ known model families (Qwen2.5 +15%, Llama-3 +12%, Mistral +10%, etc.)
- **Why**: A 4GB Qwen2.5 model outperforms a 4GB Llama-2 model significantly
- **Breaking change**: `parseModels()` now sorts by capability (not size)

### 4. `plagiarismChecker.ts` — Result Caching
- **What**: DuckDuckGo search results and fetched page texts are cached in localStorage
- **TTL**: 24 hours, max 200 entries, auto-eviction of oldest
- **Why**: Repeat checks on similar texts don't re-fetch the same URLs, saving 30-60s per check

### 5. `ragService.ts` — Enhanced Work Type Detection
- **What**: `detectWorkType()` now returns `{ workType, confidence }` with:
  - 12 work types (added: диссертация, статья)
  - English pattern support (thesis, essay, lab work, etc.)
  - Confidence scoring based on match strength
- **Why**: More accurate work type detection improves prompt adaptation

### 6. `fileParser.ts` — Document Statistics
- **What**: `extractText()` now returns `ParseResult { content, stats }` with:
  - charCount, wordCount, sentenceCount, paragraphCount
  - pageCount (for PDF)
  - avgSentenceLen, avgParagraphLen
- **Why**: Stats are logged on upload for user visibility and can feed future analysis

### 7. `scoringNormalizer.ts` — Score Normalization & Outlier Detection
- **What**: New service that:
  - Detects score outliers using IQR method
  - Computes z-scores for each criterion
  - Gently adjusts outlier scores toward the mean
  - Provides consistency score (0-100) for overall evaluation quality
- **Why**: 8B models can produce outlier scores; normalization catches and flags them
- **Key exports**: `normalizeScores()`, `consistencyScore()`, `buildNormalizationReport()`

### 8. `AnalysisCenter.tsx` — Integrated Content Analysis
- **What**: Content analysis (domain, complexity, work type) is now computed once at start and passed to all LLM calls via `apiConfig.contentAnalysis` and `apiConfig.workType`
- **Why**: Eliminates redundant analysis and ensures consistent domain awareness across all criteria