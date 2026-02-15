import Fastify from "fastify";
import { createRequestId } from "./request-id.js";

export function createFastifyApp({ config, logger }) {
  const app = Fastify({
    logger: false
  });

  app.addHook("onRequest", async (request, reply) => {
    const requestId = createRequestId("http");
    request.piaiRequestId = requestId;
    request.piaiStartedAt = Date.now();
    reply.header("x-request-id", requestId);
  });

  app.addHook("onResponse", async (request, reply) => {
    logger?.server("http_access", {
      requestId: request.piaiRequestId,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      durationMs: Date.now() - (request.piaiStartedAt || Date.now())
    });
  });

  app.get("/health", async (_request, reply) => {
    reply.code(200).type("application/json; charset=utf-8").send({ ok: true });
  });

  return app;
}
