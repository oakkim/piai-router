# piai-router

`@mariozechner/pi-ai`를 백엔드로 사용해 Claude API(`Anthropic Messages`) 호환 엔드포인트를 제공하는 경량 게이트웨이입니다.

**이 프로젝트를 쓰는 이유:** Claude Code의 익숙한 UX/워크플로우는 그대로 유지하면서, 실제 모델 호출은 Codex/OAuth 기반 provider로 라우팅할 수 있습니다.

## 핵심 기능

- `POST /v1/messages` (stream / non-stream)
- `POST /v1/messages/count_tokens` (근사치)
- `GET /v1/models`
- provider별 모델 치환 (`MODEL_MAP_JSON`, `MODEL_MAP_FILE`, `provider:model` prefix 지원)
- Claude Code를 라우터 환경으로 즉시 실행 (`pirouter code`)
- Codex 등 OAuth 로그인 도우미 (`pirouter login <provider>`)
- HTTP 엔진 선택: 기본 `node`, 옵션 `fastify` (`PIAI_HTTP_ENGINE=fastify`)
- 요청 가드레일: `http.maxBodyBytes`, `http.requestTimeoutMs`

## 설치

### 글로벌 CLI 설치 (권장)

```bash
npm i -g @anthropic-ai/claude-code piai-router
```

설치 후 바로 사용할 수 있습니다:
- `claude` (Claude Code CLI)
- `pirouter` (Anthropic 호환 로컬 게이트웨이)

### 로컬 개발 설치

```bash
pnpm install
```

## Getting Started (Codex OAuth + Claude Code)

### 1) OAuth 로그인 (Codex 예시)

```bash
pirouter login openai-codex
```

### 2) 인터랙티브 설정 생성

```bash
pirouter ui
```

기본 설정 파일은 `~/.pirouter/config.json` 입니다.

### 3) 라우터 시작

```bash
pirouter start
```

기본 주소는 `http://localhost:8787` 입니다.

### 4) Claude Code를 라우터 환경으로 실행

```bash
pirouter code
```

이 명령은 `ANTHROPIC_BASE_URL`과 `ANTHROPIC_API_KEY`를 자동 적용해 `claude code`를 실행합니다.

### 5) (선택) Claude 호환 클라이언트 수동 연결

```bash
export ANTHROPIC_BASE_URL=http://localhost:8787
export ANTHROPIC_API_KEY=any-value-or-router-key
```

또는 현재 설정 기준 export를 출력:

```bash
pirouter env
```

`ROUTER_API_KEY`를 설정한 경우 `ANTHROPIC_API_KEY`와 동일하게 맞추세요.

### 6) 헬스체크

```bash
curl -s http://localhost:8787/health
```

예상 응답:

```json
{"ok":true}
```

## 실행

### 기본(Node HTTP) 엔진

```bash
PI_API_KEY=... \
PI_API=openai-codex-responses \
PI_PROVIDER=openai-codex \
PI_BASE_URL=https://chatgpt.com/backend-api \
PI_MODEL=gpt-5.1-codex-mini \
PORT=8787 \
pnpm start
```

### Fastify 엔진(옵션)

```bash
PIAI_HTTP_ENGINE=fastify \
PI_API_KEY=... \
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
pirouter login openai-codex
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
    "dir": "~/.pirouter/logs",
    "maxQueueSize": 5000
  }
}
```

- `enabled`: 전체 로그 on/off
- `server`: 서버 접근/에러 로그 on/off
- `conversation`: 대화 요청/응답 로그 on/off
- `dir`: 로그 폴더
- `maxQueueSize`: 비동기 로그 큐 최대 길이 (초과 시 drop)

생성 파일:
- `server.log.jsonl`
- `conversation.log.jsonl`

환경변수로도 제어 가능:

```bash
PIAI_LOG_ENABLED=true
PIAI_LOG_SERVER=true
PIAI_LOG_CONVERSATION=false
PIAI_LOG_DIR=~/.pirouter/logs
```

## HTTP 가드레일

설정 파일의 `http` 섹션으로 요청 바디 크기/타임아웃을 제어할 수 있습니다.

```json
{
  "http": {
    "maxBodyBytes": 1048576,
    "requestTimeoutMs": 30000
  }
}
```

환경변수:

```bash
PIAI_MAX_BODY_BYTES=1048576
PIAI_REQUEST_TIMEOUT_MS=30000
```

## Claude Code 설정 예시

```bash
pnpm pirouter env
pnpm pirouter code
```

수동으로 설정하려면:

```bash
export ANTHROPIC_BASE_URL=http://localhost:8787
export ANTHROPIC_API_KEY=any-value-or-router-key
```

`ROUTER_API_KEY`를 설정한 경우에는 `ANTHROPIC_API_KEY` 값을 동일하게 맞추세요.

## 모델 치환

`~/.pirouter/config.json` 또는 `MODEL_MAP_JSON` 예시:

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
