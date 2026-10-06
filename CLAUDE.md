# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 참고하는 안내입니다.

## 프로젝트 개요

AX 아이디어 보드: 업무별 AI 활용 아이디어를 입력·조회·삭제하는 Vite + React 18 단일 페이지 앱입니다.
백엔드 없이 브라우저 `localStorage`(키: `ax-board.ideas.v1`)에만 저장합니다.

## 개발 서버 실행 (중요)

공용 개발 서버라 여러 사용자가 동시에 dev 서버를 띄웁니다. **반드시 계정별 포트 `$PORT`를 사용하세요.**

```bash
npm run dev -- --port $PORT --strictPort
```

- `$PORT`는 `/etc/profile.d/dev-server.sh`에서 계정 이름 `userNN` → `30NN`으로 자동 설정됩니다(예: user99 → 3099).
- 기본 포트(5173)나 임의의 포트로 띄우지 마세요. 다른 사용자와 충돌합니다.
- `--strictPort`를 빼지 마세요. 빼면 포트가 사용 중일 때 Vite가 다음 번호(= 다른 사용자 포트)로 넘어갑니다.
- 포트가 사용 중이라는 에러가 나면 다른 포트로 바꾸지 말고, 내 계정에서 이미 실행 중인 dev 서버를 확인하세요.
- `$PORT`가 비어 있으면 임의로 정하지 말고 사용자에게 물어보세요.
- `npm run preview`도 똑같이 `-- --port $PORT --strictPort`를 붙입니다.

## 명령어

- `npm install`: 의존성 설치
- `npm run dev -- --port $PORT --strictPort`: 개발 서버
- `npm run build`: 프로덕션 빌드 (`dist/`)

테스트·린트 설정은 아직 없습니다. 변경 후에는 `npm run build`가 통과하는지 확인합니다.

## 코드 구조

- `src/App.jsx`: 아이디어 목록 상태를 소유하고, 변경될 때마다 `saveIdeas`로 저장
- `src/IdeaForm.jsx`: 입력 폼, 세 필드(제목·대상 업무·아이디어) trim 후 필수값 검증
- `src/IdeaCard.jsx`: 카드 표시와 삭제 버튼
- `src/storage.js`: `localStorage` 읽기/쓰기, 실패해도 예외를 던지지 않음
- `src/id.js`: `crypto.randomUUID` 우선, 미지원 환경은 타임스탬프+난수 폴백

## 작업 규칙

- UI 문구, 주석, 커밋 메시지는 한국어로 작성합니다.
- 저장 데이터 형식을 바꾸면 `STORAGE_KEY`의 버전(`v1`)을 올리고 기존 데이터 처리 방법을 고려합니다.
- 새 의존성은 꼭 필요할 때만 추가합니다.
