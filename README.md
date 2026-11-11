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

### Vercel(프론트) + Render(API)

YouTube 추출은 yt-dlp 바이너리와 수십 초짜리 요청이 필요해 Vercel 함수에는 맞지 않습니다. 나눠서 배포할 때:

1. Render에 위 Docker 서비스를 올리고 `CORS_ORIGIN=https://<vercel 도메인>` 설정
2. Vercel에 이 저장소를 연결하고 환경 변수 `VITE_API_BASE=https://<render 도메인>` 설정 (`vercel.json` 포함)

### 서버 환경 변수

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | 8787 | |
| `MAX_DURATION_SEC` | 1200 | 이보다 긴 영상은 거부 |
| `MAX_CONCURRENT` | 2 | 동시 추출 수 |
| `CORS_ORIGIN` | — | 프론트를 다른 도메인에 둘 때 |
| `YTDLP_PATH` | `yt-dlp` | |
| `YTDLP_COOKIES` | — | Netscape 형식 쿠키 파일 경로 |
| `YTDLP_ARGS` | — | yt-dlp 추가 인자 |

## 알아둘 점

- 클라우드 서버 IP는 YouTube가 봇으로 판단해 막는 경우가 잦습니다("Sign in to confirm you're not a bot").
  그럴 땐 `YTDLP_COOKIES`로 쿠키를 넘기거나, 파일 업로드를 쓰세요. yt-dlp는 자주 업데이트해야 합니다(이미지 재빌드).
- 권리가 있는 음원만 사용하세요. YouTube 콘텐츠 다운로드는 YouTube 약관과 저작권의 제약을 받습니다.
- 박 검출은 리듬이 뚜렷한 음악에서 가장 정확합니다. 루바토가 심한 곡은 구간 BPM이 여러 개로 나뉘거나 그리드가 어긋날 수 있습니다.
- 작업 내용은 브라우저 메모리에만 있습니다(새로고침 시 사라짐, 페이지를 닫을 때 경고).

## 구조

```
server/index.mjs          Express: /api/youtube (yt-dlp), 정적 파일
src/audio/analysisCore.ts 온셋 → 템포(자기상관) → DP 비트 트래킹 → 구간 분할
src/audio/engine.ts       Web Audio 재생 스케줄링, 페이드 엔벨로프, 루프
src/audio/export.ts       OfflineAudioContext 렌더 + WAV 인코딩
src/state/                스토어(zustand), 편집 연산, 명령
src/ui/arrangementView.ts 캔버스 타임라인 (그리기, 히트 테스트, 드래그, 스냅)
```
