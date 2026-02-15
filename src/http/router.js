import { createCountTokensHandler } from "./handlers/count-tokens-handler.js";
import { createMessagesHandler } from "./handlers/messages-handler.js";
import { createModelsHandler } from "./handlers/models-handler.js";
import { GatewayHttpError } from "./http-errors.js";
import { json } from "./response.js";

function normalizePathname(url) {
  const raw = typeof url === "string" ? url : "";
  const pathOnly = raw.split("?", 1)[0] || "/";
  if (pathOnly.length > 1) {
    return pathOnly.replace(/\/+$/, "");
  }
  return pathOnly;
}

export function createRouter(params) {
  const handleModels = createModelsHandler(params);
  const handleCountTokens = createCountTokensHandler(params);
  const handleMessages = createMessagesHandler(params);

  return async function routeRequest(context) {
    const { req, res, logger, requestId } = context;
    const pathname = normalizePathname(req.url);

    if (req.method === "GET" && pathname === "/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && pathname === "/v1/models") {
      await handleModels(context);
      return;
    }

    if (req.method === "POST" && pathname === "/v1/messages/count_tokens") {
      await handleCountTokens(context);
      return;
    }

    if (req.method === "POST" && pathname === "/v1/messages") {
      await handleMessages(context);
      return;
    }

    logger?.server("route_not_found", {
      requestId,
      method: req.method,
      url: req.url
    });
    throw new GatewayHttpError(404, "not_found_error", "Not found");
  };
}

export const _internal = {
  normalizePathname
};
