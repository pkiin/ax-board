# AX 아이디어 보드

업무에 AI를 어떻게 활용할지 아이디어를 모아 두는 간단한 웹 보드입니다.
Vite + React 화면, Node.js 백엔드, PostgreSQL로 구성됩니다.

```
브라우저 ──▶ 프런트 Vite ($PORT) ──/api──▶ 백엔드 ($PORT + 100) ──▶ PostgreSQL
```

## 주요 기능

- 제목 · 대상 업무 · AI 활용 아이디어 입력 (세 항목 모두 필수)
- 아이디어 카드 목록 표시 (최신순), 개수 표시
- 카드 개별 삭제 (삭제 전 확인)
- PostgreSQL에 저장해 어느 브라우저에서 열어도 같은 목록
- 예전 버전에서 브라우저(`localStorage`)에 저장한 아이디어는 첫 접속 때 서버로 자동 이전

## 시작하기

```bash
npm install --legacy-peer-deps
cp .env.example .env    # userNN을 내 계정 이름으로 바꾸기
npm run dev:all         # 백엔드 + 프런트 함께 실행
```

브라우저에서 `http://localhost:$PORT`를 엽니다(예: user99 → http://localhost:3099).
`ideas` 테이블은 백엔드가 처음 시작할 때 자동으로 만들어집니다. 종료는 `Ctrl+C` 한 번이면 두 서버가 함께 내려갑니다.

> `--legacy-peer-deps`: 현재 `vite@8`과 `@vitejs/plugin-react@4`의 peer 버전이 맞지 않아 필요합니다.

### .env

```
DATABASE_URL=postgresql:///userNN?host=/var/run/postgresql
```

계정마다 값이 다르므로 `.env`는 Git에 올리지 않습니다.

### 포트 번호 규칙

이 프로젝트는 여러 사람이 같은 공용 개발 서버에서 작업합니다.
포트가 겹치지 않도록 **계정 번호를 붙인 포트**를 씁니다. 설정 파일이 `$PORT`에서 자동으로 계산하므로 직접 지정할 필요가 없습니다.

| 계정 | 프런트 (`$PORT`) | 백엔드 (`$PORT + 100`) |
|------|------|------|
| user01 | 3001 | 3101 |
| user07 | 3007 | 3107 |
| user99 | 3099 | 3199 |

`$PORT`는 서버 로그인 시 `/etc/profile.d/dev-server.sh`가 계정 이름을 보고 자동으로 설정합니다.

```bash
echo $PORT   # 예: user99 → 3099
```

- 포트가 이미 사용 중이면 **다른 사람 포트로 넘어가지 않고** 에러로 멈춥니다(`strictPort`).
  이 경우 내가 먼저 띄워 둔 서버가 남아 있는지 확인하세요.
- `$PORT`가 비어 있으면 서버가 시작되지 않습니다. `userNN` 형식이 아닌 계정이라면 `PORT=30NN npm run dev:all`처럼 지정해 주세요.
- VS Code 원격 접속 중이라면 포트가 자동으로 포워딩되어 `http://localhost:$PORT`로 열 수 있습니다.

## 스크립트

| 스크립트 | 설명 |
| --- | --- |
| `npm run dev:all` | 백엔드 + 프런트 동시 실행 |
| `npm run dev` | 프런트 개발 서버 (HMR) |
| `npm run dev:server` | 백엔드 API 서버 (`--watch` 자동 재시작) |
| `npm run build` | `dist/`로 프로덕션 빌드 |
| `npm run preview` | 빌드 결과물 미리보기 (백엔드는 `dev:server`로 따로 실행) |

`dev:server`는 `--watch` 모드라 포트 사용 중·DB 연결 실패 같은 에러가 나도 종료되지 않고 파일 변경을 기다립니다. `[api]` 로그를 확인하세요.

## API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/api/ideas` | 아이디어 목록 (최신순) |
| `POST` | `/api/ideas` | 아이디어 추가 (`title`, `target`, `idea` 필수) |
| `DELETE` | `/api/ideas/:id` | 아이디어 삭제 |
| `GET` | `/api/health` | 서버·DB 상태 확인 |

DB를 직접 보려면 `psql "postgresql:///$(whoami)?host=/var/run/postgresql" -c "select * from ideas"`를 실행합니다.

## 폴더 구조

```
server/
└── index.js       # API 서버 (시작 시 ideas 테이블 생성)
scripts/
└── dev-all.js     # 백엔드 + 프런트 동시 실행
src/
├── main.jsx       # 진입점
├── App.jsx        # 전체 상태(아이디어 목록) 관리, 서버에서 불러오기
├── IdeaForm.jsx   # 입력 폼 + 필수값 검증
├── IdeaCard.jsx   # 아이디어 카드 한 장
├── api.js         # 백엔드 호출 + 예전 localStorage 데이터 이전
├── id.js          # ID 생성 (crypto.randomUUID 미지원 시 폴백)
└── index.css      # 스타일
vite.config.js     # 포트($PORT) + /api 프록시
.env.example       # DATABASE_URL 템플릿
```
