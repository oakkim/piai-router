import Fastify from "fastify";
import { createAuthMiddleware } from "./auth-middleware.js";
import { createCorsMiddleware } from "./cors-middleware.js";
import { createErrorMiddleware } from "./error-middleware.js";
import { toGatewayContext } from "./fastify-context.js";
import { composeMiddleware } from "./middleware-chain.js";
import { createRequestId } from "./request-id.js";
import { createRouter } from "./router.js";

export function createFastifyApp({ config, runner, logger }) {
  const app = Fastify({
    logger: false,
    bodyLimit: config?.http?.maxBodyBytes
  });

  const routeRequest = createRouter({ config, runner, logger });
  const pipeline = composeMiddleware(
    [createErrorMiddleware(), createCorsMiddleware(), createAuthMiddleware()],
    async (context) => {
      await routeRequest(context);
    }
  );

  app.addHook("onRequest", async (request, reply) => {
    const requestId = createRequestId("http");
    request.piaiRequestId = requestId;
    request.piaiStartedAt = Date.now();
    reply.header("x-request-id", requestId);
    reply.raw.setHeader("x-request-id", requestId);
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

  app.all("*", async (request, reply) => {
    const context = toGatewayContext({ request, reply, config, runner, logger });
    reply.hijack();
    await pipeline(context);
  });

  return app;
}
