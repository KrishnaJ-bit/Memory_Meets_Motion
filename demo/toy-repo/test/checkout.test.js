import assert from "node:assert/strict";
import test from "node:test";
import { createCheckoutHandler } from "../src/checkout.js";
import { createTokenBucketLimiter } from "../src/rateLimit.js";

test("checkout accepts requests while the token bucket has capacity", () => {
  let currentTime = 0;
  const limiter = createTokenBucketLimiter({
    capacity: 2,
    refillPerSecond: 1,
    now: () => currentTime
  });
  const checkout = createCheckoutHandler({ limiter });

  assert.equal(checkout({ userId: "ada", cartTotal: 42 }).status, 200);
  assert.equal(checkout({ userId: "ada", cartTotal: 42 }).status, 200);
});

test("checkout rejects requests after the bucket is empty", () => {
  let currentTime = 0;
  const limiter = createTokenBucketLimiter({
    capacity: 2,
    refillPerSecond: 1,
    now: () => currentTime
  });
  const checkout = createCheckoutHandler({ limiter });

  checkout({ userId: "ada", cartTotal: 42 });
  checkout({ userId: "ada", cartTotal: 42 });

  assert.equal(checkout({ userId: "ada", cartTotal: 42 }).status, 429);
});

test("checkout allows one request at the exact one-second refill boundary", () => {
  let currentTime = 0;
  const limiter = createTokenBucketLimiter({
    capacity: 2,
    refillPerSecond: 1,
    now: () => currentTime
  });
  const checkout = createCheckoutHandler({ limiter });

  checkout({ userId: "ada", cartTotal: 42 });
  checkout({ userId: "ada", cartTotal: 42 });
  currentTime = 1000;

  assert.equal(checkout({ userId: "ada", cartTotal: 42 }).status, 200);
});
