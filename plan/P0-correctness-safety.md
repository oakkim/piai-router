# P0 — Correctness & Safety

## Goal
Fix highest-risk behavior issues first: output ordering, unnecessary fallback executions, and sensitive log exposure.

## Scope
- `src/http/handlers/messages-handler.js`
- `tests/http/router-routes.test.js`
- `tests/logger.test.js`

## Tasks

### 1) Preserve original content order in recovery
- Replace grouped recovery synthesis (`thinking -> text -> toolCall`) with event-order reconstruction.
- Keep interleaving exactly as observed in stream events.

**Touch points**
- `src/http/handlers/messages-handler.js:55-92`
- `src/http/handlers/messages-handler.js:94-145`

**Acceptance criteria**
- Recovery output preserves original sequence of thinking/text/tool blocks.
- Existing tests pass.
- New interleaving test passes.

### 2) Tighten fallback trigger conditions
- Avoid unconditional stream fallback after empty `complete()` result.
- Only fallback on explicit terminal error/aborted + empty visible content (or similarly strict criteria).

**Touch points**
- `src/http/handlers/messages-handler.js:211-238`
- `tests/http/router-routes.test.js`

**Acceptance criteria**
- No stream fallback when completion is empty but non-terminal/non-error.
- Stream fallback still happens for true recovery scenarios.
- Existing tests pass.

### 3) Redact sensitive fields before conversation logging
- Add request/response sanitization helper for secrets and credentials.
- Keep observability useful while masking sensitive values.

**Touch points**
- `src/http/handlers/messages-handler.js:190-199`
- `src/http/handlers/messages-handler.js:248-253`
- `tests/logger.test.js`

**Acceptance criteria**
- Logs do not contain raw API keys/tokens/secret-like fields.
- Conversation logs still contain required debugging context.
- Existing tests + new redaction tests pass.

## Validation
- `pnpm test`
- Run targeted tests:
  - `tests/http/router-routes.test.js`
  - `tests/logger.test.js`
