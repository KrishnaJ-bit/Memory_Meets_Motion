# relay-checkout-demo

Small deterministic repo used by the Relay demo.

## Demo Task

Add token-bucket rate limiting to `/api/checkout`.

The interrupted state intentionally contains a boundary bug: after two immediate checkout attempts,
the third request is rejected, and a retry at exactly 1000 ms should be accepted after one token
refills. The current limiter fails that exact-boundary test.

## Commands

```sh
npm test
```
