import test from "node:test";
import assert from "node:assert/strict";
import { composeMiddleware } from "../../src/http/middleware-chain.js";

test("composeMiddleware runs middleware in order", async () => {
  const events = [];
  const run = composeMiddleware(
    [
      async (_ctx, next) => {
        events.push("a:start");
        await next();
        events.push("a:end");
      },
      async (_ctx, next) => {
        events.push("b:start");
        await next();
        events.push("b:end");
      }
    ],
    async () => {
      events.push("terminal");
    }
  );

  await run({});

  assert.deepEqual(events, ["a:start", "b:start", "terminal", "b:end", "a:end"]);
});

test("composeMiddleware rejects duplicate next calls", async () => {
  const run = composeMiddleware([
    async (_ctx, next) => {
      await next();
      await next();
    }
  ]);

  await assert.rejects(() => run({}), /next\(\) called multiple times/);
});
