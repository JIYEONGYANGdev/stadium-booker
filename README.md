# Stadium Booker

공공체육시설(축구/풋살) 구장 예약 자동화 CLI 도구.

예약 오픈 시간에 자동으로 로그인 → CAPTCHA 입력 → 시간대 선택 → 예약바구니 담기까지 처리하고, 카카오톡으로 알림을 보냅니다.
오픈 시간 전 사전 로그인을 통해 세션을 미리 확보합니다.

## 빠른 시작

```bash
# 1. 의존성 설치
npm install
npx playwright install chromium

# 2. 대화형 설정 생성
npx tsx src/index.ts config init

# 3. .env 파일에 API 키 입력
# config/.env.example 참고

# 4. 로그인 테스트
npx tsx src/index.ts test login --site yangju

# 5. 예약 실행 (드라이런)
npx tsx src/index.ts book --reservation "주말 풋살" --dry-run

# 6. 스케줄러 시작
npx tsx src/index.ts schedule

# 빠른 실행 (설정 파일 기준)
npm run reserve -- --reservation "양주 풋살"

# 카카오 토큰 상태 확인
npx tsx src/index.ts tokens kakao

# 카카오 토큰 발급/저장
npx tsx src/index.ts tokens kakao-init
```

## CLI 명령어

```bash
# 즉시 예약 실행
stadium-booker book --config ./config/config.yaml --reservation "주말 풋살"
stadium-booker book --reservation "주말 풋살" --dry-run   # 테스트

# 스케줄러 시작
stadium-booker schedule                                    # 전체
stadium-booker schedule --reservation "주말 풋살"           # 특정 예약만

# 기능 테스트
stadium-booker test login --site yangju
stadium-booker test login --site yangju --no-headless       # 브라우저 표시
stadium-booker test captcha --site yangju
stadium-booker test captcha --file ./sample-captcha.png
stadium-booker test notify --message "테스트 알림"

# 설정 관리
stadium-booker config init                                 # 대화형 설정 생성
stadium-booker config validate                             # 설정 검증
stadium-booker config sites                                # 지원 사이트 목록

# 히스토리
stadium-booker history
stadium-booker history --last 20
```

## 설정

### 설정 파일 (config/config.yaml)

`config/config.example.yaml`을 참고하여 `config/config.yaml`을 만드세요.

### 환경변수 (.env)

```bash
# 사이트 로그인
YANGJU_ID=your_id
YANGJU_PW=your_password

# 카카오 API (알림)
KAKAO_REST_API_KEY=your_key
KAKAO_ACCESS_TOKEN=your_token
KAKAO_REFRESH_TOKEN=your_refresh_token
KAKAO_MYPAGE_URL=https://reserve.yjuc.or.kr/main/mypage
KAKAO_REDIRECT_URI=https://jiyeongyangdev.github.io/stadium-booker/
KAKAO_CLIENT_SECRET=   # 클라이언트 시크릿 ON일 때만

# (선택) 자동 갱신 저장 파일
# 토큰은 config/kakao.tokens.json에 자동 저장됩니다. (Git에 올라가지 않음)
```

### 카카오톡 알림 설정

1. [Kakao Developers](https://developers.kakao.com) 로그인
2. 애플리케이션 등록
3. "카카오 로그인" 활성화 → 동의항목에 "카카오톡 메시지 전송" 추가
4. REST API 키 복사 → `.env`에 저장
5. OAuth 인가코드 → Access Token 발급 (최초 1회 브라우저 인증)

## 사이트 어댑터 추가

`src/sites/` 디렉토리에 `SiteAdapter` 인터페이스를 구현하고 `src/sites/index.ts`에 등록하세요.

```typescript
import { BaseSiteAdapter } from './base-site.js';

export class MySiteAdapter extends BaseSiteAdapter {
  name = 'mysite';
  baseUrl = 'https://example.com';

  async login(page, credentials) { /* ... */ }
  async navigateToReservation(page, target) { /* ... */ }
  async getAvailableSlots(page) { /* ... */ }
  async selectSlot(page, slot) { /* ... */ }
  async addToCart(page) { /* ... */ }
}
```

## 스케줄러 + Mac 절전 방지

```bash
caffeinate -i npx tsx src/index.ts schedule
```

## 구조

```
src/
├── index.ts              # CLI 진입점
├── cli/                  # CLI 명령어 + 대화형 설정
├── core/                 # 스케줄러, 예약 오케스트레이터, 재시도
├── sites/                # 사이트 어댑터 (양주 등)
├── captcha/              # CAPTCHA 솔버 (Tesseract)
├── notification/         # 카카오톡 알림
├── config/               # 설정 스키마, 로더, 검증
└── utils/                # 로거, 시간, 브라우저 헬퍼
```
