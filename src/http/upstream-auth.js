export function extractApiToken(req) {
  const xApiKey = String(req.headers["x-api-key"] || "").trim();
  if (xApiKey) {
    return xApiKey;
  }

  const authHeader = req.headers.authorization;
  const auth = Array.isArray(authHeader)
    ? String(authHeader[0] || "").trim()
    : String(authHeader || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  return "";
}

export function getUpstreamApiKey(req, config) {
  if (config?.upstream?.authMode === "oauth") {
    return "";
  }

  const configuredApiKey = String(config?.upstream?.apiKey || "").trim();
  if (configuredApiKey) {
    return configuredApiKey;
  }

  return extractApiToken(req);
}
