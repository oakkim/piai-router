import { createCountTokensHandler } from "./http/handlers/count-tokens-handler.js";
import { createMessagesHandler } from "./http/handlers/messages-handler.js";
import { createModelsHandler } from "./http/handlers/models-handler.js";
import { GatewayHttpError } from "./http/http-errors.js";

function normalizePathname(url) {
  const raw = typeof url === "string" ? url : "";
  const pathOnly = raw.split("?", 1)[0] || "/";
  if (pathOnly.length > 1) {
    return pathOnly.replace(/\/+$/, "");
  }
  return pathOnly;
}

export function createGatewayHandler(params) {
  const handleModels = createModelsHandler(params);
  const handleCountTokens = createCountTokensHandler(params);
  const handleMessages = createMessagesHandler(params);

  return async function gatewayHandler(req, res) {
    const pathname = normalizePathname(req.url);

    if (req.method === "GET" && pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "GET" && pathname === "/v1/models") {
      await handleModels({ req, res, requestId: req.piaiRequestId });
      return;
    }

    if (req.method === "POST" && pathname === "/v1/messages/count_tokens") {
      await handleCountTokens({ req, res, requestId: req.piaiRequestId });
      return;
    }

    if (req.method === "POST" && pathname === "/v1/messages") {
      await handleMessages({ req, res, requestId: req.piaiRequestId });
      return;
    }

    throw new GatewayHttpError(404, "not_found_error", "Not found");
  };
}

export const _internal = {
  normalizePathname
};
