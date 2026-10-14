# AX 아이디어 보드

업무에 AI를 어떻게 활용할지 아이디어를 모아 두는 간단한 웹 보드입니다.
Vite + React 화면, Node.js 백엔드(`server/`), PostgreSQL로 구성됩니다.

```
브라우저 ──▶ Vite ($PORT) ──/api 프록시──▶ 백엔드 ($PORT + 100) ──▶ PostgreSQL (ideas 테이블)
```

## 주요 기능

- 제목 · 대상 업무 · AI 활용 아이디어 입력 (세 항목 모두 필수)
- 아이디어 카드 목록 표시 (최신순)
- 카드 개별 삭제
- PostgreSQL에 저장 (예전 `localStorage` 데이터는 첫 접속 때 서버로 자동 이전)

## 시작하기

```bash
npm install
cp .env.example .env      # userNN을 내 계정 이름으로 바꾸기
npm run server            # 터미널 1: 백엔드 ($PORT + 100, 시작할 때 ideas 테이블 자동 생성)
npm run dev -- --port $PORT --strictPort   # 터미널 2: 화면
```

`.env`는 계정마다 다르므로 Git에 올리지 않습니다.

### 포트 번호 규칙: `30NN`

이 프로젝트는 여러 사람이 같은 공용 개발 서버에서 작업합니다.
포트가 겹치지 않도록 **자기 계정 번호를 붙인 `30NN` 포트**를 사용해 주세요.

| 계정 | 포트 |
|------|------|
| user01 | 3001 |
| user07 | 3007 |
| user99 | 3099 |

`$PORT`는 서버 로그인 시 `/etc/profile.d/dev-server.sh`가 계정 이름을 보고 자동으로 설정합니다.
직접 설정할 필요는 없고, 아래처럼 확인만 하면 됩니다.

```bash
echo $PORT   # 예: user99 → 3099
```

- `--strictPort`를 붙이면 포트가 이미 사용 중일 때 **다른 사람 포트로 넘어가지 않고** 에러로 멈춥니다.
  이 경우 내가 먼저 띄워 둔 dev 서버가 남아 있는지 확인하세요.
- `$PORT`가 비어 있다면 `userNN` 형식이 아닌 계정입니다. 이때는 `--port 30NN`처럼 직접 지정해 주세요.
- VS Code 원격 접속 중이라면 포트가 자동으로 포워딩되어 `http://localhost:$PORT`로 열 수 있습니다.

## 스크립트

| 명령 | 설명 |
|------|------|
| `npm run server` | 백엔드 실행 (`$PORT + 100`) |
| `npm run dev -- --port $PORT --strictPort` | 개발 서버 실행 |
| `npm run build` | `dist/`에 프로덕션 빌드 |
| `npm run preview -- --port $PORT --strictPort` | 빌드 결과 미리보기 |

## 폴더 구조

```
server/
└── index.js       # API 서버 (GET/POST /api/ideas, DELETE /api/ideas/:id)
src/
├── main.jsx       # 진입점
├── App.jsx        # 전체 상태(아이디어 목록) 관리
├── IdeaForm.jsx   # 입력 폼 + 필수값 검증
├── IdeaCard.jsx   # 아이디어 카드 한 장
├── api.js         # 백엔드 호출 + 예전 localStorage 데이터 이전
├── id.js          # ID 생성 (crypto.randomUUID 미지원 시 폴백)
└── index.css      # 스타일
```
