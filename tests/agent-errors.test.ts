import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { runAgent } from "../src/agent.js";
import { closePool } from "../src/db.js";
import { withSession } from "../src/storage.js";
import { makeTestSession, resetDb } from "./helpers/db.js";

let sid: string;

beforeEach(async () => {
  await resetDb();
  sid = await makeTestSession();
});

afterAll(async () => {
  await closePool();
});

// Retryable errors carry retry-after-ms: 0 so streamText's retries don't wait out its backoff.
function createRejectingModel(statusCode: number, message: string, isRetryable = false): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => {
      throw new APICallError({
        message,
        url: "https://api.example.com/v1/messages",
        requestBodyValues: {},
        statusCode,
        isRetryable,
        responseHeaders: isRetryable ? { "retry-after-ms": "0" } : undefined,
      });
    },
  });
}

describe("runAgent provider errors", () => {
  it("names the provider's message and status and points to the API key on 401", async () => {
    const model = createRejectingModel(401, "x-api-key header is required");

    const run = withSession(sid, () => runAgent([{ role: "user", content: "hi" }], { model }));

    await expect(run).rejects.toThrow(
      "The model provider rejected the request (HTTP 401): x-api-key header is required. "
        + "Check the API key in LLM settings or the server's .env."
    );
  });

  it("gives no key hint for other provider errors", async () => {
    const model = createRejectingModel(400, "Bad request.");

    const run = withSession(sid, () => runAgent([{ role: "user", content: "hi" }], { model }));

    await expect(run).rejects.toThrow("The model provider rejected the request (HTTP 400): Bad request.");
  });

  it("names the status of a retryable error after streamText gives up retrying", async () => {
    const model = createRejectingModel(529, "Overloaded.", true);

    const run = withSession(sid, () => runAgent([{ role: "user", content: "hi" }], { model }));

    await expect(run).rejects.toThrow("The model provider rejected the request (HTTP 529): Overloaded.");
    expect(model.doStreamCalls).toHaveLength(3);
  });
});
