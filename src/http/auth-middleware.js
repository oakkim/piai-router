import { GatewayHttpError } from "./http-errors.js";
import { extractApiToken } from "./upstream-auth.js";

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
    const { req, logger, requestId } = context;

    if (!validateGatewayApiKey(req, context.config)) {
      logger?.server("auth_failed", {
        requestId,
        method: req.method,
        url: req.url
      });
      throw new GatewayHttpError(401, "authentication_error", "Invalid API key");
    }

    await next();
  };
}

export const _internal = {
  extractApiToken,
  validateGatewayApiKey
};
