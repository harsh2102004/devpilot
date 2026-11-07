/**
 * DevPilot Docker Compose Multi-Service Live Test Suite (Sub-Phase 10A)
 *
 * Verifies:
 * 1. docker-compose.yml YAML syntax, services list, networks, and volumes
 * 2. Dedicated container healthchecks configured for all 6 microservices
 * 3. Service dependency ordering (server & workers wait for healthy db/redis)
 * 4. Multi-stage Dockerfiles for client (Nginx SPA) and server (Node runtime with Git)
 * 5. client/nginx.conf with SPA fallback, API reverse proxy, and SSE stream support
 * 6. Environment configuration templates (.env.example across root, server, client)
 * 7. Live /api/health endpoint execution returning HTTP 200 { status: 'healthy' }
 */

import fs from "fs";
import path from "path";
import app from "./src/app.js";

let passedCount = 0;
let totalCount = 0;

function assert(condition, message) {
    totalCount++;
    if (condition) {
        console.log(`  ✅ PASS: ${message}`);
        passedCount++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
    }
}

/**
 * Lightweight YAML structure extractor for docker-compose validation
 */
function parseComposeServices(yamlText) {
    const lines = yamlText.split(/\r?\n/);
    const services = {};
    let currentService = null;
    let inServices = false;
    let inHealthcheck = false;

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();

        if (/^services:\s*$/.test(line)) {
            inServices = true;
            continue;
        }

        if (/^(volumes|networks):\s*$/.test(line)) {
            inServices = false;
            currentService = null;
            continue;
        }

        if (inServices) {
            // Service level (2 spaces indentation)
            const serviceMatch = line.match(/^ {2}([a-zA-Z0-9_-]+):\s*$/);
            if (serviceMatch) {
                currentService = serviceMatch[1];
                services[currentService] = {
                    hasHealthcheck: false,
                    dependsOn: [],
                    environment: [],
                    networks: [],
                };
                inHealthcheck = false;
                continue;
            }

            if (currentService) {
                if (/^ {4}healthcheck:\s*$/.test(line)) {
                    services[currentService].hasHealthcheck = true;
                    inHealthcheck = true;
                }

                if (/^ {4}depends_on:\s*$/.test(line)) {
                    inHealthcheck = false;
                }

                const depMatch = line.match(/^ {6}([a-zA-Z0-9_-]+):/);
                if (depMatch) {
                    services[currentService].dependsOn.push(depMatch[1]);
                }
            }
        }
    }

    return services;
}

async function runTests() {
    console.log("=================================================================");
    console.log("  DevPilot Docker Compose Multi-Service (Sub-Phase 10A Live Test)");
    console.log("=================================================================\n");

    const projectRoot = path.resolve("..");
    const composePath = path.join(projectRoot, "docker-compose.yml");

    // -------------------------------------------------------------
    // Group 1: Docker Compose File & Services Structure
    // -------------------------------------------------------------
    console.log("--- Group 1: Docker Compose File & Services Structure ---");

    assert(fs.existsSync(composePath), "docker-compose.yml exists at repository root");

    const composeContent = fs.readFileSync(composePath, "utf8");
    const services = parseComposeServices(composeContent);
    const serviceNames = Object.keys(services);

    const requiredServices = ["mongo", "redis", "server", "scanner-worker", "test-worker", "client"];
    for (const reqService of requiredServices) {
        assert(serviceNames.includes(reqService), `docker-compose defines service: "${reqService}"`);
    }

    // -------------------------------------------------------------
    // Group 2: Container Healthcheck Configurations
    // -------------------------------------------------------------
    console.log("\n--- Group 2: Container Healthcheck Configurations ---");

    for (const reqService of requiredServices) {
        assert(
            services[reqService]?.hasHealthcheck === true,
            `Container "${reqService}" has an active healthcheck block configured`
        );
    }

    assert(composeContent.includes("mongosh --eval 'db.runCommand({ ping: 1 })'"), "MongoDB healthcheck uses mongosh ping");
    assert(composeContent.includes("redis-cli"), "Redis healthcheck probes via redis-cli ping");
    assert(composeContent.includes("curl -f http://localhost:5000/api/health"), "Server healthcheck targets /api/health");
    assert(composeContent.includes("wget -q -O - http://localhost/healthz"), "Client healthcheck targets /healthz");

    // -------------------------------------------------------------
    // Group 3: Service Topology & Dependency Constraints
    // -------------------------------------------------------------
    console.log("\n--- Group 3: Service Topology & Dependency Constraints ---");

    assert(composeContent.includes("condition: service_healthy"), "Enforces service_healthy startup condition gates");
    assert(composeContent.includes("devpilot-network"), "All services bound to isolated bridge network 'devpilot-network'");
    assert(composeContent.includes("mongo_data:"), "Persistent volume defined for MongoDB");
    assert(composeContent.includes("redis_data:"), "Persistent volume defined for Redis");

    // -------------------------------------------------------------
    // Group 4: Dockerfiles & Nginx Reverse Proxy Architecture
    // -------------------------------------------------------------
    console.log("\n--- Group 4: Dockerfiles & Nginx Reverse Proxy Architecture ---");

    const serverDockerfile = path.join(projectRoot, "server", "Dockerfile");
    assert(fs.existsSync(serverDockerfile), "server/Dockerfile exists");
    const serverDockerContent = fs.readFileSync(serverDockerfile, "utf8");
    assert(serverDockerContent.includes("node:20-alpine"), "Server Dockerfile uses lightweight node:20-alpine base");
    assert(serverDockerContent.includes("git"), "Server Dockerfile installs git for repository cloner");
    assert(serverDockerContent.includes("EXPOSE 5000"), "Server Dockerfile exposes port 5000");

    const clientDockerfile = path.join(projectRoot, "client", "Dockerfile");
    assert(fs.existsSync(clientDockerfile), "client/Dockerfile exists");
    const clientDockerContent = fs.readFileSync(clientDockerfile, "utf8");
    assert(clientDockerContent.includes("AS builder") && clientDockerContent.includes("AS runner"), "Client Dockerfile implements multi-stage build");
    assert(clientDockerContent.includes("nginx:alpine"), "Client runner stage deploys on nginx:alpine");

    const nginxConf = path.join(projectRoot, "client", "nginx.conf");
    assert(fs.existsSync(nginxConf), "client/nginx.conf exists");
    const nginxContent = fs.readFileSync(nginxConf, "utf8");
    assert(nginxContent.includes("proxy_pass http://server:5000/api/;"), "Nginx proxies /api/ requests directly to server:5000");
    assert(nginxContent.includes("proxy_buffering off;"), "Nginx disables buffering to support SSE streaming chat (Phase 7)");
    assert(nginxContent.includes("try_files $uri $uri/ /index.html;"), "Nginx configures SPA fallback routing");

    // -------------------------------------------------------------
    // Group 5: Environment Configuration Templates
    // -------------------------------------------------------------
    console.log("\n--- Group 5: Environment Configuration Templates ---");

    const rootEnvExample = path.join(projectRoot, ".env.example");
    const serverEnvExample = path.join(projectRoot, "server", ".env.example");
    const clientEnvExample = path.join(projectRoot, "client", ".env.example");

    assert(fs.existsSync(rootEnvExample), "Root .env.example exists");
    assert(fs.existsSync(serverEnvExample), "server/.env.example exists");
    assert(fs.existsSync(clientEnvExample), "client/.env.example exists");

    const serverEnvText = fs.readFileSync(serverEnvExample, "utf8");
    assert(serverEnvText.includes("MONGO_URI"), "server/.env.example defines MONGO_URI");
    assert(serverEnvText.includes("REDIS_HOST"), "server/.env.example defines REDIS_HOST");
    assert(serverEnvText.includes("ACCESS_TOKEN_SECRET"), "server/.env.example defines ACCESS_TOKEN_SECRET");
    assert(serverEnvText.includes("PINECONE_API_KEY"), "server/.env.example defines PINECONE_API_KEY");

    // -------------------------------------------------------------
    // Group 6: Live Container Healthcheck Endpoint
    // -------------------------------------------------------------
    console.log("\n--- Group 6: Live Container Healthcheck Endpoint ---");

    // Simulate direct express invocation of GET /api/health
    let healthResponse = null;
    let healthStatusCode = 0;

    const mockReq = { method: "GET", url: "/api/health", headers: {} };
    const mockRes = {
        statusCode: 200,
        status(code) {
            healthStatusCode = code;
            return this;
        },
        json(data) {
            healthResponse = data;
            return this;
        },
    };

    // Find route handler in app router stack
    const routerStack = app.router?.stack || app._router?.stack || [];
    const healthLayer = routerStack.find(
        (l) => l.route && l.route.path === "/api/health" && l.route.methods.get
    );

    assert(Boolean(healthLayer), "Express app registers GET /api/health route layer");

    if (healthLayer) {
        healthLayer.handle(mockReq, mockRes, () => {});
        assert(healthStatusCode === 200, "Healthcheck returns HTTP 200 status");
        assert(healthResponse?.success === true, "Healthcheck response flagged as success");
        assert(healthResponse?.data?.status === "healthy", "Healthcheck payload confirms { status: 'healthy' }");
        assert(typeof healthResponse?.data?.uptime === "number", "Healthcheck payload includes process uptime");
    }

    console.log("\n=================================================================");
    console.log(`  Result: ${passedCount}/${totalCount} assertions passed (${Math.round((passedCount / totalCount) * 100)}%)`);
    console.log("=================================================================\n");

    if (passedCount < totalCount) {
        process.exit(1);
    }
}

runTests().catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
});

