import { expect, test } from "bun:test";
import { observeProviderResponse } from "./provider-limits";

test("absent quota headers are unknown rather than zero or unlimited", () => {
  expect(observeProviderResponse(200, new Headers())).toMatchObject({ status: "available", requestsLimit: null, requestsRemaining: null, retryAt: null });
  expect(observeProviderResponse(403, new Headers(), { error: { message: "quota access denied" } }).status).toBe("error");
});
test("Gemini array RetryInfo and OpenRouter quota headers are parsed", () => {
  const before = Date.now();
  const google = observeProviderResponse(429, new Headers(), [{ error: { details: [{ retryDelay: "12s" }] } }]);
  expect(Date.parse(google.retryAt!) - before).toBeGreaterThanOrEqual(12000);
  const router = observeProviderResponse(429, new Headers(), { error: { metadata: { headers: { "X-RateLimit-Limit": "20", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1900000000000" } } } });
  expect(router).toMatchObject({ status: "limited", requestsLimit: 20, requestsRemaining: 0, retryAt: new Date(1900000000000).toISOString() });
});
