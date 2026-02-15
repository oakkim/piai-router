export class GatewayHttpError extends Error {
  constructor(statusCode, type, clientMessage, options = {}) {
    const internalMessage =
      typeof options.internalMessage === "string" && options.internalMessage
        ? options.internalMessage
        : clientMessage;
    super(internalMessage);
    this.name = "GatewayHttpError";
    this.statusCode = statusCode;
    this.type = type;
    this.clientMessage = clientMessage;
  }
}

export function isGatewayHttpError(error) {
  return error instanceof GatewayHttpError;
}
