import { anthropicError, json } from "./response.js";

function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] || "";
  }
  return value || "";
}

function extractApiToken(req) {
  const xApiKey = String(getHeader(req, "x-api-key") || "").trim();
  if (xApiKey) {
    return xApiKey;
  }
  const auth = String(getHeader(req, "authorization") || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

function validateGatewayApiKey(req, config) {
  const required = String(config?.gatewayApiKey || "").trim();
  if (!required) {
    return true;
  }
  const incoming = extractApiToken(req);
  return incoming === required;
}

export function createAuthMiddleware() {
  return async function authMiddleware(context, next) {
    const { req, res, config, logger, requestId } = context;

    if (!validateGatewayApiKey(req, config)) {
      json(res, 401, anthropicError("authentication_error", "Invalid API key"));
      logger?.server("auth_failed", {
        requestId,
        method: req.method,
        url: req.url
      });
      return;
    }

    await next();
  };
}

export const _internal = {
  extractApiToken,
  validateGatewayApiKey
};
