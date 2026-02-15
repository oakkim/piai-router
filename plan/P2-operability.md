# P2 — Operability

## Goal
Improve production visibility and maintainability after correctness/compatibility work is done.

## Scope
- `src/http/handlers/messages-handler.js`
- `src/logger.js`
- `README.md`

## Tasks

### 1) Add explicit recovery-path telemetry
- Emit structured events for recovery attempt/success/failure.
- Keep event names stable for dashboards/alerting.

**Touch points**
- `src/http/handlers/messages-handler.js:213-227`
- `src/logger.js:53-65`

**Acceptance criteria**
- Recovery metrics/events are visible in server/conversation logs.
- No request-path breakage from telemetry writes.

### 2) Document behavior knobs and caveats
- Document:
  - non-stream recovery behavior
  - thinking suppression (`output_config.format.type=json_schema`)
  - known implications of synthetic signatures

**Touch points**
- `README.md`

**Acceptance criteria**
- README clearly describes runtime behavior and operator expectations.
- Docs match implemented behavior/tests.

## Validation
- `pnpm test`
- Manual smoke check:
  - non-stream recovery scenario
  - stream thinking + suppression scenario
