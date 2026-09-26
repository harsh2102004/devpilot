import Redis from "ioredis";

const baseOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
        const delay = Math.min(times * 200, 3000);
        return delay;
    },
};

const redisConnection = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, baseOptions)
    : new Redis({
          host: process.env.REDIS_HOST || "127.0.0.1",
          port: Number(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          ...baseOptions,
      });

redisConnection.on("connect", () => {
    console.log("[Redis] Connected to server");
});

redisConnection.on("ready", () => {
    console.log("[Redis] Ready to accept commands");
});

redisConnection.on("error", (err) => {
    console.error("[Redis] Connection error:", err.message);
});

redisConnection.on("close", () => {
    console.warn("[Redis] Connection closed, reconnecting...");
});

export { redisConnection };
export default redisConnection;
