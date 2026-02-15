export function createCorsMiddleware() {
  return async function corsMiddleware(context, next) {
    const { req, res } = context;

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,authorization,x-api-key,anthropic-version"
      });
      res.end();
      return;
    }

    await next();
  };
}
