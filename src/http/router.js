import { createGatewayHandler } from "../http-handler.js";

function normalizePathname(url) {
  const raw = typeof url === "string" ? url : "";
  const pathOnly = raw.split("?", 1)[0] || "/";
  if (pathOnly.length > 1) {
    return pathOnly.replace(/\/+$/, "");
  }
  return pathOnly;
}

export function createRouter(params) {
  const legacyHandler = createGatewayHandler(params);

  return async function routeRequest(context) {
    const { req, res } = context;
    const pathname = normalizePathname(req.url);

    if (req.method === "GET" && pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    await legacyHandler(req, res);
  };
}

export const _internal = {
  normalizePathname
};
