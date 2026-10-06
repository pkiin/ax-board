# AX 아이디어 보드

업무에 AI를 어떻게 활용할지 아이디어를 모아 두는 간단한 웹 보드입니다.
Vite + React로 만들었고, 데이터는 브라우저 `localStorage`에 저장됩니다(별도 서버·DB 없음).

## 주요 기능

- 제목 · 대상 업무 · AI 활용 아이디어 입력 (세 항목 모두 필수)
- 아이디어 카드 목록 표시 (최신순)
- 카드 개별 삭제
- 새로고침해도 목록 유지 (`localStorage`)

## 시작하기

```bash
npm install
npm run dev -- --port $PORT --strictPort
```

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
| `npm run dev -- --port $PORT --strictPort` | 개발 서버 실행 |
| `npm run build` | `dist/`에 프로덕션 빌드 |
| `npm run preview -- --port $PORT --strictPort` | 빌드 결과 미리보기 |

## 폴더 구조

```
src/
├── main.jsx       # 진입점
├── App.jsx        # 전체 상태(아이디어 목록) 관리
├── IdeaForm.jsx   # 입력 폼 + 필수값 검증
├── IdeaCard.jsx   # 아이디어 카드 한 장
├── storage.js     # localStorage 저장/복원
├── id.js          # ID 생성 (crypto.randomUUID 미지원 시 폴백)
└── index.css      # 스타일
```
