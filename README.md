# piai-gateway

`@mariozechner/pi-ai`를 백엔드로 사용해 Claude API(`Anthropic Messages`) 호환 엔드포인트를 제공하는 경량 게이트웨이입니다.

## 핵심 기능

- `POST /v1/messages` (stream / non-stream)
- `POST /v1/messages/count_tokens` (근사치)
- `GET /v1/models`
- provider별 모델 치환 (`MODEL_MAP_JSON`, `MODEL_MAP_FILE`, `provider:model` prefix 지원)

## 설치

```bash
pnpm install
```

## CLI UI 설정

기본 설정 파일은 `piai-gateway.config.json` 입니다.

```bash
# 인터랙티브 UI
pnpm cli ui

# 설정 확인
pnpm cli show

# 서버 실행
pnpm cli start

# OAuth 로그인 (예: codex)
pnpm cli login openai-codex
```

글로벌로 `cli ui` 형태로 쓰려면:

```bash
pnpm link --global
cli ui
```

## 실행

```bash
PI_API_KEY=... \
PI_API=openai-codex-responses \
PI_PROVIDER=openai-codex \
PI_BASE_URL=https://chatgpt.com/backend-api \
PI_MODEL=gpt-5.1-codex-mini \
PORT=8787 \
pnpm start
```

환경변수는 설정 파일 값보다 우선합니다.

## OAuth (Programmatic)

활성 provider의 `authMode`를 `oauth`로 설정하면, 서버 실행 시 `getOAuthApiKey()`로 API 키를 얻고 만료 시 자동 갱신합니다.

예시:

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

로그인:

```bash
cli login openai-codex
```

설정 환경변수:
- `PIAI_AUTH_MODE` (`apiKey`/`oauth`)
- `PIAI_OAUTH_PROVIDER` (`openai-codex`, `anthropic`, `github-copilot`, ...)
- `PIAI_AUTH_FILE` (OAuth credential 저장 파일)

## 로그(on/off)

설정 파일의 `logging` 섹션에서 제어할 수 있습니다.

```json
{
  "logging": {
    "enabled": true,
    "server": true,
    "conversation": true,
    "dir": "./logs"
  }
}
```

- `enabled`: 전체 로그 on/off
- `server`: 서버 접근/에러 로그 on/off
- `conversation`: 대화 요청/응답 로그 on/off
- `dir`: 로그 폴더

생성 파일:
- `server.log.jsonl`
- `conversation.log.jsonl`

환경변수로도 제어 가능:

```bash
PIAI_LOG_ENABLED=true
PIAI_LOG_SERVER=true
PIAI_LOG_CONVERSATION=false
PIAI_LOG_DIR=./logs
```

## Claude Code 설정 예시

```bash
export ANTHROPIC_BASE_URL=http://localhost:8787
export ANTHROPIC_API_KEY=any-value-or-gateway-key
```

`GATEWAY_API_KEY`를 설정한 경우에는 `ANTHROPIC_API_KEY` 값을 동일하게 맞추세요.

## 모델 치환

`piai-gateway.config.json` 또는 `MODEL_MAP_JSON` 예시:

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

- 요청 `model`이 맵에 있으면 활성 provider 기준으로 치환
- `provider:model` 키를 쓰면 provider별로 alias 충돌 없이 분리 가능
- 값을 객체로 주면 `model` + `reasoning`(또는 `effort`) 매핑 가능
- 입력 effort(`max/high/medium/low`)는 `body.effort` 또는 `thinking.budget_tokens`에서 추정
- `thinking.budget_tokens` 추정 기준: `<=2048 low`, `<=8192 medium`, `<=24576 high`, 그 이상 `max`
- 없으면 `default` 매핑 사용
- 그래도 없으면 요청 모델 그대로 사용
- 요청 모델이 비어 있으면 `PI_MODEL` 사용

## 테스트

```bash
pnpm test
```
