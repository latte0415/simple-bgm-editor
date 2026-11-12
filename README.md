# BGM Editor

유튜브 링크나 오디오 파일을 불러와 **박자 단위로 자르고 잇는** 브라우저용 음악 편집기.
에이블톤 라이브의 어레인지먼트 뷰를 참고했습니다.

## 기능

- **불러오기**: YouTube 링크 붙여넣기(서버에서 yt-dlp로 오디오 추출) 또는 파일 업로드/드래그. 최대 5 트랙.
- **템포 분석**: 브라우저 Web Worker에서 구간별 BPM과 박 위치를 계산. 템포가 바뀌는 곡은 구간이 나뉨.
  잘못 잡혔을 때는 인스펙터에서 `×2`, `÷2`, `첫 박 +1`로 보정.
- **박자 그리드 스냅**: 확대할수록 1 마디 → 1/4 → 1/8 → 1/16 → 1/32로 촘촘해짐 (그리드를 직접 고정할 수도 있음).
- **편집**: 분할, 지우기, 잘라내고 잇기(구간 삭제 후 뒤를 당김), 복제, 트림, 트랙 간 이동, 실행 취소.
- **페이드 / 크로스페이드**: 클립 모서리 핸들로 페이드 인·아웃. 같은 트랙에서 클립이 겹치면 자동 equal-power 크로스페이드.
  `잘라내고 잇기`는 `이음 페이드` 길이(기본 1박)만큼 뒤쪽 클립을 겹쳐 박자를 맞춘 채 자연스럽게 이어 붙임.
- **내보내기**: 전체 믹스를 WAV(44.1 kHz, 16-bit)로 렌더링. 합쳐서 클리핑되면 전체 레벨만 낮춤.

## 조작

| 동작 | 방법 |
| --- | --- |
| 클립 이동 | 클립 상단 바 드래그 (다른 클립의 박에 자석처럼 붙음) |
| 구간 선택 | 클립 본문 / 빈 레인 드래그 (여러 트랙 걸쳐 가능) |
| 트림 | 클립 좌우 가장자리 드래그 |
| 페이드 | 선택한 클립 상단 모서리의 □ 핸들 드래그 |
| 스냅 일시 해제 | 드래그 중 ⌥ / Alt |
| 확대 / 스크롤 | ⌘ / Ctrl + 휠(핀치), 휠·트랙패드 |

| 단축키 | |
| --- | --- |
| Space / ⇧Space | 재생·정지 / 멈춘 곳부터 |
| ⌘E 또는 S | 분할 |
| ⌫ / ⇧⌫ | 지우기 / 잘라내고 잇기 |
| ⌘D | 복제 |
| ⌘L 또는 L | 선택 구간 루프 |
| ⌘Z / ⌘⇧Z | 실행 취소 / 다시 실행 |
| + / − / Z | 확대 / 축소 / 선택 구간(없으면 전체) 맞춤 |

## 로컬 실행

필요: Node 20+, [yt-dlp](https://github.com/yt-dlp/yt-dlp) (YouTube 추출용, PATH에 있어야 함)

```bash
npm install
npm run dev        # http://localhost:5173 (API는 :8787, Vite가 /api 프록시)
```

프로덕션 모드:

```bash
npm run build
npm start          # dist + /api 를 :8787 에서 함께 서빙
```

## 배포

### Render (권장 — 앱과 API를 한 서비스로)

저장소를 Render에 연결하면 `render.yaml`과 `Dockerfile`로 바로 배포됩니다.
이미지에 Node, yt-dlp(최신 릴리스), ffmpeg가 포함됩니다.

배포 후 Render → Environment에서 `APP_PASSWORD`(입장 비밀번호)를 입력하세요.
YouTube가 서버를 봇으로 막으면 아래 [YouTube 쿠키 설정](#youtube-쿠키-설정)을 따르세요.

### Vercel(프론트) + Render(API)

YouTube 추출은 yt-dlp 바이너리와 수십 초짜리 요청이 필요해 Vercel 함수에는 맞지 않습니다. 나눠서 배포할 때:

1. Render에 위 Docker 서비스를 올리고 `CORS_ORIGIN=https://<vercel 도메인>` 설정
2. Vercel에 이 저장소를 연결하고 환경 변수 `VITE_API_BASE=https://<render 도메인>` 설정 (`vercel.json` 포함)

이 경우 로그인 쿠키는 `SameSite=None; Secure`로 발급되고, 서드파티 쿠키를 막는 브라우저(Safari 등)를 위해
로그인 응답의 토큰을 브라우저에 저장해 `Authorization` 헤더로도 보냅니다.

### 입장 비밀번호

`APP_PASSWORD`를 설정하면 처음 접속할 때 비밀번호 화면이 뜹니다. 동아리원끼리 같은 비밀번호를 공유하는 방식입니다.

- 맞게 입력하면 30일짜리 로그인 쿠키(HttpOnly)가 발급됩니다. 비밀번호를 바꾸면 기존 로그인은 모두 풀립니다.
- 서버의 `/api/*`(YouTube 추출)는 로그인 없이는 401을 돌려줍니다. 정적 파일(JS/CSS) 자체는 공개지만 화면은 잠겨 있습니다.
- 같은 IP에서 15분 안에 8번 틀리면 15분간 막힙니다.
- 비워 두면 비밀번호 없이 열립니다(로컬 개발 기본값).

### YouTube 쿠키 설정

Render 같은 클라우드 서버 IP는 YouTube가 봇으로 보고 막는 경우가 많습니다
(로그에 `Sign in to confirm you're not a bot`). 로그인된 YouTube 쿠키를 서버에 넘기면 대개 풀립니다.

1. **버릴 용도의 Google 계정**을 하나 만드세요. 개인 계정은 쓰지 마세요(차단될 수 있음).
2. 브라우저의 시크릿(비공개) 창을 열고 그 계정으로 YouTube에 로그인합니다.
3. 같은 창에서 `https://www.youtube.com/robots.txt`로 이동한 뒤, 쿠키 내보내기 확장 프로그램으로
   `youtube.com` 쿠키를 Netscape 형식 `cookies.txt`로 저장합니다
   ([yt-dlp 위키: Exporting YouTube cookies](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies)).
4. **바로 시크릿 창을 닫습니다.** 창을 열어 두면 YouTube가 쿠키를 갱신해 내보낸 쿠키가 무효가 됩니다.
5. Render → 서비스 → Environment → **Secret Files**에 파일 이름 `cookies.txt`로 내용을 붙여 넣고 저장합니다.
6. 재배포(Manual Deploy)합니다. 로그에 `[cookies] YouTube 쿠키 사용: secret file …`이 보이면 적용된 것입니다.

알아둘 점:

- 쿠키는 몇 주~몇 달이면 만료됩니다. 쿠키를 설정했는데도 다시 막히면(앱에 "쿠키가 만료되었을 수 있습니다" 표시) 1–6을 다시 하세요.
- 이 계정이 YouTube에 의해 제한되거나 정지될 수 있습니다. 그래서 버리는 계정을 씁니다.
- 쿠키 파일은 비밀번호와 같습니다. 저장소에 커밋하지 마세요(`.gitignore`, `.dockerignore`에 `cookies.txt` 포함).
- Secret File을 쓸 수 없는 호스트에서는 `YTDLP_COOKIES_B64`에 파일을 base64로 넣으세요:
  `base64 -i cookies.txt | tr -d '\n'`.
- 서버는 시작할 때 쿠키를 읽어 두고, 추출할 때마다 쓰기 가능한 임시 사본(권한 600)을 만들어 yt-dlp에 넘깁니다.
  (yt-dlp가 종료 시 쿠키 파일을 다시 쓰는데 Secret File은 읽기 전용이고, 동시 추출끼리 같은 파일을 쓰면 꼬이기 때문)

### 서버 환경 변수

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | 8787 | |
| `MAX_DURATION_SEC` | 1200 | 이보다 긴 영상은 거부 |
| `MAX_CONCURRENT` | 2 | 동시 추출 수 |
| `CORS_ORIGIN` | — | 프론트를 다른 도메인에 둘 때 |
| `APP_PASSWORD` | — | 입장 비밀번호. 비우면 잠금 없음 |
| `SESSION_SECRET` | — | 로그인 토큰 서명에 섞는 추가 비밀값(선택). 바꾸면 전원 로그아웃 |
| `YTDLP_PATH` | `yt-dlp` | |
| `YTDLP_COOKIES` | — | Netscape 형식 쿠키 파일 경로 |
| `YTDLP_COOKIES_B64` | — | 쿠키 파일 내용을 base64로 (Secret File이 없는 호스트용) |
| (Secret File) | `/etc/secrets/cookies.txt` | 있으면 자동 사용. 우선순위: `YTDLP_COOKIES` → `YTDLP_COOKIES_B64` → Secret File |
| `YTDLP_ARGS` | — | yt-dlp 추가 인자 |

## 알아둘 점

- 클라우드 서버 IP는 YouTube가 봇으로 판단해 막는 경우가 잦습니다("Sign in to confirm you're not a bot").
  그럴 땐 [YouTube 쿠키 설정](#youtube-쿠키-설정)을 하거나, 파일 업로드를 쓰세요. yt-dlp는 자주 업데이트해야 합니다(이미지 재빌드).
- 권리가 있는 음원만 사용하세요. YouTube 콘텐츠 다운로드는 YouTube 약관과 저작권의 제약을 받습니다.
- 박 검출은 리듬이 뚜렷한 음악에서 가장 정확합니다. 루바토가 심한 곡은 구간 BPM이 여러 개로 나뉘거나 그리드가 어긋날 수 있습니다.
- 작업 내용은 브라우저 메모리에만 있습니다(새로고침 시 사라짐, 페이지를 닫을 때 경고).

## 구조

```
server/index.mjs          Express: /api/youtube (yt-dlp), 정적 파일
server/auth.mjs           입장 비밀번호: /api/login·session·logout, 세션 토큰, 시도 제한
server/ytCookies.mjs      YouTube 쿠키 로드 + 요청별 임시 사본
src/audio/analysisCore.ts 온셋 → 템포(자기상관) → DP 비트 트래킹 → 구간 분할
src/audio/engine.ts       Web Audio 재생 스케줄링, 페이드 엔벨로프, 루프
src/audio/export.ts       OfflineAudioContext 렌더 + WAV 인코딩
src/state/                스토어(zustand), 편집 연산, 명령
src/ui/arrangementView.ts 캔버스 타임라인 (그리기, 히트 테스트, 드래그, 스냅)
```
