export function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

export function anthropicError(type, message) {
  return {
    type: "error",
    error: {
      type,
      message
    }
  };
}
