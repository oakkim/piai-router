function toBufferedBody(body) {
  if (body === undefined || body === null) {
    return null;
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (typeof body === "string") {
    return Buffer.from(body);
  }
  return Buffer.from(JSON.stringify(body));
}

function createGatewayRequest(request) {
  const bufferedBody = toBufferedBody(request.body);

  return {
    method: request.method,
    url: request.url,
    headers: request.headers,
    async *[Symbol.asyncIterator]() {
      if (bufferedBody !== null) {
        if (bufferedBody.length > 0) {
          yield bufferedBody;
        }
        return;
      }

      if (typeof request.raw?.[Symbol.asyncIterator] === "function") {
        for await (const chunk of request.raw) {
          yield typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        }
      }
    }
  };
}

export function toGatewayContext({ request, reply, config, runner, logger }) {
  return {
    req: createGatewayRequest(request),
    res: reply.raw,
    requestId: request.piaiRequestId,
    config,
    runner,
    logger
  };
}
