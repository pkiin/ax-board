# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 참고하는 안내입니다.

## 프로젝트 개요

AX 아이디어 보드: 업무별 AI 활용 아이디어를 입력·조회·삭제하는 웹 앱입니다.

```
브라우저 ──▶ Vite + React ($PORT) ──/api 프록시──▶ Node 백엔드 ($PORT + 100) ──▶ PostgreSQL (ideas 테이블)
```

- 프런트: Vite + React 18 (`src/`)
- 백엔드: Node 내장 `http` + `pg` (`server/`), 프레임워크 없음
- DB: 실습 서버 PostgreSQL, 계정별 DB (`.env`의 `DATABASE_URL`)

## 개발 서버 실행 (중요)

공용 개발 서버라 여러 사용자가 동시에 서버를 띄웁니다. **포트는 반드시 계정별 `$PORT` 기준입니다.**

```bash
npm run dev:all   # 백엔드 + 프런트 함께 실행
```

| 서버 | 포트 | 예 (user99) |
| --- | --- | --- |
| 프런트 (Vite) | `$PORT` | 3099 |
| 백엔드 API | `$PORT + 100` | 3199 |

- `$PORT`는 `/etc/profile.d/dev-server.sh`에서 계정 이름 `userNN` → `30NN`으로 자동 설정됩니다.
- 포트는 `vite.config.js`와 `server/index.js`가 `$PORT`에서 계산합니다. `--port`로 다른 번호를 넘기지 마세요.
- Vite는 `strictPort: true`라 포트가 사용 중이면 다른 번호(= 다른 사용자 포트)로 넘어가지 않고 멈춥니다. 이 설정을 끄지 마세요. 백엔드도 같은 원칙으로 멈춥니다.
- 포트가 사용 중이라는 에러가 나면 다른 포트로 바꾸지 말고, 내 계정에서 이미 실행 중인 서버를 확인하세요 (`ss -ltnp | grep -E ':(30|31)NN'`).
- `$PORT`가 비어 있으면 서버가 에러로 멈춥니다. 임의로 정하지 말고 사용자에게 물어보세요.

## 명령어

| 명령 | 설명 |
| --- | --- |
| `npm install` | 의존성 설치 (아래 주의 참고) |
| `npm run dev:all` | 백엔드 + 프런트 동시 실행 (`scripts/dev-all.js`, 한쪽이 끝나면 같이 종료) |
| `npm run dev` | 프런트 개발 서버만 (HMR) |
| `npm run dev:server` | 백엔드만 (`node --watch`, 파일 변경 시 자동 재시작) |
| `npm run build` | 프로덕션 빌드 (`dist/`) |
| `npm run preview` | 빌드 결과 미리보기 (`/api` 프록시 포함, 백엔드는 따로 실행) |

- 기존 `vite@8`과 `@vitejs/plugin-react@4`의 peer 의존성이 맞지 않아 `npm install`은 `--legacy-peer-deps`가 필요합니다.
- `dev:server`는 `--watch` 모드라 시작 중 에러(포트 사용 중, DB 연결 실패 등)가 나도 프로세스가 끝나지 않고 파일 변경을 기다립니다. 로그의 `[api]` 에러를 확인하세요.
- 테스트·린트 설정은 아직 없습니다. 변경 후에는 `npm run build`가 통과하는지 확인합니다.

## 환경 변수 (.env)

```
DATABASE_URL=postgresql:///userNN?host=/var/run/postgresql
OPENROUTER_API_KEY=sk-or-...
KMA_API_KEY=...
```

- 계정마다 다르므로 `.env`는 Git에 올리지 않습니다(`.gitignore`). 템플릿은 `.env.example`입니다.
- 백엔드는 Node `--env-file=.env`로 읽습니다(`dotenv` 미사용). `.env`를 바꾸면 백엔드를 다시 시작해야 반영됩니다.
- `OPENROUTER_API_KEY`는 백엔드에서만 씁니다. `VITE_` 접두사를 붙이면 프런트 번들에 키가 그대로 들어가므로 붙이지 않습니다. 키 값은 응답·로그에 출력하지 않습니다.
- `KMA_API_KEY`(기상청)도 백엔드 전용입니다. data.go.kr 일반 인증키 중 **Decoding** 키를 넣습니다(Encoding 키는 두 번 인코딩되어 인증 오류).

## 코드 구조

- `server/index.js`: API 서버. 시작할 때 `ideas` 테이블을 `CREATE TABLE IF NOT EXISTS`로 만든다
  - `GET /api/ideas`: 최신순 목록
  - `POST /api/ideas`: 추가. 세 필드 trim 후 필수값·길이 검증, 같은 `id`가 있으면 기존 행을 돌려준다(중복 저장 안 함)
  - `DELETE /api/ideas/:id`: 삭제 (없으면 404)
  - `GET /api/health`: DB 연결 확인
  - `GET /api/ai/ping`: `OPENROUTER_API_KEY`가 읽히는지만 확인 (있으면 200 `{ ok: true, keyLoaded: true }`, 없으면 503). 키 값은 돌려주지 않는다
  - `GET /api/weather`: 기상청 초단기실황(`getUltraSrtNcst`)으로 천안(nx 62, ny 110) 현재 날씨. KST 기준 40분 전이면 한 시간 전 자료를 요청하고, 10분 동안 메모리 캐시. 키 없으면 503, 기상청 오류·타임아웃(5초)은 502. 응답 `{ location, observedAt, temperature, humidity, rain1h, precipType, windSpeed, windDir }`. 초단기실황에는 하늘상태(맑음·흐림)가 없다
- `scripts/dev-all.js`: `dev:server`와 `dev`를 함께 띄우고 출력에 `[api]`/`[web]`을 붙인다
- `vite.config.js`: 포트(`$PORT`, strictPort)와 `/api` → `$PORT + 100` 프록시
- `src/App.jsx`: 목록 상태 소유. 처음에 서버에서 불러오고, 추가·삭제는 서버 응답 후 화면에 반영
- 레이아웃: `.page`가 2단 grid. 왼쪽 `<aside className="side">`에 정보 카드(날씨, 이후 뉴스·주가를 그 아래에 차례로), 오른쪽 `<main>`에 보드. 800px 이하에서는 한 줄로 쌓인다
- `src/WeatherCard.jsx`: 날씨 카드. 로딩·에러 상태를 직접 가져 아이디어 목록과 따로 동작
- `src/api.js`: 백엔드 호출, 예전 `localStorage`(`ax-board.ideas.v1`) 데이터를 첫 접속 때 서버로 이전 후 삭제
- `src/IdeaForm.jsx`: 입력 폼, 세 필드(제목·대상 업무·아이디어) trim 후 필수값 검증. 저장 실패 시 입력 내용 유지
- `src/IdeaCard.jsx`: 카드 표시와 삭제 버튼(삭제 전 확인창)
- `src/id.js`: `crypto.randomUUID` 우선, 미지원 환경은 타임스탬프+난수 폴백

## DB 스키마

```sql
CREATE TABLE ideas (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  target     TEXT NOT NULL,
  idea       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

DB 직접 확인: `psql "$DATABASE_URL"` 또는 `psql -h /var/run/postgresql $(whoami)`

## 작업 규칙

- UI 문구, 주석, 커밋 메시지는 한국어로 작성합니다.
- API 응답 형식은 `{ id, title, target, idea, createdAt }`(camelCase)입니다. DB 컬럼은 snake_case이고 `server/index.js`의 `toIdea`에서 변환합니다.
- 테이블 구조를 바꾸면 기존 데이터가 있는 DB에서도 동작하도록 `ALTER TABLE` 등 이전 방법을 함께 작성합니다(`CREATE TABLE IF NOT EXISTS`는 이미 있는 테이블을 바꾸지 않습니다).
- 프런트와 백엔드의 입력 검증 규칙(필수값, 길이)은 함께 맞춥니다.
- 새 의존성은 꼭 필요할 때만 추가합니다.

## Git 규칙

- main 브랜치에 직접 commit · push 하지 않는다
- 작업 전 main을 최신으로 받고 새 브랜치에서 시작한다
- 브랜치 이름: feat/내용, fix/내용
- 커밋 메시지: "feat: 한국어 설명" 형식
- PR 본문에 관련 Issue(Closes #번호)와 확인 방법을 적는다
- 충돌이 나면 임의로 해결하지 말고 양쪽 내용을 설명한 뒤 멈춘다
