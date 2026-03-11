# Stadium Booker - Claude Code 프로젝트 설정

## 빠른 명령어

아래와 같은 자연어 입력이 들어오면 해당 CLI를 실행해주세요:

| 입력 패턴 | 실행 명령어 |
|-----------|------------|
| "예약 실행", "고덕 예약", "예약 자동화 실행", "스케줄 실행", "풋살 예약" | `caffeinate -i npx tsx src/index.ts schedule -r "양주 풋살"` |
| "예약 테스트", "드라이런", "dry run", "테스트 실행" | `npx tsx src/index.ts book -r "양주 풋살" --dry-run` |
| "즉시 예약", "바로 예약" | `npx tsx src/index.ts book -r "양주 풋살"` |
| "카카오 토큰 초기화", "토큰 재발급" | `npx tsx src/index.ts tokens kakao-init` |
| "토큰 상태", "토큰 확인" | `npx tsx src/index.ts tokens kakao-status` |
| "설정 확인", "config 확인" | config/config.yaml 내용을 보여주기 |

## 프로젝트 구조

- `config/config.yaml` - 예약 설정 (대상, 시간대, 스케줄)
- `src/core/booker.ts` - 예약 실행 핵심 로직
- `src/notification/kakao.ts` - 카카오톡 알림 + 톡캘린더
- `src/notification/gmail.ts` - Gmail 알림
- `src/captcha/solver.ts` - CAPTCHA 처리 (OpenAI Vision → Tesseract → 원격입력)

## 실행 환경

- Node.js 20+, TypeScript (tsx)
- `.env` 파일에 카카오/Google OAuth/OpenAI 키 설정 필요
