/**
 * DevPilot Sandboxed Execution & Container Manager (Sub-Phase 8A)
 * 
 * Provides isolated code execution for test suites and scripts.
 * Primary: Docker container with resource constraints, non-root user, read-only volume mounts, and network policies.
 * Fallback: Process-isolated local execution with timeouts, environment sandboxing, and output capping.
 */

import { spawn, exec } from "child_process";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import os from "os";

/**
 * Fixed allow-list of permitted test execution commands.
 * Blocks arbitrary free-text command injection from untrusted client requests.
 */
export const ALLOWED_TEST_COMMANDS = Object.freeze([
    "npm test",
    "npm run test",
    "npm test --if-present",
    "npx jest",
    "npx vitest run",
    "npx mocha",
    "pytest",
    "python -m pytest",
    "python3 -m pytest",
    "go test ./...",
    "cargo test",
]);

// Cache for Docker daemon availability check
let dockerStatusCache = {
    available: null,
    version: null,
    checkedAt: 0,
};

const DOCKER_CHECK_TTL_MS = 30000; // 30 seconds cache TTL
const MAX_LOG_BUFFER_BYTES = 5 * 1024 * 1024; // 5 MB safety limit on captured logs

/**
 * Checks whether Docker CLI and the Docker engine daemon are available and responding.
 *
 * @param {object} [options]
 * @param {boolean} [options.forceRefresh=false] - Bypass cache and probe immediately
 * @returns {Promise<{ available: boolean, version: string|null, reason?: string }>}
 */
export const isDockerAvailable = async ({ forceRefresh = false } = {}) => {
    const now = Date.now();
    if (!forceRefresh && dockerStatusCache.checkedAt && now - dockerStatusCache.checkedAt < DOCKER_CHECK_TTL_MS) {
        return {
            available: dockerStatusCache.available,
            version: dockerStatusCache.version,
        };
    }

    return new Promise((resolve) => {
        exec("docker info --format \"{{.ServerVersion}}\"", { timeout: 3500 }, (error, stdout, stderr) => {
            if (error || (stderr && !stdout)) {
                dockerStatusCache = {
                    available: false,
                    version: null,
                    checkedAt: now,
                };
                return resolve({
                    available: false,
                    version: null,
                    reason: (error?.message || stderr || "Docker daemon not reachable").trim(),
                });
            }

            const version = stdout.trim() || "unknown";
            dockerStatusCache = {
                available: true,
                version,
                checkedAt: now,
            };
            return resolve({
                available: true,
                version,
            });
        });
    });
};

/**
 * Inspects a project directory to detect the runtime language and primary test runner.
 *
 * @param {string} workingDir - Path to cloned project directory
 * @returns {object} { runtime: "node"|"python"|"unknown", testCommand: string, runner: string }
 */
export const detectProjectEnvironment = (workingDir) => {
    try {
        const pkgPath = path.join(workingDir, "package.json");
        if (fs.existsSync(pkgPath)) {
            const raw = fs.readFileSync(pkgPath, "utf8");
            const pkg = JSON.parse(raw);

            const scripts = pkg.scripts || {};
            const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

            let runner = "npm-test";
            if (deps.vitest) runner = "vitest";
            else if (deps.jest) runner = "jest";
            else if (deps.mocha) runner = "mocha";
            else if (deps.ava) runner = "ava";

            const testCommand = scripts.test ? "npm test" : "npm test --if-present";
            return {
                runtime: "node",
                runner,
                testCommand,
                image: "node:20-alpine",
                hasPackageJson: true,
            };
        }

        const pyMarkers = ["pytest.ini", "requirements.txt", "pyproject.toml", "setup.py"];
        const hasPyMarker = pyMarkers.some((f) => fs.existsSync(path.join(workingDir, f)));
        if (hasPyMarker) {
            return {
                runtime: "python",
                runner: "pytest",
                testCommand: "pytest",
                image: "python:3.11-alpine",
                hasPackageJson: false,
            };
        }
    } catch (err) {
        console.warn(`[SandboxService] Error detecting project environment: ${err.message}`);
    }

    return {
        runtime: "node",
        runner: "generic",
        testCommand: "npm test",
        image: "node:20-alpine",
        hasPackageJson: false,
    };
};

/**
 * Normalizes host directory path for Docker volume mounting across OS platforms.
 * On Windows, handles backslashes and drive letter casing.
 *
 * @param {string} hostPath
 * @returns {string} Clean volume mount source path
 */
export const normalizeVolumePath = (hostPath) => {
    const resolved = path.resolve(hostPath);
    return resolved.replace(/\\/g, "/");
};

/**
 * Safely kills a child process and its process tree across Windows and POSIX.
 *
 * @param {import("child_process").ChildProcess} proc
 */
export const killProcessTree = (proc) => {
    if (!proc || !proc.pid) return;

    if (process.platform === "win32") {
        try {
            exec(`taskkill /pid ${proc.pid} /T /F`, () => {});
        } catch {
            try {
                proc.kill("SIGKILL");
            } catch {}
        }
    } else {
        try {
            process.kill(-proc.pid, "SIGKILL");
        } catch {
            try {
                proc.kill("SIGKILL");
            } catch {}
        }
    }
};

/**
 * Builds the complete Docker run command argument array with strict security boundaries.
 * 
 * Boundaries configured:
 * - Read-only volume mount option (:ro) with tmpfs for transient runner caches
 * - Hard memory limits (e.g. 512m / 1024m) & swap limits to prevent memory exhaustion
 * - CPU execution quota limits (e.g. 1.0)
 * - Process limit cap (pids-limit) to block fork bombs
 * - Non-root user execution (--user 1000:1000)
 * - Security hardening: --security-opt no-new-privileges:true, --cap-drop=ALL
 * - Network isolation mode
 *
 * @param {object} params
 * @returns {string[]} Formatted arguments for `docker` CLI
 */
export const buildDockerRunArgs = ({
    containerId,
    workingDir,
    image = "node:20-alpine",
    command,
    memoryLimit = "1024m",
    cpuLimit = "1.0",
    pidsLimit = 100,
    network = "none",
    readOnly = true,
    user = "1000:1000",
    env = {},
}) => {
    const hostVolumePath = normalizeVolumePath(workingDir);
    const volumeMount = readOnly ? `${hostVolumePath}:/workspace:ro` : `${hostVolumePath}:/workspace`;

    const dockerArgs = [
        "run",
        "--name", containerId,
        "--rm",
        "-v", volumeMount,
        "-w", "/workspace",
        `--memory=${memoryLimit}`,
        `--memory-swap=${memoryLimit}`,
        `--cpus=${cpuLimit}`,
        `--pids-limit=${pidsLimit}`,
        `--network=${network}`,
        "--security-opt", "no-new-privileges:true",
        "--cap-drop=ALL",
    ];

    // If running as non-root user (e.g. 1000:1000)
    if (user) {
        dockerArgs.push("--user", user);
    }

    // Workspace mount is read-only except a dedicated /workspace/tmp
    if (readOnly) {
        dockerArgs.push(
            "--tmpfs", "/workspace/tmp:rw,noexec,nosuid,size=64m",
            "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m"
        );
    }

    // Inject custom environment variables
    const defaultEnv = {
        CI: "true",
        DEVPILOT_SANDBOX: "docker",
        ...env,
    };

    for (const [key, val] of Object.entries(defaultEnv)) {
        dockerArgs.push("-e", `${key}=${val}`);
    }

    dockerArgs.push(image);

    // Normalize command into arguments
    if (Array.isArray(command)) {
        dockerArgs.push(...command);
    } else if (typeof command === "string") {
        dockerArgs.push("sh", "-c", command);
    }

    return dockerArgs;
};

/**
 * Executes a command in an isolated Docker sandbox container.
 *
 * @param {object} params
 * @param {string} params.workingDir - Absolute path to project folder on host
 * @param {string|string[]} params.command - Command to execute (e.g. "npm test" or ["npm", "test"])
 * @param {number} [params.timeoutMs=60000] - Hard kill timeout in milliseconds (e.g. 60s or 120s)
 * @param {string} [params.image="node:20-alpine"] - Container image
 * @param {string} [params.memoryLimit="1024m"] - Memory constraint (e.g. "512m", "1024m")
 * @param {string} [params.cpuLimit="1.0"] - CPU constraint
 * @param {number} [params.pidsLimit=100] - Max process IDs inside container
 * @param {string} [params.network="bridge"] - Network mode ("bridge", "none")
 * @param {boolean} [params.readOnly=false] - Mount workspace as read-only (:ro)
 * @param {string} [params.user="1000:1000"] - Non-root user ID:GID
 * @param {Record<string, string>} [params.env={}] - Custom environment variables
 * @param {Function} [params.onLog] - Callback for streaming chunks (data: string, type: "stdout"|"stderr")
 * @returns {Promise<object>} Execution result
 */
const runInDocker = ({
    workingDir,
    command,
    timeoutMs = 60000,
    image = "node:20-alpine",
    memoryLimit = "1024m",
    cpuLimit = "1.0",
    pidsLimit = 100,
    network = "none",
    readOnly = true,
    user = "1000:1000",
    env = {},
    onLog = null,
}) => {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const containerId = `devpilot-sandbox-${crypto.randomBytes(4).toString("hex")}`;

        const dockerArgs = buildDockerRunArgs({
            containerId,
            workingDir,
            image,
            command,
            memoryLimit,
            cpuLimit,
            pidsLimit,
            network,
            readOnly,
            user,
            env,
        });

        let stdoutBuf = "";
        let stderrBuf = "";
        let combinedBuf = "";
        let timedOut = false;
        let isSettled = false;

        const child = spawn("docker", dockerArgs, {
            windowsHide: true,
        });

        // Timeout watchdog (terminates rogue containers after timeoutMs: 60s / 120s)
        const timer = setTimeout(() => {
            timedOut = true;
            const timeoutNotice = `\n[DevPilot Sandbox Watchdog] Execution exceeded timeout of ${timeoutMs}ms (${Math.round(timeoutMs / 1000)}s). Terminating rogue container "${containerId}"...\n`;
            combinedBuf += timeoutNotice;
            stderrBuf += timeoutNotice;
            if (onLog) onLog(timeoutNotice, "stderr");

            // Kill and forcefully remove container
            exec(`docker kill ${containerId}`, () => {
                exec(`docker rm -f ${containerId}`, () => {});
            });
            killProcessTree(child);
        }, timeoutMs);

        const appendSafe = (chunk, isStderr = false) => {
            const str = chunk.toString();
            if (combinedBuf.length < MAX_LOG_BUFFER_BYTES) {
                combinedBuf += str;
                if (isStderr) stderrBuf += str;
                else stdoutBuf += str;
            }
            if (onLog) {
                try {
                    onLog(str, isStderr ? "stderr" : "stdout");
                } catch {}
            }
        };

        child.stdout.on("data", (chunk) => appendSafe(chunk, false));
        child.stderr.on("data", (chunk) => appendSafe(chunk, true));

        child.on("error", (err) => {
            clearTimeout(timer);
            if (isSettled) return;
            isSettled = true;

            resolve({
                success: false,
                exitCode: -1,
                stdout: stdoutBuf,
                stderr: stderrBuf + `\nProcess error: ${err.message}`,
                output: combinedBuf + `\nProcess error: ${err.message}`,
                durationMs: Date.now() - startTime,
                timedOut,
                environment: "docker",
                containerId,
                error: err.message,
            });
        });

        child.on("close", (code) => {
            clearTimeout(timer);
            if (isSettled) return;
            isSettled = true;

            const exitCode = timedOut ? 124 : (code ?? -1);
            resolve({
                success: exitCode === 0,
                exitCode,
                stdout: stdoutBuf,
                stderr: stderrBuf,
                output: combinedBuf,
                durationMs: Date.now() - startTime,
                timedOut,
                environment: "docker",
                containerId,
            });
        });
    });
};

/**
 * Executes a command in a process-isolated local sandbox (used when Docker daemon is not running).
 *
 * @param {object} params
 * @param {string} params.workingDir - Directory to run in
 * @param {string|string[]} params.command - Command to run
 * @param {number} [params.timeoutMs=60000] - Hard kill timeout
 * @param {Record<string, string>} [params.env={}] - Additional environment variables
 * @param {Function} [params.onLog] - Streaming log callback
 * @returns {Promise<object>} Execution result
 */
const runInLocalSandbox = ({
    workingDir,
    command,
    timeoutMs = 60000,
    env = {},
    onLog = null,
}) => {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const fullCmd = Array.isArray(command) ? command.join(" ") : command;

        let stdoutBuf = "";
        let stderrBuf = "";
        let combinedBuf = "";
        let timedOut = false;
        let isSettled = false;

        // Dedicated temporary directory for HOME
        let tempHomeDir = "";
        try {
            tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), "devpilot-sandbox-home-"));
        } catch {
            tempHomeDir = os.tmpdir();
        }

        // Strictly sanitized environment: NEVER spread process.env
        // Pass only PATH, HOME (temp dir), and CI
        const sanitizedEnv = {
            PATH: process.env.PATH || "",
            HOME: tempHomeDir,
            USERPROFILE: tempHomeDir,
            TMPDIR: tempHomeDir,
            TEMP: tempHomeDir,
            TMP: tempHomeDir,
            CI: "true",
            DEVPILOT_SANDBOX: "local-process",
            ...(env || {}),
        };

        const cleanupTempHome = () => {
            if (tempHomeDir && tempHomeDir.includes("devpilot-sandbox-home-") && fs.existsSync(tempHomeDir)) {
                try {
                    fs.rmSync(tempHomeDir, { recursive: true, force: true });
                } catch {}
            }
        };

        const child = spawn(fullCmd, [], {
            cwd: path.resolve(workingDir),
            shell: true,
            env: sanitizedEnv,
            windowsHide: true,
        });

        const timer = setTimeout(() => {
            timedOut = true;
            const timeoutNotice = `\n[DevPilot Sandbox Watchdog] Execution timed out after ${timeoutMs}ms (${Math.round(timeoutMs / 1000)}s). Killing process tree...\n`;
            combinedBuf += timeoutNotice;
            stderrBuf += timeoutNotice;
            if (onLog) onLog(timeoutNotice, "stderr");

            killProcessTree(child);
        }, timeoutMs);

        const appendSafe = (chunk, isStderr = false) => {
            const str = chunk.toString();
            if (combinedBuf.length < MAX_LOG_BUFFER_BYTES) {
                combinedBuf += str;
                if (isStderr) stderrBuf += str;
                else stdoutBuf += str;
            }
            if (onLog) {
                try {
                    onLog(str, isStderr ? "stderr" : "stdout");
                } catch {}
            }
        };

        child.stdout.on("data", (chunk) => appendSafe(chunk, false));
        child.stderr.on("data", (chunk) => appendSafe(chunk, true));

        child.on("error", (err) => {
            clearTimeout(timer);
            cleanupTempHome();
            if (isSettled) return;
            isSettled = true;

            resolve({
                success: false,
                exitCode: -1,
                stdout: stdoutBuf,
                stderr: stderrBuf + `\nProcess error: ${err.message}`,
                output: combinedBuf + `\nProcess error: ${err.message}`,
                durationMs: Date.now() - startTime,
                timedOut,
                environment: "local-process",
                error: err.message,
            });
        });

        child.on("close", (code) => {
            clearTimeout(timer);
            cleanupTempHome();
            if (isSettled) return;
            isSettled = true;

            const exitCode = timedOut ? 124 : (code ?? -1);
            resolve({
                success: exitCode === 0,
                exitCode,
                stdout: stdoutBuf,
                stderr: stderrBuf,
                output: combinedBuf,
                durationMs: Date.now() - startTime,
                timedOut,
                environment: "local-process",
            });
        });
    });
};

/**
 * Executes dependency installation in an isolated container using an explicit network configuration ("bridge").
 * Only invoked when dependencies must be resolved prior to running sandboxed tests with network: "none".
 *
 * @param {object} params
 * @param {string} params.workingDir - Path to project workspace
 * @param {string} [params.command] - Install command (e.g. "npm ci" or "pip install -r requirements.txt")
 * @param {string} [params.network="bridge"] - Explicit network mode permitted for install step
 * @param {number} [params.timeoutMs=120000] - Hard kill timeout for install
 * @param {string} [params.image] - Container image
 * @param {Function} [params.onLog] - Log chunk callback
 * @returns {Promise<object>} Execution result
 */
export const installDependenciesInSandbox = async ({
    workingDir,
    command = null,
    network = "bridge",
    timeoutMs = 120000,
    image = null,
    onLog = null,
}) => {
    if (!workingDir || !fs.existsSync(workingDir)) {
        throw new Error(`[SandboxService] Invalid workingDir for dependency install: "${workingDir}"`);
    }

    const envInfo = detectProjectEnvironment(workingDir);
    let installCmd = command;
    if (!installCmd) {
        if (envInfo.runtime === "node") {
            const hasLock = fs.existsSync(path.join(workingDir, "package-lock.json"));
            installCmd = hasLock ? "npm ci --prefer-offline" : "npm install --prefer-offline";
        } else if (envInfo.runtime === "python") {
            installCmd = "pip install -r requirements.txt";
        } else {
            installCmd = "npm install";
        }
    }

    return executeInSandbox({
        workingDir,
        command: installCmd,
        timeoutMs,
        image: image || envInfo.image,
        network, // Explicitly permitted for dependency installation only
        readOnly: false, // Write access needed to write node_modules / site-packages
        onLog,
    });
};

/**
 * Unified Sandbox Execution Interface
 * Automatically selects Docker container execution when Docker daemon is available.
 * If Docker is unavailable, throws a clear error ("sandbox unavailable").
 * Only allows local mode when process.env.ALLOW_UNSAFE_LOCAL_SANDBOX === "true" and NODE_ENV !== "production".
 *
 * @param {object} params
 * @param {string} params.workingDir - Workspace directory path
 * @param {string|string[]} [params.command] - Command to execute (defaults to auto-detected testCommand)
 * @param {number} [params.timeoutMs=60000] - Timeout in milliseconds (default: 60s, supports 120s)
 * @param {boolean} [params.preferDocker=true] - Attempt Docker container first if daemon is running
 * @param {string} [params.image] - Override Docker container image
 * @param {string} [params.memoryLimit="1024m"] - Memory cap (e.g. "512m", "1024m")
 * @param {string} [params.cpuLimit="1.0"] - CPU cap (e.g. "0.5", "1.0")
 * @param {number} [params.pidsLimit=100] - Process ID limit
 * @param {string} [params.network="none"] - Docker network isolation (default: "none")
 * @param {boolean} [params.readOnly=true] - Read-only volume mount (:ro with /workspace/tmp)
 * @param {string} [params.user="1000:1000"] - Non-root user
 * @param {Record<string, string>} [params.env={}] - Environment variables
 * @param {boolean} [params.installDependencies=false] - Run explicit network-enabled install step first
 * @param {string} [params.installNetwork="bridge"] - Network for install step
 * @param {Function} [params.onLog] - Live chunk callback
 * @returns {Promise<object>} Standardized execution report
 */
export const executeInSandbox = async ({
    workingDir,
    command = null,
    timeoutMs = 60000,
    preferDocker = true,
    image = null,
    memoryLimit = "1024m",
    cpuLimit = "1.0",
    pidsLimit = 100,
    network = "none",
    readOnly = true,
    user = "1000:1000",
    env = {},
    installDependencies = false,
    installNetwork = "bridge",
    onLog = null,
}) => {
    if (!workingDir || !fs.existsSync(workingDir)) {
        throw new Error(`[SandboxService] Invalid workingDir: directory does not exist at "${workingDir}"`);
    }

    const envInfo = detectProjectEnvironment(workingDir);
    const finalCommand = command || envInfo.testCommand;
    const finalImage = image || envInfo.image;

    // Check Docker daemon availability
    const dockerStatus = await isDockerAvailable();
    const useDocker = preferDocker && dockerStatus.available;

    // Optional explicit dependency installation step (isolated before test lockdown)
    if (installDependencies && useDocker) {
        await installDependenciesInSandbox({
            workingDir,
            network: installNetwork,
            image: finalImage,
            onLog,
        });
    }

    if (useDocker) {
        return runInDocker({
            workingDir,
            command: finalCommand,
            timeoutMs,
            image: finalImage,
            memoryLimit,
            cpuLimit,
            pidsLimit,
            network,
            readOnly,
            user,
            env,
            onLog,
        });
    }

    // Docker is unavailable:
    // Only allow local mode when process.env.ALLOW_UNSAFE_LOCAL_SANDBOX === "true" and NODE_ENV !== "production".
    const allowUnsafeLocal = process.env.ALLOW_UNSAFE_LOCAL_SANDBOX === "true" && process.env.NODE_ENV !== "production";
    if (!allowUnsafeLocal) {
        throw new Error("sandbox unavailable: Docker daemon is not running or accessible");
    }

    return runInLocalSandbox({
        workingDir,
        command: finalCommand,
        timeoutMs,
        env,
        onLog,
    });
};

export default {
    ALLOWED_TEST_COMMANDS,
    isDockerAvailable,
    detectProjectEnvironment,
    normalizeVolumePath,
    buildDockerRunArgs,
    killProcessTree,
    installDependenciesInSandbox,
    executeInSandbox,
};
