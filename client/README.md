# 💻 DevPilot Web Client

The frontend interface for **DevPilot** — an autonomous AI-powered codebase understanding, testing, debugging, and automated pull request platform.

## 🚀 Overview & Tech Stack

- **Framework**: React 19 + Vite 8
- **Routing**: React Router v7
- **Styling**: Modern Glassmorphic Dark UI (pure CSS variables & backdrop filters)
- **Icons**: Lucide React
- **HTTP Client**: Axios with centralized request/response interceptors
- **Static Analysis**: Oxlint (ultra-fast linter)

---

## 🏛️ Architecture & Key Components

1. **Authentication Context (`src/context/AuthContext.jsx`)**:
   - Manages user session state, JWT tokens, and user profile data.
   - Centralizes Axios interceptors to attach `Authorization: Bearer <token>` on all requests.
   - Automatically handles session expiration and token revocation (redirecting to `/login`).

2. **Dashboard (`src/pages/Dashboard.jsx`)**:
   - Repository project grid with real-time indexing status indicators (`queued`, `active`, `indexed`, `failed`).
   - Project quick actions: View details, trigger AST scan, launch test cockpit, open codebase chat drawer.

3. **Codebase Chat Drawer (`src/components/CodebaseChatDrawer.jsx`)**:
   - Slide-out glassmorphic panel with Server-Sent Events (SSE) streaming token output (`/api/chat/stream`).
   - Markdown syntax highlighting, inline source code citations `[filename:line]`, and query history.

4. **Test Cockpit Modal (`src/components/TestCockpitModal.jsx`)**:
   - Sandboxed test execution dashboard showing live container output, duration, and status.
   - Command allow-list selection (`npm test`, `pytest`, `cargo test`, etc.).
   - Historical test runs table with status badges and one-click "Ask AI to Fix" integration.

5. **Patch Review Modal (`src/components/PatchReviewModal.jsx`)**:
   - Split-view unified diff inspector for AI-generated code patches.
   - In-browser code editing and one-click GitHub Pull Request creation.

---

## 🛠️ Getting Started

### 1. Prerequisites
- Node.js (v18+)
- Running DevPilot Backend API server (`http://localhost:5000`)

### 2. Installation
```bash
cd client
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env`:
```env
# Point to DevPilot backend API (defaults to http://localhost:5000/api)
VITE_API_URL=http://localhost:5000/api
```

### 4. Running the Development Server
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### 5. Code Quality & Build
```bash
# Run oxlint fast static analysis
npm run lint

# Build production bundle
npm run build

# Preview production build
npm run preview
```
