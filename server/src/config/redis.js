import Redis from "ioredis";

const baseOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy(times) {
        if (times > 5) return null;
        const delay = Math.min(times * 200, 3000);
        return delay;
    },
};

const redisPassword =
    process.env.REDIS_PASSWORD && process.env.REDIS_PASSWORD.trim() !== ""
        ? process.env.REDIS_PASSWORD.trim()
        : undefined;

const redisConnection = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, {
          password: redisPassword,
          ...baseOptions,
      })
    : new Redis({
          host: process.env.REDIS_HOST || "127.0.0.1",
          port: Number(process.env.REDIS_PORT) || 6379,
          password: redisPassword,
          ...baseOptions,
      });

redisConnection.on("connect", () => {
    console.log("[Redis] Connected to server");
});

redisConnection.on("ready", () => {
    console.log("[Redis] Ready to accept commands");
});

redisConnection.on("error", (err) => {
    if (err.code !== "ECONNREFUSED") {
        console.error("[Redis] Connection error:", err.message);
    }
});


redisConnection.on("close", () => {
    console.warn("[Redis] Connection closed, reconnecting...");
});

export const closeRedisConnection = async () => {
    try {
        if (redisConnection && redisConnection.status !== "end") {
            await redisConnection.quit();
        }
    } catch {
        try {
            redisConnection.disconnect();
        } catch {}
    }
};

export { redisConnection };
export default redisConnection;
