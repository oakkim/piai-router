import test from "node:test";
import assert from "node:assert/strict";
import { readJsonBody } from "../../src/http/body-parser.js";

function createReq(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    }
  };
}

test("readJsonBody parses valid JSON", async () => {
  const req = createReq([Buffer.from('{"a":1}')]);
  const body = await readJsonBody(req, 1024);
  assert.deepEqual(body, { a: 1 });
});

test("readJsonBody returns empty object for empty body", async () => {
  const req = createReq([]);
  const body = await readJsonBody(req, 1024);
  assert.deepEqual(body, {});
});

test("readJsonBody throws 400 on invalid JSON", async () => {
  const req = createReq([Buffer.from("{bad json")]);
  await assert.rejects(() => readJsonBody(req, 1024), (error) => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.type, "invalid_request_error");
    return true;
  });
});

test("readJsonBody throws 413 on payload too large", async () => {
  const req = createReq([Buffer.from("12345")]);
  await assert.rejects(() => readJsonBody(req, 4), (error) => {
    assert.equal(error.statusCode, 413);
    assert.equal(error.type, "invalid_request_error");
    return true;
  });
});
