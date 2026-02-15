import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createGatewayHandler } from "./http-handler.js";
import { createGatewayLogger } from "./logger.js";
import { createPiRunner } from "./pi-runner.js";

function createRequestId(prefix = "req") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createServer(config, options = {}) {
  const runner = createPiRunner(config);
  const logger = options.logger || createGatewayLogger(config);
  const handler = createGatewayHandler({ config, runner, logger });

  return http.createServer((req, res) => {
    const startedAt = Date.now();
    const requestId = createRequestId("http");
    req.piaiRequestId = requestId;
    res.setHeader("x-request-id", requestId);

    res.on("finish", () => {
      logger.server("http_access", {
        requestId,
        method: req.method || "",
        url: req.url || "",
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt
      });
    });

    handler(req, res).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.server("http_handler_error", {
        requestId,
        method: req.method || "",
        url: req.url || "",
        message
      });
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          type: "error",
          error: { type: "api_error", message }
        })
      );
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
      port: config.port
    });
  });
  return server;
}

const runningAsMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (runningAsMain) {
  startServer(loadConfig());
}
