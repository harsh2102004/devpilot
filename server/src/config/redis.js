import Redis from "ioredis";

// ─────────────────────────────────────────────────────────────────────
// WHY ioredis?
//   - Official BullMQ-recommended Redis client for Node.js
//   - Supports auto-reconnect, cluster mode, and pub/sub out of the box
//   - `maxRetriesPerRequest: null` is REQUIRED by BullMQ so it can use
//     Redis blocking commands (BRPOP, BLPOP) without timing out
// ─────────────────────────────────────────────────────────────────────

const baseOptions = {
    // BullMQ REQUIRES these two settings. Without them it will throw errors.
    maxRetriesPerRequest: null,
    enableReadyCheck: false,

    // Auto-retry with exponential backoff if Redis drops the connection.
    // times = how many times we've retried. Caps at 3 seconds to avoid spam.
    retryStrategy(times) {
        const delay = Math.min(times * 200, 3000);
        console.log(`[Redis] Retrying connection... attempt ${times} (delay: ${delay}ms)`);
        return delay;
    },
};

// ─────────────────────────────────────────────────────────────────────
// CONNECTION STRATEGY
//   Local dev:  Set REDIS_HOST, REDIS_PORT, REDIS_PASSWORD in .env
//   Cloud:      Set REDIS_URL (e.g. Upstash / Redis Cloud / Aiven)
//               Format: redis://:password@host:port
// ─────────────────────────────────────────────────────────────────────
const redisConnection = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, baseOptions)
    : new Redis({
          host: process.env.REDIS_HOST || "127.0.0.1",
          port: Number(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          ...baseOptions,
      });

// ─── Lifecycle Event Listeners ───────────────────────────────────────

// Fires when TCP connection to Redis is established
redisConnection.on("connect", () => {
    console.log("✅ [Redis] Connected to Redis server");
});

// Fires when Redis is ready to accept commands (after AUTH if needed)
redisConnection.on("ready", () => {
    console.log("✅ [Redis] Ready to accept commands");
});

// Fires on any connection error (wrong password, network issue, etc.)
redisConnection.on("error", (err) => {
    console.error("❌ [Redis] Connection error:", err.message);
    // NOTE: We do NOT crash the server here intentionally.
    // ioredis handles reconnection automatically via retryStrategy above.
});

// Fires when the connection closes (Redis restarted, network dropped)
redisConnection.on("close", () => {
    console.warn("⚠️  [Redis] Connection closed — attempting to reconnect...");
});

// ─────────────────────────────────────────────────────────────────────
// Export a single shared connection instance.
// BullMQ Queues, Workers, and QueueEvents all share this same connection
// so we don't waste Redis connection slots.
// ─────────────────────────────────────────────────────────────────────
export { redisConnection };
export default redisConnection;
