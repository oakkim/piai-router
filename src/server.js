import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createGatewayLogger } from "./logger.js";
import { createPiRunner } from "./pi-runner.js";
import { createAuthMiddleware } from "./http/auth-middleware.js";
import { createCorsMiddleware } from "./http/cors-middleware.js";
import { createErrorMiddleware } from "./http/error-middleware.js";
import { composeMiddleware } from "./http/middleware-chain.js";
import { attachRequestContext } from "./http/request-context.js";
import { createRouter } from "./http/router.js";

export function createServer(config, options = {}) {
  const runner = createPiRunner(config);
  const logger = options.logger || createGatewayLogger(config);
  const routeRequest = createRouter({ config, runner, logger });

  const pipeline = composeMiddleware(
    [createErrorMiddleware(), createCorsMiddleware(), createAuthMiddleware()],
    async (context) => {
      await routeRequest(context);
    }
  );

  return http.createServer((req, res) => {
    const contextMeta = attachRequestContext(req, res);

    res.on("finish", () => {
      logger.server("http_access", {
        requestId: contextMeta.requestId,
        method: contextMeta.method,
        url: contextMeta.url,
        statusCode: res.statusCode,
        durationMs: Date.now() - contextMeta.startedAt
      });
    });

    pipeline({ req, res, config, runner, logger, ...contextMeta }).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.server("http_pipeline_error", {
        requestId: contextMeta.requestId,
        method: contextMeta.method,
        url: contextMeta.url,
        message
      });
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            type: "error",
            error: { type: "api_error", message }
          })
        );
      } else {
        res.end();
      }
      if (typeof logger.flush === "function") {
        await logger.flush();
      }
    });
  });
}

export function startServer(config = loadConfig()) {
  const logger = createGatewayLogger(config);
  const server = createServer(config, { logger });
  logger.server("server_start", {
    port: config.port,
    provider: config.provider || config.platform,
    upstreamProvider: config.upstream.provider,
    api: config.upstream.api
  });
  server.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[piai-gateway] listening on :${config.port} (provider=${config.provider || config.platform}, upstream=${config.upstream.provider}/${config.upstream.api})`
    );
  });
  server.on("close", () => {
    logger.server("server_stop", {
      port: config.port,
      droppedLogs: typeof logger.getDroppedCount === "function" ? logger.getDroppedCount() : 0
    });
    if (typeof logger.close === "function") {
      void logger.close();
    }
  });
  return server;
}

const runningAsMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (runningAsMain) {
  startServer(loadConfig());
}
