export function createTokenBucketLimiter({ capacity, refillPerSecond, now }) {
  const buckets = new Map();

  function getBucket(key) {
    if (!buckets.has(key)) {
      buckets.set(key, {
        tokens: capacity,
        updatedAt: now()
      });
    }

    return buckets.get(key);
  }

  return {
    allow(key) {
      const bucket = getBucket(key);
      const elapsedMs = now() - bucket.updatedAt;

      if (elapsedMs > 1000) {
        const refill = Math.floor(elapsedMs / 1000) * refillPerSecond;
        bucket.tokens = Math.min(capacity, bucket.tokens + refill);
        bucket.updatedAt += Math.floor(elapsedMs / 1000) * 1000;
      }

      if (bucket.tokens <= 0) {
        return false;
      }

      bucket.tokens -= 1;
      return true;
    }
  };
}
