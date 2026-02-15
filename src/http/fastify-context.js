export function toGatewayContext({ request, reply, config, runner, logger }) {
  return {
    req: request.raw,
    res: reply.raw,
    requestId: request.piaiRequestId,
    config,
    runner,
    logger
  };
}
