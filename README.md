# 🚀 DevPilot

> **AI-Powered Codebase Understanding, Testing, Debugging & Automated Fix Platform**

DevPilot is an advanced developer productivity platform that connects to GitHub repositories to inspect, understand, test, debug, and safely propose fixes for codebases. Unlike generic AI chatbots that only receive small code snippets in a prompt, DevPilot analyzes the repository as an interconnected system of files, functions, AST nodes, imports, and execution relationships.

> 📚 **Interview & Architecture Preparation Hub**: Explore our interactive [DevPilot Architecture & Interview Guide](docs/index.html) with system design diagrams, technical trade-offs, and curated Q&A flashcards!

## 🌟 Key Architecture & Highlights

- **JWT Authentication & Ownership Security**: Complete user registration/login flow with bcrypt password hashing and per-project ownership authorization.
- **GitHub Integration**: Direct GitHub repository and branch syncing using Octokit.
- **Asynchronous Processing (Redis + BullMQ)**: Expensive repository scans run out-of-band via background workers with real-time status reporting (`queued` → `active` → `indexed`).
- **AST Code Analysis (`@babel/parser`)**: Extracts functions, async handlers, classes, parameters, imports, exports, and call expressions without relying on brittle regex.
- **Code Graph Engine**: Resolves file dependencies, function calls, and import relationships to create a navigable symbol and dependency graph.
- **Semantic Code Chunking & Vector DB (Pinecone)**: AST-aware semantic chunking with contextual banners, 3072-dim embeddings (`text-embedding-3-large`), and multi-tenant isolated namespaces (`project-${projectId}`).
- **Hybrid RAG Retrieval Engine**: Fuses dense vector similarity with 1-hop AST call-graph traversal (callers, callees, and imported definitions) with anti-injection XML boundaries.
- **AI Codebase Chat with Streaming SSE**: Real-time token streaming (`/api/chat/stream`), citations with line references `[filename:line]`, and glassmorphic slide-out chat drawer.
- **Premium Glassmorphic UI**: React frontend styled with modern dark palette, responsive dashboard cards, interactive project management, and live chat drawer.

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
├── client/                     # React Frontend
│   ├── src/
│   │   ├── components/         # Navbar, ProjectCard, CodebaseChatDrawer, CreateProjectModal
│   │   ├── context/            # AuthContext (JWT session state & axios interceptor)
│   │   ├── pages/              # Dashboard, Login, Register, Home
│   │   └── index.css           # Glassmorphism design tokens & typography
│   └── package.json
│
├── server/                     # Node.js / Express Backend (Native ESM)
│   ├── src/
│   │   ├── config/             # Redis connection manager
│   │   ├── controllers/        # Auth, Project, GitHub, Scan, Chat controllers
│   │   ├── db/                 # MongoDB Mongoose connection
│   │   ├── middleware/         # JWT Auth & Multer upload middlewares
│   │   ├── models/             # User, Project, Job schemas & transition helpers
│   │   ├── queues/             # BullMQ queue producer (`scan.queue.js`)
│   │   ├── routes/             # Auth, Project, Scan, Chat route declarations
│   │   ├── services/
│   │   │   ├── ast.services.js         # Babel AST parser & visitor engine
│   │   │   ├── chunker.service.js      # AST-aware semantic code chunker
│   │   │   ├── codeGraph.service.js    # Multi-file dependency & call graph builder
│   │   │   ├── embedding.service.js    # 3072-dim vector embedder (OpenAI / offline)
│   │   │   ├── fileWalker.service.js   # Safe repo crawler with ignore rules
│   │   │   ├── github.service.js       # Octokit GitHub API service
│   │   │   ├── hybridRetriever.service.js # Vector + AST Graph hybrid retrieval
│   │   │   ├── llm.service.js          # Multi-provider LLM client with streaming
│   │   │   └── vectorDb.service.js     # Pinecone vector database service
│   │   ├── workers/            # Background BullMQ worker (`scanner.worker.js`)
│   │   ├── app.js              # Express app setup & CORS config
│   │   └── index.js            # Server entrypoint
│   └── package.json
│
└── README.md
```

---

## 🛠️ Getting Started

### Prerequisites

- **Node.js** (v18+)
- **MongoDB** (local or Atlas)
- **Redis** (running locally on port 6379 or remote URL)
- **Pinecone** API Key & Index (`devpilot` with 3072 dimensions)
- **OpenAI** / **Kimi Moonshot** API Key (optional for live LLM / embeddings, graceful fallbacks included)

### 1. Clone & Install

```bash
git clone https://github.com/harsh2102004/devpilot.git
cd devpilot
```

#### Backend Setup:
```bash
cd server
npm install
```

Create `.env` in the `server/` directory:
```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/devpilot
ACCESS_TOKEN_SECRET=your_jwt_secret_key
REFRESH_TOKEN_SECRET=your_jwt_refresh_secret
REDIS_HOST=localhost
REDIS_PORT=6379
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX=devpilot
OPENAI_API_KEY=your_openai_api_key
```

#### Frontend Setup:
```bash
cd ../client
npm install
```

---

### 2. Running Locally

#### Start Redis:
Ensure your Redis instance is running (`redis-server`).

#### Start the Backend API Server:
```bash
cd server
npm run dev
```

#### Start the Asynchronous Queue Worker:
```bash
cd server
npm run worker
```

#### Start the Frontend Client:
```bash
cd client
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## 🗺️ Roadmap & Current Status

- [x] **Phase 1**: Authentication, JWT Session Security, User Model & Bcrypt
- [x] **Phase 2**: Frontend Foundation, Modern Glassmorphism Design System, Protected Routes
- [x] **Phase 3**: Project Management Cockpit & Octokit GitHub Integration
- [x] **Phase 4**: Redis + BullMQ Queue Infrastructure, Job Lifecycle Model, Scan Controller
- [x] **Phase 5 (Core)**: File Walker, Babel AST Symbol Parser & Cross-file Code Graph Engine
- [x] **Phase 5 (Integration)**: Worker scan integration with persistent graph storage & querying API
- [x] **Phase 6**: Semantic Indexing & Vector Database (Pinecone, AST Chunking, Namespace Isolation)
- [x] **Phase 7**: AI Codebase Chat (Hybrid RAG: Vector + Code Graph, SSE Streaming, Drawer UI)
- [ ] **Phase 8**: Sandboxed Test Execution & Docker Runner
- [ ] **Phase 9**: AI Debugging Agent & Automated Pull Request Generator
- [ ] **Phase 10**: Production Deployment & Docker Compose

---

## 📄 License
ISC
