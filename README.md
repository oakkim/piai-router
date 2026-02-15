# piai-router

English | [한국어](./README.ko.md)

A lightweight gateway/router that provides Claude API (`Anthropic Messages`) compatible endpoints backed by `@mariozechner/pi-ai`.

## Key Features

- `POST /v1/messages` (stream / non-stream)
- `POST /v1/messages/count_tokens` (approximate)
- `GET /v1/models`
- Provider-specific model mapping (`MODEL_MAP_JSON`, `MODEL_MAP_FILE`, `provider:model` prefix support)
- HTTP engine selection: default `node`, optional `fastify` (`PIAI_HTTP_ENGINE=fastify`)
- Request guardrails: `http.maxBodyBytes`, `http.requestTimeoutMs`

## Install

```bash
pnpm install
```

## Getting Started

### 1) Create config interactively

```bash
pnpm pirouter ui
```

This creates `~/.pirouter/config.json` with your provider/auth settings.

### 2) Start the router

```bash
pnpm pirouter start
```

By default, it listens on `http://localhost:8787`.

### 3) Point Claude-compatible clients

```bash
export ANTHROPIC_BASE_URL=http://localhost:8787
export ANTHROPIC_API_KEY=any-value-or-router-key
```

Or print these commands from your config:

```bash
pnpm pirouter env
```

If you set `ROUTER_API_KEY`, use the same value for `ANTHROPIC_API_KEY`.

### 4) Launch Claude Code directly (optional)

```bash
pnpm pirouter code
```

This runs `claude code` with `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY` automatically applied.

### 5) Quick health check

```bash
curl -s http://localhost:8787/health
```

Expected response:

```json
{"ok":true}
```

## CLI Setup

Default config file path is `~/.pirouter/config.json`.

```bash
# Interactive setup
pnpm pirouter ui

# Show effective config
pnpm pirouter show

# Start server
pnpm pirouter start

# OAuth login (example: codex)
pnpm pirouter login openai-codex

# Print env exports for Claude-compatible clients
pnpm pirouter env

# Launch Claude Code with env auto-applied
pnpm pirouter code
```

To use globally as `pirouter`:

```bash
pnpm link --global
pirouter ui
```

## Run

### Default (Node HTTP) engine

```bash
PI_API_KEY=... \
PI_API=openai-codex-responses \
PI_PROVIDER=openai-codex \
PI_BASE_URL=https://chatgpt.com/backend-api \
PI_MODEL=gpt-5.1-codex-mini \
PORT=8787 \
pnpm start
```

### Fastify engine (optional)

```bash
PIAI_HTTP_ENGINE=fastify \
PI_API_KEY=... \
PORT=8787 \
pnpm start
```

Environment variables take precedence over config file values.

## OAuth (Programmatic)

If the active provider uses `authMode: "oauth"`, the server obtains API keys via `getOAuthApiKey()` and refreshes credentials automatically.

Example:

```json
{
  "provider": "openai-codex",
  "providers": {
    "openai-codex": {
      "api": "openai-codex-responses",
      "authMode": "oauth",
      "oauthProvider": "openai-codex",
      "authFile": "./piai-auth.json",
      "baseUrl": "https://chatgpt.com/backend-api",
      "defaultModel": "gpt-5.1-codex-mini"
    }
  }
}
```

Login:

```bash
pirouter login openai-codex
```

Related env vars:
- `PIAI_AUTH_MODE` (`apiKey` / `oauth`)
- `PIAI_OAUTH_PROVIDER` (`openai-codex`, `anthropic`, `github-copilot`, ...)
- `PIAI_AUTH_FILE` (OAuth credential file path)

## Logging (on/off)

Controlled via the `logging` section in config.

```json
{
  "logging": {
    "enabled": true,
    "server": true,
    "conversation": true,
    "dir": "~/.pirouter/logs",
    "maxQueueSize": 5000
  }
}
```

- `enabled`: global logging toggle
- `server`: server/access/error logs toggle
- `conversation`: request/response conversation logs toggle
- `dir`: log directory
- `maxQueueSize`: async log queue max length (entries are dropped beyond this)

Generated files:
- `server.log.jsonl`
- `conversation.log.jsonl`

You can also control logging via env:

```bash
PIAI_LOG_ENABLED=true
PIAI_LOG_SERVER=true
PIAI_LOG_CONVERSATION=false
PIAI_LOG_DIR=~/.pirouter/logs
```

## Runtime behavior and operator notes

- **Non-stream recovery path**: When a non-stream `complete` call returns no visible assistant content, the router attempts to recover by replaying the request through the streaming path and synthesizing content from stream events. It emits structured telemetry events `recovery_attempt`, `recovery_success`, and `recovery_failure` (conversation logs) for visibility. If upstream still returns an error/aborted state with no content, the request fails with a 502.
- **Thinking suppression**: If `output_config.format.type` is set to `json_schema` (case-insensitive), thinking/reasoning blocks are omitted from responses (including streams) to keep output schema-friendly. Synthetic thinking signatures are not emitted when thinking is suppressed.
- **Synthetic thinking signatures**: When thinking blocks are emitted, each block includes a deterministic `synthetic.<sha256 base64>` signature derived from its thinking text. This aids observability/deduplication but is not a cryptographic attestation; any change to the thinking text changes the signature. Suppressing thinking omits these signatures.

## HTTP Guardrails

Control request body size and timeout via the `http` config section.

```json
{
  "http": {
    "maxBodyBytes": 1048576,
    "requestTimeoutMs": 30000
  }
}
```

Env overrides:

```bash
PIAI_MAX_BODY_BYTES=1048576
PIAI_REQUEST_TIMEOUT_MS=30000
```

## Claude Code Example

```bash
pnpm pirouter env
pnpm pirouter code
```

If you prefer manual setup:

```bash
export ANTHROPIC_BASE_URL=http://localhost:8787
export ANTHROPIC_API_KEY=any-value-or-router-key
```

If you set `ROUTER_API_KEY`, set `ANTHROPIC_API_KEY` to the same value.

## Model Mapping

Example in `~/.pirouter/config.json` or `MODEL_MAP_JSON`:

```json
{
  "openai-codex:claude-sonnet-4-5": {
    "model": "gpt-5.1-codex-mini",
    "reasoning": {
      "low": "minimal",
      "medium": "medium",
      "high": "high",
      "max": "xhigh",
      "default": "medium"
    }
  },
  "openai-codex:claude-opus-4-6": {
    "model": "gpt-5.1-codex",
    "effort": {
      "low": "minimal",
      "medium": "medium",
      "high": "high",
      "max": "xhigh"
    }
  },
  "default": {
    "openai-codex": "gpt-5.1-codex-mini"
  }
}
```

- If incoming `model` matches a mapping key, it is remapped for the active provider.
- `provider:model` keys help avoid alias collisions across providers.
- Object values support `model` plus `reasoning` (or `effort`) mapping.
- Input effort (`max/high/medium/low`) comes from `body.effort` or inferred from `thinking.budget_tokens`.
- `thinking.budget_tokens` thresholds: `<=2048 low`, `<=8192 medium`, `<=24576 high`, above that `max`.
- Falls back to `default` mapping when specific mapping is missing.
- If still missing, original model is used.
- If request model is empty, `PI_MODEL` is used.

## Test

```bash
pnpm test
```
