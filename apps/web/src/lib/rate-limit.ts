
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const url = import.meta.env.UPSTASH_REDIS_REST_URL;
const token = import.meta.env.UPSTASH_REDIS_REST_TOKEN;

export const contactRatelimit =
    url && token
        ? new Ratelimit({
            redis: new Redis({ url, token }),
            limiter: Ratelimit.slidingWindow(3, "15 m"),
            prefix: "portfolio:contact",
            analytics: false,
            timeout: 10000,
        })
        : null;
