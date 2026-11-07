# 🚀 DevPilot

[![DevPilot CI](https://github.com/harsh2102004/devpilot/actions/workflows/ci.yml/badge.svg)](https://github.com/harsh2102004/devpilot/actions/workflows/ci.yml)

> **Autonomous AI-Powered Codebase Understanding, Testing, Debugging & Automated Fix Platform**

DevPilot is an advanced developer productivity platform that connects to GitHub repositories to inspect, understand, test, debug, and safely propose fixes for codebases. Unlike generic AI chatbots that only receive small code snippets in a prompt, DevPilot analyzes the repository as an interconnected system of files, functions, AST nodes, imports, and execution relationships.

> 📚 **Architecture & Interview Preparation Hub**: DevPilot includes an interactive architectural guide and senior engineering interview preparation portal. Open [`docs/index.html`](docs/index.html) in your browser, or run `node docs/serve.js` to serve it locally on `http://localhost:8080`.

---

## 🌟 Key Architecture & Capabilities

- **JWT Authentication & Multi-Tenant Data Isolation**: Secure registration/login with bcrypt password hashing, token revocation blacklisting (`tokenRevocation.service.js`), and strict per-project owner authorization across all API routes.
- **GitHub Integration**: Direct repository and branch cloning, validation against malicious argument flags, and AES-256-GCM encrypted token storage.
- **Asynchronous Processing (Redis + BullMQ)**: Out-of-band repository scans and sandboxed test runs with real-time status transitions (`queued` → `active` → `indexed` / `passed`).
- **AST Code Analysis (`@babel/parser`)**: Extracts functions, async handlers, classes, parameters, imports, exports, and call expressions without relying on brittle regex.
- **Code Graph Engine**: Resolves file dependencies, function calls, and import relationships into a navigable dependency and call graph stored in MongoDB.
- **Semantic Code Chunking & Vector DB (Pinecone)**: AST-aware semantic chunking with contextual metadata banners, 3072-dim embeddings (`text-embedding-3-large`), and multi-tenant isolated namespaces (`project-${projectId}`).
- **Hybrid RAG Retrieval Engine**: Fuses dense vector similarity with 1-hop AST call-graph traversal (callers, callees, and imported definitions) with anti-injection XML boundaries.
- **AI Codebase Chat with Streaming SSE**: Real-time token streaming (`/api/chat/stream`), citations with line references `[filename:line]`, and glassmorphic slide-out chat drawer.
- **Sandboxed Container Test Execution**: Executes test suites inside isolated Docker containers with non-root user execution (`--user 1000:1000`), network isolation (`--network none`), read-only mounts (`:ro`), dropped capabilities (`--cap-drop=ALL`), and a fixed test command allow-list.
- **Autonomous Verification Loop & Automated PRs**: Automatically detects test failures, prompts an AI debugging agent to generate unified diff patches, verifies fixes inside the sandbox, and opens a GitHub Pull Request with verification logs.
- **Automated CI & Production Hardening**: Fully automated GitHub Actions CI workflow (oxlint, Vite build, node:test suite with 70+ assertions), rate limiting, helmet security headers, and rootless Docker Compose setup.

---

## 🏛️ System Architecture

```text
               ┌───────────────────────┐
               │    React Frontend     │
               │ (Glassmorphic UI)     │
               └───────────┬───────────┘
                           │ HTTP / REST / SSE Stream
                           ▼
               ┌───────────────────────┐
               │   Express API Server  │
               │ (Auth, Projects, Scan)│
               │ (Chat Stream & Query) │
               └─────┬───────────┬─────┘
                     │           │
           Enqueue   │           │ Query / Persist
              Jobs   ▼           ▼
        ┌──────────────┐     ┌──────────────┐     ┌────────────────┐
        │ Redis Queue  │     │   MongoDB    │     │ Pinecone Index │
        │   (BullMQ)   │     │  (Datastore) │     │  (3072-dim DB) │
        └──────┬───────┘     └──────────────┘     └───────▲────────┘
               │ Consume                                  │
               ▼                                          │
        ┌───────────────────────┐                         │
        │   Background Worker   │                         │
        │ (scanner.worker.js)   │                         │
        └──────────┬────────────┘                         │
                   │                                      │
         ┌─────────┼─────────┬──────────────────┐         │
         ▼         ▼         ▼                  ▼         │
┌──────────────┐ ┌────────┐ ┌─────────────┐ ┌───────────┐ │
│ File Walker  │ │  AST   │ │ Code Graph  │ │  Chunker  │ │
│(fileWalker.js│ │ Parser │ │(codeGraph.js│ │& Embedder ├─┘
└──────────────┘ └────────┘ └─────────────┘ └───────────┘
```

---

## 📂 Project Structure

```text
devpilot/
├── .github/workflows/ci.yml    # GitHub Actions automated test & lint CI pipeline
├── docker-compose.yml          # Production multi-container orchestration configuration
├── docs/                       # Architecture Portal & Interview Preparation Hub
│   ├── index.html              # Interactive documentation entrypoint
│   ├── serve.js                # Local HTTP documentation server (port 8080)
│   └── phases/                 # Deep architectural walkthroughs for Phases 1-10
│
├── client/                     # React 19 / Vite Frontend
│   ├── src/
│   │   ├── components/         # CodebaseChatDrawer, TestCockpitModal, PatchReviewModal, etc.
│   │   ├── context/            # AuthContext (JWT session state & axios interceptor)
│   │   ├── pages/              # Dashboard, Login, Register, Home
│   │   └── index.css           # Glassmorphic design tokens & dark styling
│   ├── nginx.conf              # Production Nginx reverse-proxy configuration
│   ├── Dockerfile              # Multi-stage production container image
│   └── package.json
│
├── server/                     # Node.js Express Backend (Native ESM)
│   ├── src/
│   │   ├── config/             # Environment validator & Redis connection manager
│   │   ├── controllers/        # Auth, Project, Scan, Chat, Test, GitHub controllers
│   │   ├── db/                 # MongoDB Mongoose connection
│   │   ├── middleware/         # Auth, validateObjectId, Multer, rateLimiter
│   │   ├── models/             # User, Project, Job, TestRun, CodeGraph schemas
│   │   ├── queues/             # BullMQ producers (`scan.queue.js`, `test.queue.js`)
│   │   ├── routes/             # REST route endpoints
│   │   ├── services/
│   │   │   ├── ast.services.js            # Babel AST parser & visitor engine
│   │   │   ├── chunker.service.js         # AST-aware semantic code chunker
│   │   │   ├── codeGraph.service.js       # Multi-file dependency & call graph builder
│   │   │   ├── debugAgent.service.js      # AI failure analyzer & fix strategy generator
│   │   │   ├── embedding.service.js       # 3072-dim vector embedder (OpenAI / offline)
│   │   │   ├── fileWalker.service.js      # Safe repo crawler with ignore rules
│   │   │   ├── githubPr.service.js        # Automated branch creation & pull request engine
│   │   │   ├── hybridRetriever.service.js # Vector + AST Graph hybrid retrieval
│   │   │   ├── llm.service.js             # Multi-provider LLM client with streaming
│   │   │   ├── patchGenerator.service.js  # Unified diff & replacement patch generator
│   │   │   ├── repoCloner.service.js      # Sandboxed git repository cloner
│   │   │   ├── sandbox.service.js         # Containerized Docker runner with security caps
│   │   │   ├── tokenEncryption.service.js # AES-256-GCM GitHub token encryption
│   │   │   ├── tokenRevocation.service.js # JWT blacklist & session revocation engine
│   │   │   ├── vectorDb.service.js        # Pinecone vector database service
│   │   │   └── verificationLoop.service.js# Autonomous test-debug-verify-PR workflow
│   │   ├── workers/            # Background BullMQ workers (`scanner.worker.js`, `test.worker.js`)
│   │   ├── app.js              # Express app setup, CORS, and Helmet configuration
│   │   └── index.js            # Server entrypoint
│   ├── tests/                  # Automated node:test & supertest test suites
│   ├── Dockerfile              # Production non-root (USER node) container image
│   └── package.json
│
└── README.md
```

---

## ⚠️ Limitations & Known Fallbacks

To ensure transparent and predictable operation in both development and production environments, please note the following design characteristics and fallbacks:

### 1. Offline Deterministic Fallbacks (Not Real AI Outputs)
DevPilot is designed to run seamlessly out-of-the-box for local testing without mandatory third-party subscriptions:
- **Vector Embeddings Without OpenAI Key**: If `OPENAI_API_KEY` is omitted or invalid, DevPilot automatically activates `generateOfflineEmbedding`. This generates deterministic, unit-normalized 3072-dimensional polynomial rolling hash vectors. While these preserve keyword overlap for testing search algorithms, **they are not real semantic AI neural embeddings**.
- **Codebase Chat Without LLM Key**: If neither `OPENAI_API_KEY` nor `MOONSHOT_API_KEY` is provided, DevPilot runs `generateOfflineChatResponse`. This heuristic fallback formats a structured response directly from the retrieved AST code context. **These are rule-based templated responses, not generative neural network completions**.
- **Vector Database Without Pinecone Key**: If `PINECONE_API_KEY` is omitted, vector operations fall back to an internal mock store without failing the background scanning worker.

### 2. Sandboxed Test Execution & Docker Daemon
- **Fail-Closed Container Security**: Test execution requires an accessible Docker daemon on the host. If Docker is offline and `NODE_ENV=production`, test execution requests immediately fail-closed and return `503 Service Unavailable ("sandbox unavailable: Docker daemon is not running or accessible")`.
- **Local Dev Bypass (`ALLOW_UNSAFE_LOCAL_SANDBOX`)**: For development on machines without Docker installed, setting `ALLOW_UNSAFE_LOCAL_SANDBOX=true` in `.env` enables local process-isolated execution. This fallback is strictly blocked in production (`NODE_ENV=production`).
- **Command Allow-List**: For security, only approved test commands (`npm test`, `npx jest`, `npx vitest run`, `pytest`, `cargo test`, `go test ./...`) can be executed. Arbitrary free-text commands are rejected with `400 Bad Request`.

### 3. GitHub Operations & Personal Access Tokens
- Creating branches and automated pull requests requires a GitHub personal access token with repository write scope (`repo`). Tokens are encrypted in MongoDB at rest using AES-256-GCM via `TOKEN_ENCRYPTION_KEY`.

---

## 🛠️ Getting Started from Scratch

### Prerequisites

- **Node.js** (v18 or v20 LTS recommended)
- **MongoDB** (v6.0+ local instance or MongoDB Atlas cluster)
- **Redis** (v7.0+ local instance or cloud Redis)
- **Docker** (required for containerized sandboxed test execution)
- *Optional*: OpenAI or Moonshot API key for live neural chat and embeddings
- *Optional*: Pinecone API key for cloud vector indexing

---

### Step 1: Clone the Repository

```bash
git clone https://github.com/harsh2102004/devpilot.git
cd devpilot
```

---

### Step 2: Configure Environment Variables

1. Copy the server template into `server/.env`:
```bash
cp server/.env.example server/.env
```

2. Open `server/.env` and update the required values. **All secrets marked with minimum 32 characters must meet this requirement or the server will fail startup validation**:
```env
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:5173

# MongoDB (minimum 32 characters required)
MONGO_URI=mongodb://127.0.0.1:27017/devpilot_database_instance_32chars!

# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT Secrets (minimum 32 characters required)
ACCESS_TOKEN_SECRET=super_secret_devpilot_access_key_2026_min32chars!
ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_SECRET=super_secret_devpilot_refresh_key_2026_min32chars!
REFRESH_TOKEN_EXPIRY=7d

# Token Encryption Key for GitHub credentials (minimum 32 characters required)
TOKEN_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# Sandboxed execution: set true for dev process sandbox when Docker is offline
ALLOW_UNSAFE_LOCAL_SANDBOX=true

# Optional: Live Vector DB & LLM
PINECONE_API_KEY=
PINECONE_INDEX_NAME=devpilot
OPENAI_API_KEY=
```

3. Copy the client template into `client/.env`:
```bash
cp client/.env.example client/.env
```
*(Default `VITE_API_URL=http://localhost:5000/api` is pre-configured).*

---

### Step 3: Install Dependencies

```bash
# Install backend dependencies
cd server
npm install

# Install frontend dependencies
cd ../client
npm install
```

---

### Step 4: Run the Application

In separate terminal windows:

#### 1. Start Redis & MongoDB
Ensure your local Redis and MongoDB instances are active:
```bash
# Start Redis (if not running as a system service)
redis-server

# Start MongoDB (if not running as a system service)
mongod
```

#### 2. Start the Backend API Server
```bash
cd server
npm run dev
```
*(Server listens on `http://localhost:5000`)*.

#### 3. Start the Background Queue Workers
```bash
cd server
# Scanner worker (processes AST scans and vector indexing)
npm run worker

# Optional: In another terminal, start the Test worker (processes sandboxed test jobs)
npm run worker:test
```

#### 4. Start the Frontend Development Server
```bash
cd client
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

### Step 5: Run Automated Tests & Quality Checks

DevPilot includes a complete suite of automated integration and unit tests using Node's native test runner (`node:test`) and Supertest:

```bash
# Run server test suites (70+ assertions covering auth, isolation, rate limits, sandbox, AST)
cd server
npm test

# Run frontend linting (oxlint)
cd ../client
npm run lint

# Verify client production build
cd ../client
npm run build
```

---

## 🐳 Running with Docker Compose

DevPilot provides a production-hardened `docker-compose.yml` that orchestrates the entire application with non-root containers, internal network isolation, and healthchecks:

```bash
# 1. Copy root environment template
cp .env.example .env

# 2. Build and run all services in detached mode
docker compose up --build -d

# 3. Check container status
docker compose ps
```

Services started:
- `client`: Accessible at `http://localhost:5173`
- `server`: API server running as `USER node` at `http://localhost:5000`
- `mongo`: Secured MongoDB internal database (`authSource=admin`)
- `redis`: Password-protected internal Redis queue store (`--requirepass`)
- `scanner-worker`: Background repository scan and AST indexing processor
- `test-worker`: Dedicated sandboxed test execution runner

---

## 🔒 Security Architecture & Hardening

DevPilot implements defense-in-depth security principles across every layer:

1. **Database & Cache Isolation**: MongoDB and Redis ports are unmapped from the host in production Docker Compose, communicating strictly over an internal bridge network with mandatory password authentication.
2. **Least Privilege (`USER node`)**: Backend server and worker containers run as unprivileged `node` users (UID 1000).
3. **Containerized Sandbox Isolation**: Code execution for test verification runs inside ephemeral Docker containers with `--network none`, `--cap-drop=ALL`, `--security-opt no-new-privileges:true`, and a `:ro` read-only root filesystem.
4. **JWT Revocation & Session Blacklisting**: Active sessions and access tokens can be immediately invalidated (`/api/auth/logout`, `/api/auth/revoke-all`), enforced via an in-memory and Redis TTL blacklist.
5. **Multi-Tenant Ownership Enforcement**: Every protected resource (`projects`, `scans`, `jobs`, `test-runs`, `chats`) filters database queries by authenticated user ID (`owner: req.user._id`), returning uniform `404 Not Found` for nonexistent and unauthorized resources alike.
6. **Rate Limiting & DoS Defense**: Stricter tier limits protect compute-intensive endpoints (`/api/scan`, `/api/test`, `/api/chat`, and `/api/auth/login`) with standardized `Retry-After` HTTP headers.
7. **Strict CORS & Helmet Security**: Removed `'unsafe-inline'` script CSP policies; CORS strictly allows whitelisted frontend origins across both development and production.

---

## 🗺️ Roadmap & Current Status

All core phases and security hardening tasks have been implemented:

- [x] **Phase 1**: Authentication, JWT Session Security, User Model & Bcrypt Hashing
- [x] **Phase 2**: Frontend Foundation, Modern Glassmorphism Design System, Protected Routes
- [x] **Phase 3**: Project Management Cockpit & Octokit GitHub Integration
- [x] **Phase 4**: Redis + BullMQ Queue Infrastructure, Job Lifecycle Model, Scan Controller
- [x] **Phase 5**: Safe File Walker, Babel AST Symbol Parser & Cross-file Code Graph Engine
- [x] **Phase 6**: Semantic Indexing & Vector Database (Pinecone, AST Chunking, Namespace Isolation)
- [x] **Phase 7**: AI Codebase Chat (Hybrid RAG: Vector + Code Graph, SSE Streaming, Drawer UI)
- [x] **Phase 8**: Sandboxed Test Execution & Docker Runner (Isolated Containers, Resource Caps, Non-root)
- [x] **Phase 9**: AI Debugging Agent, Patch Generator & Autonomous Pull Request Workflow
- [x] **Phase 10**: Production Deployment, Docker Compose, CI Pipeline, Rate Limiting, and Multi-Tenant Isolation

---

## 📄 License

ISC License. Built with ❤️ for developer productivity and codebase understanding.
