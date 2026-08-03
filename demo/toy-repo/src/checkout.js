export function createCheckoutHandler({ limiter }) {
  return function checkout(request) {
    const userId = request.userId;

    if (!limiter.allow(userId)) {
      return {
        status: 429,
        body: {
          error: "Too many checkout attempts. Please retry shortly."
        }
      };
    }

    return {
      status: 200,
      body: {
        ok: true,
        charged: request.cartTotal
      }
    };
  };
}
