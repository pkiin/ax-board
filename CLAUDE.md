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
NAVER_CLIENT_ID=...
NAVER_CLIENT_SECRET=...
FINNHUB_API_KEY=...
```

- 계정마다 다르므로 `.env`는 Git에 올리지 않습니다(`.gitignore`). 템플릿은 `.env.example`입니다.
- 백엔드는 Node `--env-file=.env`로 읽습니다(`dotenv` 미사용). `.env`를 바꾸면 백엔드를 다시 시작해야 반영됩니다.
- `OPENROUTER_API_KEY`는 백엔드에서만 씁니다. `VITE_` 접두사를 붙이면 프런트 번들에 키가 그대로 들어가므로 붙이지 않습니다. 키 값은 응답·로그에 출력하지 않습니다.
- `KMA_API_KEY`(기상청)도 백엔드 전용입니다. data.go.kr 일반 인증키 중 **Decoding** 키를 넣습니다(Encoding 키는 두 번 인코딩되어 인증 오류).
- `NAVER_CLIENT_ID`·`NAVER_CLIENT_SECRET`(네이버 검색)도 백엔드 전용입니다. 요청 헤더로만 보내고 값은 출력하지 않습니다.
- `FINNHUB_API_KEY`(시세)도 백엔드 전용입니다. `token` 쿼리로만 보내고 값은 출력하지 않습니다.

## 코드 구조

- `server/index.js`: API 서버. 시작할 때 `ideas` 테이블을 `CREATE TABLE IF NOT EXISTS`로 만든다
  - `GET /api/ideas`: 최신순 목록. 각 카드에 `image: { kind, caption, url } | null`(대표 이미지 정보, 파일 제외), `video: { status, model, duration, audio, scenario, estimate, cost, error, createdAt, url } | null`(활용 장면 영상, `status`는 `generating`·`ready`·`failed`, `url`은 `ready`일 때만)
  - `GET /api/ideas/:id`: 카드 하나 (영상을 만드는 동안 화면이 15초마다 다시 읽는다)
  - `POST /api/ideas`: 추가. 세 필드 trim 후 필수값·길이 검증, 같은 `id`가 있으면 기존 행을 돌려준다(중복 저장 안 함)
  - `DELETE /api/ideas/:id`: 삭제 (없으면 404)
  - `PATCH /api/ideas/:id` `{ proposal }`: AI 기획안 적용. 원래 제목·대상 업무·아이디어는 그대로 두고 `proposal`만 바꾼다. `validateProposal`로 검사(5개 글 항목 필수·길이, 난이도는 쉬움/보통/어려움)
  - `GET /api/ideas/:id/image`: 대표 이미지 파일. 주소의 `?v=`(저장 시각)가 바뀌므로 오래 캐시
  - `PUT /api/ideas/:id/image` `{ kind, image, caption, model }`: 대표 이미지 적용(카드당 한 장, 덮어씀). `kind`는 `photo`(설명 `caption` 필수·200자 이하) 또는 `generated`. `image`는 jpeg/png/webp data URL, 1.5MB 이하(요청 본문 2.5MB 제한)
  - `DELETE /api/ideas/:id/image`: 대표 이미지 삭제, 바뀐 카드를 돌려준다
  - `GET /api/ideas/:id/video`: 영상 파일(mp4). `Range` 요청(탐색) 지원, 주소의 `?v=`(완료 시각)가 바뀌므로 오래 캐시
  - `POST /api/ideas/:id/video` `{ model, before, after, prompt, duration, audio, firstFrame }`: 영상 만들기. 시나리오 패널의 "만들기"에서만 부른다. OpenRouter `/videos`에 작업만 제출하고 202로 `status: generating`인 카드를 돌려준다. `firstFrame`은 화면이 대표 이미지를 16:9(1280×720)로 잘라 보낸 data URL(첫 장면, `frame_images`의 `first_frame`). 대표 이미지가 없으면 400, 이미 만드는 중이면 409. `duration`은 모델의 `durations`, `audio`는 모델이 소리를 만들 수 있을 때만. 카드당 한 개, 다시 만들면 바꾼다
  - `DELETE /api/ideas/:id/video`: 영상 삭제. 만드는 중에 지워도 OpenRouter 작업은 멈추지 않아 비용은 든다
  - 영상 완료 확인: 서버가 `pollVideos`로 20초마다 `status = 'generating'`인 작업의 `polling_url`을 확인한다(서버 재시작 시 DB에서 이어서). `completed`면 `unsigned_urls[0]`(API 키 필요)에서 mp4를 받아 DB에 저장하고 `usage.cost`를 실제 비용으로, `failed`·`cancelled`·`expired`나 20분 초과는 `failed`와 `error`
  - `GET /api/health`: DB 연결 확인
  - `GET /api/ai/ping`: `OPENROUTER_API_KEY`가 읽히는지만 확인 (있으면 200 `{ ok: true, keyLoaded: true }`, 없으면 503). 키 값은 돌려주지 않는다
  - `GET /api/ai/models?type=text|vision|image|speech|transcription|video` (`kind=`도 같음): OpenRouter 모델 목록(가격이 음수인 라우터 제외, 1시간 메모리 캐시). 기본 목록에는 이미지만 내는 모델(flux 등)·음성 모델이 없어서 `?output_modalities=all`로 받는다
    - `text`(기본, 다듬기): 텍스트 출력 모델. `[{ id, name, free, inputPrice, outputPrice, contextLength }]`, 가격은 100만 토큰당 USD. `openrouter/free` → 무료 → 이름순
    - `vision`(사진 설명): 이미지 입력 + 글만 출력. `image`(그리기): 이미지 출력. `speech`(읽어 주기): `speech` 출력. `transcription`(받아쓰기): `transcription` 출력. `[{ id, name, free, inputPrice, outputPrice, estimate, default, outputs, cheapest, popular }]`, `speech`는 `voices`(`supported_voices`)·`defaultVoice`, `transcription`은 `secondPrice`(초당 USD)를 더 준다
    - `video`(영상): OpenRouter `/videos/models`(별도 목록, 1시간 캐시)에서 첫 장면(`first_frame`)을 받고 5~8초를 만들 수 있는 모델만. `[{ id, name, free, durations, resolution, audio, pricePerSecond: { audio, silent }, estimate, default, cheapest, popular }]`. `pricing_skus` 키가 모델마다 달라(`duration_seconds_*` USD/초, `cents_*` 센트/초, `video_tokens_*`는 가로×세로×24fps/1024 토큰/초) `videoSecondPrice`가 해상도(720p, 없으면 지원하는 첫 해상도)·소리 여부에 가장 맞는 키를 골라 초당 USD로 바꾼다(참조·이어 만들기·글로만 만들기 가격 제외). `estimate`는 가장 긴 길이·소리 포함(가능하면) 기준. 가격을 계산할 수 없는 모델은 뺀다
    - 가격 단위: `speech`의 `pricing.prompt`는 **글자당**(실제 비용으로 확인), Gemini TTS 등은 `completion`(오디오 출력 토큰) 가격이 더 붙는다. `transcription`의 `prompt`는 **초당**(응답 `usage.seconds`·`cost`로 확인), `completion`이 있는 모델(gpt-4o-transcribe 등)은 토큰 가격이라 오디오 1초 = 32토큰으로 어림. 1회 예상은 읽기 300글자(오디오 1500토큰), 받아쓰기 30초 기준 `estimate`는 1회 예상 비용(USD, 이미지 가격 단위가 모델마다 달라 1장 = 1290토큰으로 어림한 대략값). `free`는 모든 가격이 0일 때만(이미지 모델은 글 가격이 0이어도 이미지 가격이 있음). `cheapest`는 유료 중 `estimate` 최소(같으면 기본 모델). 정렬은 기본 모델 → 가장 많이 씀 → 가장 저렴 → 무료 → 이름순
    - `popular`(가장 많이 씀): 공개 API가 없어 **비공식으로** 순위 페이지 HTML 안의 `{ model_permaslug, variant, count }`를 읽는다. `image`는 `openrouter.ai/rankings/image`, `speech`·`transcription`·`video`는 `/rankings/speech`·`/rankings/transcription`·`/rankings/video`, `vision`은 `openrouter.ai/rankings`(전체 상위 20개라 사진 입력 모델이 없으면 배지 없음). `model_permaslug`는 모델의 `canonical_slug`, `variant: free`는 `:free` 모델과 맞춘다. 1시간 캐시, 실패하면 배지만 빠지고 10분 뒤 다시 시도
  - `POST /api/ai/refine` `{ id, model }`: DB의 아이디어를 기획안으로 다듬어 `{ proposal, model, cost }`를 돌려준다(저장 안 함). `model`은 위 목록에 있어야 한다(아니면 400, 기본 `openrouter/free`). 응답에서 JSON만 꺼내 검사하고 틀리면 한 번 더 요청. 타임아웃 60초, 실패하면 502. `model`은 실제로 응답한 모델, `cost`는 OpenRouter `usage.cost`(USD)
  - `POST /api/ai/describe` `{ id, model, image }`: 사진을 한국어 한 문장(200자 이하)으로 설명해 `{ caption, model, cost }`를 돌려준다(저장 안 함). 기본 모델 `minimax/minimax-m3.1-flash:free`, `vision` 목록에 있어야 한다. 형식이 틀리면 한 번 더 요청, 타임아웃 60초
  - `POST /api/ai/draw` `{ id, model }`: 카드 제목(기획안이 있으면 기획안 제목)과 대상 업무로 글자 없는 대표 이미지를 그려 `{ image(data URL), model, cost }`를 돌려준다(저장 안 함). 기본 모델 `google/gemini-3.1-flash-image`(Nano Banana 2, 유료 1장 약 $0.07), `image` 목록에 있어야 한다. 이미지만 내는 모델은 `modalities: ["image"]`, 글도 내는 모델은 `["image","text"]`. 비용 때문에 재시도 없음, 타임아웃 120초
  - `POST /api/ai/speak` `{ id, model, voice }`: DB의 카드 내용(기획안이 있으면 제목 + 한 줄 요약, 없으면 제목 + 아이디어, 500자까지)을 OpenRouter `/audio/speech`로 읽어 **mp3 파일**을 돌려준다(JSON 아님). 헤더 `X-AI-Model`·`X-AI-Voice`·`X-AI-Cost`(글자 수로 계산한 비용, 오디오 토큰 모델은 어림). 기본 `elevenlabs/eleven-v4-turbo` + 목소리 `sarah`(ElevenLabs에는 한국어 전용 목소리가 없어, 한국어 문장을 읽혀 받아쓰기로 되돌렸을 때 원문과 같았던 목소리). `model`은 `speech` 목록에 있어야 하고, `voice`는 그 모델의 `voices`에 있어야 한다(없으면 `defaultVoice`, 목소리 목록이 없는 모델은 목소리를 보내지 않음). 타임아웃 60초
  - `POST /api/ai/listen` `{ audio(base64), format, model }`: 녹음을 OpenRouter `/audio/transcriptions`(`input_audio`, `language: ko`)로 받아써 `{ text, model, seconds, cost }`를 돌려준다. `format`은 webm·ogg·m4a·mp3·wav, 3MB 이하(본문 4.5MB 제한). 기본 `openai/whisper-large-v3-turbo`, `transcription` 목록에 있어야 한다
  - `POST /api/briefing` `{ symbols, model, speechModel, voice }`: 출근길 브리핑. 날씨(`getWeather`, 10분 캐시 공유)·뉴스(`fetchNews`, 검색어 "천안 AX")·주가(`getQuote`, 화면의 내 종목 목록, 없으면 기본 4종목)를 `Promise.allSettled`로 동시에 모아, 실패하거나 키가 없는 것은 "정보 없음"으로 넘긴다(셋 다 실패하면 502). 텍스트 모델(`model`, 글 목록, 기본 `openrouter/free`)로 한국어 한 단락을 쓰고 앞 4문장·500자까지만 쓴다(시간 초과·오류·형식 오류는 1회 재시도, 시도마다 45초). 그 글을 읽어 주기와 같은 `speakText`·`resolveSpeech`로 mp3로 만든다. 응답 `{ text, sources: { weather, news, stocks }, model, cost, audio: { url(data URL), model, voice, cost } | null, audioError }`. 음성이 실패해도 글은 200으로 돌려준다. 모델·종목은 호출 전에 검사(400)
  - `POST /api/ai/video/plan` `{ id, model, textModel }`: 활용 장면 영상 시나리오. 지금 고른 글 모델(`textModel`, 기본 `openrouter/free`)이 대상 업무 → 도입 전 장면, AI 활용 아이디어(기획안이 있으면 AI 활용 방식) → 도입 후 장면, 길이(영상 모델의 5~8초 선택지 중), 영어 영상 프롬프트를 JSON으로 쓴다(형식이 틀리면 한 번 더). 영상은 만들지 않는다. 응답 `{ scenario: { before, after, prompt, duration }, model(영상 모델 정보·가격), textModel, cost }`. 대표 이미지가 없으면 400. 기본 영상 모델 `google/veo-3.1-lite`(720p 소리 포함 초당 $0.05, 8초 약 $0.40)
  - `GET /api/weather`: 기상청 초단기실황(`getUltraSrtNcst`)으로 천안(nx 62, ny 110) 현재 날씨. KST 기준 40분 전이면 한 시간 전 자료를 요청하고, 10분 동안 메모리 캐시. 키 없으면 503, 기상청 오류·타임아웃(5초)은 502. 응답 `{ location, observedAt, temperature, humidity, rain1h, precipType, windSpeed, windDir }`. 초단기실황에는 하늘상태(맑음·흐림)가 없다
  - `GET /api/news?q=검색어`: 네이버 뉴스 검색(`sort=date`, `display=3`). 검색어 trim 후 필수·50자 이하(아니면 400). 응답 `[{ title, link, date }]`, 제목의 `<b>` 태그와 HTML 엔티티는 지움, `date`는 ISO. 키 없으면 503, 네이버 오류·타임아웃(5초)은 502
  - `GET /api/stock?s=MSFT,AAPL,NVDA,GOOGL`: Finnhub 시세(쉼표로 여러 종목, 없으면 이 기본 4종목). 대문자로 바꾸고 중복 제거, 1~6개·형식 검사(아니면 400). 종목마다 따로 호출해 `[{ symbol, price, changePct, found }]`(`c`, `dp`). 값이 모두 0이거나 403(무료 플랜에서 볼 수 없는 종목)이면 `found: false`. 한 종목이 실패하면 그 줄만 `{ found: null, error }`, 모두 실패하면 502. 무료 한도(분당 60회) 때문에 종목별 1분 메모리 캐시(실패는 저장 안 함). 키 없으면 503
- `scripts/dev-all.js`: `dev:server`와 `dev`를 함께 띄우고 출력에 `[api]`/`[web]`을 붙인다
- `vite.config.js`: 포트(`$PORT`, strictPort)와 `/api` → `$PORT + 100` 프록시
- `src/App.jsx`: 목록 상태 소유. 처음에 서버에서 불러오고, 추가·삭제는 서버 응답 후 화면에 반영
- 레이아웃: `.page`가 2단 grid. 왼쪽 `<aside className="side">`가 "오늘의 정보" 영역(브리핑 → 날씨 → 뉴스 → 주가 순서, 카드는 `.widget` 공통 스타일). 카드마다 따로 불러와서 서로 기다리지 않고, 하나가 실패해도 나머지는 보인다, 오른쪽 `<main>`에 보드. 800px 이하에서는 한 줄로 쌓인다
- `src/WeatherCard.jsx`: 날씨 카드. 로딩·에러 상태를 직접 가져 아이디어 목록과 따로 동작
- `src/NewsCard.jsx`: 뉴스 카드. 검색어 기본값 "천안 AX", 카드 안에서 바꿔 검색. 제목은 새 탭 링크
- `src/BriefingCard.jsx`: "오늘의 브리핑" 버튼. 설정의 글 모델과 읽어 주기 모델·목소리, 주가 카드의 내 종목 목록(`loadSymbols`)으로 `/api/briefing`을 부른다. 유료 모델이 끼어 있으면 버튼에 "유료", 누를 때 예상 비용 확인창. 결과는 정보별 ✓/정보 없음, 글, 재생 버튼(`<audio controls>`), 모델·비용
- `src/StockCard.jsx`: 주가 카드. 종목마다 한 줄(기호·현재가·▲▼ 등락률·삭제), 아래 입력란으로 추가(추가 전 조회해서 없는 종목이면 "찾을 수 없는 종목이에요"). 목록은 `localStorage`(`ax-board.stocks.v1`)에 저장, 기본 MSFT·AAPL·NVDA·GOOGL, 최대 6종목
- AI로 다듬기: `IdeaCard.jsx`의 버튼 → `RefinePanel.jsx`(원래 내용과 기획안 나란히, 적용/취소). 기획안이 있으면 카드에 기획안을 보여 주고 원래 내용은 `<details>`로 접어 둔다. 항목 순서는 `src/proposal.js`
- `src/SettingsDialog.jsx`: 헤더 오른쪽 위 톱니바퀴로 여는 설정 팝업(`<dialog>`). "글"(다듬기) 칸 아래 "이미지" 칸에 "사진 설명"·"이미지 그리기" 목록, 목록 하나는 `src/ModelPicker.jsx`(검색·무료만 보기·가격, "가장 많이 씀"/"가장 저렴" 배지), 종류별로 따로 불러온다. 유료 모델을 고르면 비용 경고. 그 아래 "읽어 주기"(목소리 고르기 포함, 모델을 바꾸면 그 모델의 기본 목소리로)·"받아쓰기"·"영상" 칸. 모델마다 "기본" 배지. 고른 모델은 `src/aiSettings.js`가 `localStorage`에 저장(글 `ax-board.ai-model.v1`, 사진 설명·그리기·읽어 주기·받아쓰기·영상 `ax-board.ai-media-models.v1`), 유료면 카드 버튼에 "유료" 표시
- 읽어 주기: `IdeaCard.jsx`의 "🔊 읽어 주기" → `speakIdea`(`src/api.js`)가 mp3를 blob URL로 받아 카드의 `<audio>`에서 바로 재생, 새로 받거나 카드가 사라지면 URL 해제
- 받아쓰기: `src/DictateButton.jsx`(새 아이디어 입력란 세 칸의 이름 옆). 누르면 `MediaRecorder` 녹음, 다시 누르거나 60초가 지나면 멈추고 받아쓴 글을 그 칸 뒤에 이어 붙인다(제목·대상 업무 80자, 아이디어 2000자에서 자름). 녹음·형식 변환은 `src/audio.js`(크롬·파이어폭스 webm, 사파리 m4a). 마이크는 HTTPS나 localhost 주소에서만 열린다
- 활용 장면 영상: `IdeaCard.jsx`의 "🎬 활용 장면 영상" → 대표 이미지가 없으면 먼저 이미지 안내, 있으면 시나리오 → `VideoPanel.jsx`(첫 장면 미리보기, 도입 전·후·프롬프트 고치기, 길이·소리, 예상 금액). "만들기"를 누르면 확인창 → `toVideoFrame`(`src/image.js`, 가운데를 16:9로 자름)으로 첫 장면을 만들어 제출. 만드는 동안 "영상 만드는 중… N분 지남"을 보여 주고 15초마다 `GET /api/ideas/:id`로 다시 읽어, 다 되면 카드의 `<video controls>`에서 재생. `App.jsx`의 `updateIdea`는 이 주기 갱신 때문에 `useCallback`으로 둔다
- 대표 이미지: `IdeaCard.jsx`의 "사진 올리기"(파일 선택 → 설명)·"이미지 그리기" → `ImagePanel.jsx` 미리보기(적용/취소). 유료 모델이면 호출 전에 예상 비용 확인창. 카드당 한 장이고 나중에 적용한 것이 덮어쓴다. `src/image.js`가 파일 형식·크기(10MB)를 검사하고 긴 변 1024px JPEG로 줄인다(올린 사진은 설명 요청 전에, 그린 이미지는 적용할 때)
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  proposal   JSONB  -- AI 기획안 { title, summary, problem, approach, effect, difficulty }, 없으면 NULL
);

-- 카드 대표 이미지 (카드당 한 장, 카드를 지우면 함께 삭제)
CREATE TABLE idea_images (
  idea_id    TEXT PRIMARY KEY REFERENCES ideas(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,   -- 'photo'(올린 사진) | 'generated'(AI가 그린 그림)
  mime       TEXT NOT NULL,
  data       BYTEA NOT NULL,
  caption    TEXT,            -- 사진 설명 (photo만)
  model      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 활용 장면 영상 (카드당 한 개, 카드를 지우면 함께 삭제). 만드는 동안 작업 정보를 두고 끝나면 data에 mp4
CREATE TABLE idea_videos (
  idea_id     TEXT PRIMARY KEY REFERENCES ideas(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,   -- 'generating' | 'ready' | 'failed'
  job_id      TEXT NOT NULL,   -- OpenRouter 작업 id
  polling_url TEXT NOT NULL,
  model       TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  scenario    JSONB,           -- { before, after, prompt }
  duration    INTEGER NOT NULL,
  audio       BOOLEAN NOT NULL,
  estimate    NUMERIC,         -- 만들 때 예상 금액 (USD)
  cost        NUMERIC,         -- 완료 후 실제 비용 (usage.cost)
  mime        TEXT,
  data        BYTEA,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
```

- `proposal` 열은 시작할 때 `ALTER TABLE ideas ADD COLUMN IF NOT EXISTS proposal JSONB`로 추가한다(기존 DB 호환)

DB 직접 확인: `psql "$DATABASE_URL"` 또는 `psql -h /var/run/postgresql $(whoami)`

## 작업 규칙

- UI 문구, 주석, 커밋 메시지는 한국어로 작성합니다.
- API 응답 형식은 `{ id, title, target, idea, createdAt, proposal, image }`(camelCase)입니다. DB 컬럼은 snake_case이고 `server/index.js`의 `toIdea`에서 변환합니다. `image`가 필요하므로 카드를 돌려줄 때는 `IDEA_SELECT`/`findIdea`(이미지 JOIN)로 읽습니다.
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
