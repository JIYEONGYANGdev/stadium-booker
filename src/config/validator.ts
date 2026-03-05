import type { AppConfig } from './schema.js';

export function validateConfig(config: AppConfig): void {
  for (const reservation of config.reservations) {
    if (!config.credentials[reservation.site]) {
      throw new Error(
        `예약 "${reservation.name}"의 사이트 "${reservation.site}"에 대한 로그인 정보가 없습니다. ` +
        `credentials에 "${reservation.site}" 항목을 추가하세요.`
      );
    }

    const { open_schedule } = reservation;
    if (open_schedule.type === 'monthly' && open_schedule.day === undefined) {
      throw new Error(
        `예약 "${reservation.name}": monthly 스케줄에는 day(1-31)가 필요합니다.`
      );
    }
    if (open_schedule.type === 'weekly' && open_schedule.day_of_week === undefined) {
      throw new Error(
        `예약 "${reservation.name}": weekly 스케줄에는 day_of_week가 필요합니다.`
      );
    }
  }

  if (config.captcha?.fallback && config.captcha.fallback === config.captcha.primary) {
    throw new Error('CAPTCHA primary와 fallback이 동일합니다. 서로 다른 엔진을 선택하세요.');
  }

  const kakao = config.notification?.kakao;
  if (kakao?.enabled) {
    if (!process.env['KAKAO_REST_API_KEY']) {
      console.warn('⚠️  카카오 알림을 사용하려면 KAKAO_REST_API_KEY 환경변수가 필요합니다.');
    }
    if (!process.env['KAKAO_ACCESS_TOKEN'] && !process.env['KAKAO_REFRESH_TOKEN']) {
      console.warn('⚠️  카카오 알림을 사용하려면 KAKAO_ACCESS_TOKEN 또는 KAKAO_REFRESH_TOKEN이 필요합니다.');
    }
    if (!kakao.mypage_url) {
      console.warn('⚠️  카카오 알림 링크를 위해 notification.kakao.mypage_url 설정을 권장합니다.');
    }
  }
}
