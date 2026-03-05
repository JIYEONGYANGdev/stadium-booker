import { sendKakaoMessage } from './kakao.js';
import { logger } from '../utils/logger.js';

export async function sendNotification(message: string, linkUrl?: string): Promise<void> {
  logger.info(`알림 발송: ${message.substring(0, 50)}...`);

  try {
    await sendKakaoMessage(message, linkUrl);
  } catch (error) {
    logger.error('카카오톡 알림 발송 실패:', error);
    // 알림 실패는 예약 프로세스를 중단하지 않음
    logger.info('콘솔에서 결과를 확인하세요.');
  }
}
