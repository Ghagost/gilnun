# 길눈 2.0 — 일본 여행 지도 + AI + 실시간 카메라 길안내

구글 지도를 바탕으로, 한국인 여행자가 일본에서 헤매는 순간(복잡한 역, 지하, 여러 층, 일본어 간판, 예약, 막차)을 메우도록 만든 웹앱(PWA)입니다. 휴대폰 홈 화면에 앱처럼 설치해서 씁니다.

## 가장 쉽게 써보기 — 더블클릭 한 번

압축을 풀고 폴더 안의 파일을 **더블클릭**하세요. 개발 지식은 필요 없어요.

| 하고 싶은 것 | Windows | Mac | 결과 |
|---|---|---|---|
| **폰·PC 어디서나 쓰는 주소 만들기 (추천)** | `DEPLOY-Windows.bat` | `DEPLOY-Mac.command` | 2~4분 뒤 `https://….vercel.app` 주소와 QR이 브라우저에 떠요. PC를 꺼도 계속 열려요 |
| **이 PC에서 바로 켜보기** | `START-Windows.bat` | `START-Mac.command` | PC 브라우저에서 길눈이 열리고, 휴대폰용 QR도 같이 떠요 (이 창이 켜져 있는 동안만) |

- 처음 한 번 **Node.js(무료)** 가 필요해요. 없으면 파일이 설치 페이지를 열어 줘요 → **LTS** 버전 설치 → 다시 더블클릭.
- **DEPLOY**는 [Vercel](https://vercel.com)(무료)에 올려요. 1번(구글/GitHub로 로그인 → 계속 쓰는 주소) 또는 2번(로그인 없이 임시 주소 → 나중에 내 계정으로 가져오기)을 고르면 돼요. 다시 실행하면 같은 주소로 업데이트돼요. 주소는 `길눈-주소.txt`에도 적어 둬요.
- **START**는 처음엔 설치·빌드로 2~5분, 다음부터는 몇 초면 켜져요. 휴대폰용 주소는 계정 없이 쓰는 Cloudflare 임시 주소라서 실행할 때마다 바뀌어요.
- 폰에서 주소를 연 다음 Chrome **⋮ → 홈 화면에 추가**를 누르면 앱처럼 써요. 위치·카메라·마이크는 **허용**.
- AI는 앱의 **도구 → 설정**에 Gemini·ChatGPT·Claude 중 하나의 키를 넣으면 돼요 (Gemini 키는 [Google AI Studio](https://aistudio.google.com/apikey)에서 바로 발급).
- 막혔을 때
  - Windows “PC 보호” 창 → **추가 정보 → 실행**.
  - Mac “확인되지 않은 개발자” → 시스템 설정 → 개인정보 보호 및 보안 → **그래도 열기**. 또는 터미널에 `bash ` 를 입력하고 파일을 창에 끌어다 놓은 뒤 Enter.
  - 터미널로 실행해도 똑같아요: `node scripts/try.mjs` (옵션 `--no-phone`, `--rebuild`, `--port 3100`) · `node scripts/deploy.mjs` (`--login`, `--temporary`).
- **PC 없이 폰만 있다면**: 이 폴더가 GitHub 저장소에 올라가 있으면 [vercel.com/new](https://vercel.com/new) → GitHub로 로그인 → 저장소 옆 **Import** → **Deploy**. 폰 브라우저로 다 돼요.

## 무엇이 되나요

| 기능 | 설명 |
|---|---|
| 구글 지도 기반 지도 | 한국어 라벨, 3D·회전, 대중교통·교통 레이어, 내 위치·방향(나침반), 지도 위 장소 탭 → 상세 |
| 주변 찾기 | 역·출구·식당·카페·편의점·관광지·숙소·버스·쇼핑·약국·코인로커·ATM·화장실·렌터카·공항·환전 (영업 중·평점 필터, 거리·도보 시간, 도착 시점 영업 종료 경고) |
| 장소 상세 | 사진, 평점, 영업시간, 결제 수단, 구글 리뷰(원문 보기), 일본어 이름·주소, 전화, 웹사이트 |
| 길찾기 | 일본 열차 실시간 경로(NAVITIME): 노선·방향·승강장·출구·IC/승차권 요금(엔+원)·막차. 도보·자동차 경로, 택시 요금 추정, 구글지도 앱으로 바로 넘기기 |
| AI 길잡이 | ChatGPT · Claude · Gemini 중 선택. AI가 실제 지도 데이터로 장소를 찾아 번호 핀(P1, P2…)으로 꽂고, 길·막차·날씨·일정·예약을 직접 처리. 사진(메뉴판·표지판) 질문 가능 |
| 카메라 길안내 | 카메라로 비추면 AI가 표지판·출구 번호·층 표시를 읽고 화면 기준(왼쪽/오른쪽/계단)으로 안내. 목적지 화살표(나침반), 미니맵, 자동 안내 모드, 손전등 |
| 실시간 카메라 대화 | Gemini Live(영상+음성 실시간), ChatGPT Realtime(음성 실시간+말할 때 화면 전송), Claude(버튼 눌러 말하는 차례 대화) |
| 예약 | 장소별 예약 경로(구글지도 예약, 타베로그, TableCheck, Booking.com, 클룩…)에 날짜·인원 전달, 일본어 전화 예약 대본(+AI 한글 발음), 직원에게 보여주기, 예약함(확인서 사진을 찍으면 AI가 자동 입력), 캘린더(.ics) 내보내기, 시간 임박 알림 |
| 일정 | 날짜별 일정, 동선 정리, 장소 간 도보 시간, AI가 일정 채우기, 링크로 일정 공유·가져오기 |
| 여행 도구 | 회화 카드(크게 보여주기·읽어주기), 음성 통역, 환율 계산기(면세 기준), 날씨, 안전·긴급(110/119/영사콜센터, 지진 경보) |
| 오프라인 | 한 번 열면 앱 화면·일정·예약·회화 카드는 인터넷 없이도 열려요 |

### 구글 지도보다 나아진 점
- AI 답변 속 장소가 지도 핀과 연결되고, 일정·예약에 바로 들어가요 (세 회사 AI 중 선택).
- 지하·실내처럼 GPS가 틀리는 곳에서 카메라로 표지판을 읽어 방향을 알려줘요.
- 택시·직원에게 보여줄 일본어 주소/문장을 한 번에 크게 띄워요.
- 막차 경로, 도착 시각 기준 영업 종료 경고, 엔·원 동시 표시, 일본 평점 보정 안내.
- 흩어진 예약을 사진 한 장으로 모으고, 일본어 전화 예약을 한글 발음과 함께 도와줘요.
- 지진(진도 5약 이상 또는 근처 진도 3 이상) 배너.

## 1. 바로 배포하기 (Vercel)

1. 폴더의 `DEPLOY-Windows.bat` / `DEPLOY-Mac.command`를 더블클릭하거나, 이 폴더를 GitHub 저장소에 올리고 [Vercel](https://vercel.com/new)에서 Import 하세요. (GitHub로 연결하면 push할 때마다 자동 배포돼요.)
2. Framework: Next.js (자동 인식). 빌드 명령은 기본값 그대로.
3. 환경 변수는 **하나도 없어도 열립니다**: 무료 지도(OpenStreetMap) + 사용자가 설정에서 자기 AI 키를 넣는 방식.
4. 구글 지도·서버 AI·열차 경로를 켜려면 아래 환경 변수를 넣고 다시 배포하세요 (`.env.example` 참고).

> 위치·카메라·마이크는 **https 주소에서만** 동작해요. Vercel 주소(https://…vercel.app)는 그대로 됩니다.

## 2. 환경 변수

| 이름 | 필요 | 설명 |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | 권장 | 브라우저용 구글 키. Maps JavaScript API, Places API (New), Routes API 사용 설정 + **HTTP 리퍼러 제한**(배포 주소) |
| `GOOGLE_MAPS_MAP_ID` | 선택 | 지도 ID(JavaScript · 벡터). 없으면 `DEMO_MAP_ID` |
| `GOOGLE_MAPS_SERVER_KEY` | 선택 | 서버용 키(Maps Grounding Lite 전용으로 API 제한). 넣으면 AI 장소 추천이 구글 지도 데이터로 나오고 출처 링크가 붙어요 |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | 선택 | 서버 키. 넣으면 사용자가 키 없이 AI를 써요 → **`ACCESS_CODE`와 함께 쓰세요** |
| `ACCESS_CODE` | 권장(서버 키 사용 시) | 서버 키를 쓰려면 앱 설정에 이 코드를 넣어야 함. 자기 키(BYOK)는 코드 없이 사용 |
| `AI_ALLOWED_MODELS` | 선택 | 서버 키로 허용할 모델 목록(쉼표). 비우면 제한 없음 |
| `OPENAI_REALTIME_MODEL` / `GEMINI_LIVE_MODEL` | 선택 | 실시간 대화 모델 (기본 `gpt-realtime-2.1` / `gemini-3.8-live`) |
| `RAPIDAPI_KEY` | 권장 | RapidAPI의 **NAVITIME Route(totalnavi)** 구독 키 → 일본 열차 시간·요금·승강장·출구 |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 권장(공개 시) | 사용량 제한 저장소 (Vercel KV/Upstash). 없으면 서버 메모리로 대략 제한 |
| `RATE_LIMIT_*`, `AI_MAX_OUTPUT_TOKENS` | 선택 | 서버 키 사용량 제한(기기·IP 기준). 기본값은 `.env.example` |

## 3. Google Cloud 설정 (구글 지도 모드)

1. [Google Cloud 콘솔](https://console.cloud.google.com/)에서 프로젝트를 만들고 **결제 계정 연결** (구글 지도는 결제 계정이 있어야 동작, 월 무료 사용량 있음). **예산 알림**도 꼭 설정하세요.
2. API 사용 설정: **Maps JavaScript API**, **Places API (New)**, **Routes API**. (AI 그라운딩을 쓰면 **Maps Grounding Lite**도.)
3. 사용자 인증 정보 → API 키 만들기
   - 브라우저 키: 애플리케이션 제한 = *웹사이트* → `https://내도메인/*`, `https://*.vercel.app/*`(미리보기용). API 제한 = 위 3개.
   - 서버 키(선택): API 제한 = Maps Grounding Lite만.
4. (선택) 지도 관리 → 지도 ID 만들기 → JavaScript · **벡터** → `GOOGLE_MAPS_MAP_ID`.
5. 앱 → 도구 → **연결 진단**에서 “Google 지도 정상”이 나오면 끝. 키가 틀리면 앱이 자동으로 무료 지도로 바꾸고 진단에 이유를 보여줘요.

> 약관상 구글 장소 데이터는 구글 지도 위에서만 보여줘요. 무료 지도 모드에서는 OpenStreetMap 데이터만 씁니다. 구글 리뷰 요약은 구글이 준 요약만 표시하고, AI가 구글 리뷰를 다시 요약하지 않아요.

## 4. AI 설정

- 설정 → AI에서 기본 AI(ChatGPT/Claude/Gemini), 모델, 내 키를 고를 수 있어요. 내 키는 이 기기에만 저장되고 요청 때 서버를 거쳐 전달만 됩니다(저장 안 함).
- **실시간 카메라 대화**
  - Gemini Live: 서버가 1회용 토큰을 발급(모델·오디오 출력 고정) → 브라우저가 WebSocket으로 직접 연결. 약 10분마다 자동 재연결(세션 이어가기).
  - ChatGPT Realtime: 서버가 임시 키 발급 → WebRTC로 직접 연결. 말을 시작할 때 카메라 화면을 함께 보내요.
  - Claude: 실시간 음성 API가 없어 “눌러서 말하기 → 화면 보고 대답 → 읽어주기” 방식.
  - 비용 보호: 앱을 벗어나 1분, 대화 없이 5분이 지나면 자동 종료. 서버 키는 시간당 세션 수 제한.
- 웹 검색: Claude/ChatGPT는 각 회사의 웹 검색 도구, Gemini는 구글 검색 그라운딩을 써요 (설정에서 끌 수 있음).

## 5. 비용 감 잡기
- 구글 지도: 지도 로드·장소 검색·상세 조회 단위로 과금(월 무료 사용량 있음). 사진 미리보기와 일본어 이름 조회는 필요할 때만 불러오고, **데이터 절약** 설정으로 사진·미니맵을 끌 수 있어요.
- AI: 질문 한 번에 보통 1~3회 호출(도구 사용 시). 카메라 자동 안내는 설정한 간격(기본 10초)보다 자주 묻지 않고, 장면이 바뀌었을 때만 물어요(최대 40회 후 자동 정지).
- 정확한 요금은 각 회사 요금표를 확인하세요: [Google Maps Platform](https://mapsplatform.google.com/pricing/), [OpenAI](https://openai.com/api/pricing/), [Anthropic](https://www.anthropic.com/pricing#api), [Gemini](https://ai.google.dev/gemini-api/docs/pricing).

## 6. 배포 후 직접 확인할 것 (체크리스트)
이 저장소의 자동 테스트는 외부 API를 흉내 낸 가짜 서버로 돌려서, 실제 키로는 아래를 한 번 확인해 주세요. 모두 앱의 **도구 → 연결 진단**에서 눌러볼 수 있어요.
- [ ] 지도: “Google 지도 정상” / 주변 검색: “Google Places · 편의점 N곳”
- [ ] AI 3종: 각 버튼 → “응답: OK”
- [ ] Gemini Live / ChatGPT 실시간: “임시 토큰 발급됨” → 실제로 실시간 대화를 열어 말이 오가는지
- [ ] 열차 경로: “도쿄역→신주쿠역 N개 경로”
- [ ] 휴대폰에서: 위치 정확도, 나침반(카메라 화살표 방향), 카메라·마이크 권한, 홈 화면 설치

## 7. 개발

```bash
npm install
npm run dev          # http://localhost:3000
npm run typecheck
npm test             # 단위 테스트 (Vitest)
npm run e2e          # 빌드 + 종단 간 테스트 (Playwright, 외부 API는 tests/e2e의 가짜 서버로 대체)
npm run shots        # 화면 캡처(휴대폰·다크 모드·폴드 내부 화면) → test-results/shots
```
- 종단 간 테스트는 처음 한 번 `npx playwright install chromium`이 필요해요. 이미 설치된 크롬을 쓰려면 `PW_CHROMIUM=/path/to/chrome`.
- 구조: `app/`(화면·API 라우트) · `lib/server/`(AI 프록시·토큰·사용량 제한·NAVITIME·그라운딩) · `lib/ai/`(3사 어댑터·도구·에이전트) · `lib/live/`(실시간 음성·카메라) · `lib/map/`, `lib/places/`(구글/무료 지도) · `components/`(패널·오버레이) · `scripts/`(더블클릭 실행·배포: `try.mjs`, `deploy.mjs`)
- `START-*`가 쓰는 임시 주소 도구(cloudflared)와 로그는 `.tools/`에 저장돼요 (Git·배포에서 제외).

## 8. 개인정보
- 일정·예약·저장한 곳·대화·설정은 이 기기 브라우저(IndexedDB/localStorage)에만 저장돼요. 백업은 설정 → 데이터에서 내보내기.
- AI에게 물을 때 질문, 현재 위치(좌표), 첨부 사진·카메라 화면이 고른 AI 회사로 전달돼요. 카메라 화면은 버튼을 누르거나 실시간 대화 중일 때만 보내요.

## 9. 알려진 한계
- 구글은 일본 대중교통 경로를 외부 앱 API로 제공하지 않아요 → NAVITIME(유료 API)로 대신하고, 없으면 구글지도 앱으로 넘겨요.
- 예약은 예약 사이트로 날짜·인원을 넘겨 주는 방식이에요. 결제·예약 확정은 각 사이트에서 해요.
- 실내·지하에서는 GPS가 수십 m 틀릴 수 있어요. 카메라 안내는 표지판을 우선하지만 AI가 틀릴 수 있으니 현장 안내를 함께 확인하세요.
- iPhone은 방향 센서를 쓰려면 한 번 허용 버튼을 눌러야 하고, 백그라운드에서는 실시간 대화가 멈출 수 있어요.
- Vercel 서버리스 요청 본문은 4.5MB 제한이 있어요. 사진은 앱이 자동으로 줄여서 보내요.
