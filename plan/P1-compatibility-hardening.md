# P1 — Compatibility Hardening

## Goal
Improve protocol-compatibility reliability for thinking/signature flows and stream state edge cases.

## Scope
- `src/anthropic-bridge.js`
- `tests/anthropic-bridge.test.js`
- `tests/stream-bridge.test.js`

## Tasks

### 1) Stabilize synthetic thinking signature behavior
- Ensure signature generation is deterministic and consistently applied.
- Keep behavior well-defined when thinking is suppressed.

**Touch points**
- `src/anthropic-bridge.js:49-52`
- `src/anthropic-bridge.js:339-380`
- `src/anthropic-bridge.js:570-595`

**Acceptance criteria**
- Same thinking input yields same signature.
- Suppression mode emits no thinking records.
- Existing tests pass + deterministic signature test added.

### 2) Harden stream block lifecycle handling
- Add guardrails for out-of-order/malformed stream events.
- Ensure no stale open block indices remain after close/error/done paths.

**Touch points**
- `src/anthropic-bridge.js:463-488`
- `src/anthropic-bridge.js:631-649`
- `tests/stream-bridge.test.js`

**Acceptance criteria**
- No index leaks/collisions across thinking/text/tool channels.
- Graceful behavior on unusual event order.
- Existing tests + new edge-case tests pass.

## Validation
- `pnpm test`
- Run targeted tests:
  - `tests/anthropic-bridge.test.js`
  - `tests/stream-bridge.test.js`
