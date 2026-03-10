import type { Page } from 'playwright';
import type { CaptchaConfig } from '../config/schema.js';
import { recognizeWithTesseract, TesseractLowConfidenceError } from './tesseract.js';
import { recognizeWithOpenAI } from './openai-vision.js';
import { saveScreenshot } from '../utils/browser.js';
import { logger } from '../utils/logger.js';
import { requestRemoteCaptchaInput } from './remote-input.js';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const DEFAULT_CAPTCHA_CONFIG: CaptchaConfig = {
  primary: 'openai-vision',
  fallback: 'tesseract',
  tesseract: {
    lang: 'eng',
    confidence_threshold: 70,
  },
  manual_fallback: true,
};

export async function solveCaptcha(
  page: Page,
  captchaSelector: string,
  config?: CaptchaConfig,
): Promise<string> {
  const cfg = { ...DEFAULT_CAPTCHA_CONFIG, ...config };

  logger.info('CAPTCHA 이미지 캡처 중...');
  await saveScreenshot(page, 'captcha');

  // DOM에 이미 렌더된 이미지를 canvas로 추출 (재요청 없이 원본 그대로)
  let imageBuffer: Buffer;
  try {
    const base64 = await page.locator(captchaSelector).evaluate((el) => {
      const img = el as unknown as { naturalWidth: number; naturalHeight: number };
      const canvas = Object.assign(el.ownerDocument.createElement('canvas'), {
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
      const ctx = canvas.getContext('2d')!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx.drawImage(el as any, 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    imageBuffer = Buffer.from(base64, 'base64');
    logger.info(`CAPTCHA 이미지 추출 완료 (${imageBuffer.length} bytes)`);
  } catch (err) {
    logger.warn('Canvas 추출 실패, 스크린샷 폴백');
    imageBuffer = await page.locator(captchaSelector).screenshot();
  }

  // 1차: Primary 엔진
  try {
    const result = await recognize(imageBuffer, cfg.primary, cfg);
    logger.info(`CAPTCHA 해결 (${cfg.primary}): "${result}"`);
    return result;
  } catch (error) {
    if (error instanceof TesseractLowConfidenceError) {
      logger.warn(`${cfg.primary} 실패: ${error.message}`);
    } else {
      logger.error(`${cfg.primary} 오류:`, error);
    }
  }

  // 2차: Fallback 엔진
  if (cfg.fallback) {
    logger.info(`폴백 엔진 (${cfg.fallback}) 시도...`);
    try {
      const result = await recognize(imageBuffer, cfg.fallback, cfg);
      logger.info(`CAPTCHA 해결 (${cfg.fallback}): "${result}"`);
      return result;
    } catch (error) {
      logger.error(`${cfg.fallback} 오류:`, error);
    }
  }

  // 3차: 원격 웹 폼 입력
  if (cfg.remote_fallback?.enabled) {
    logger.info('원격 CAPTCHA 입력 시도...');
    const remote = await requestRemoteCaptchaInput(imageBuffer, cfg.remote_fallback);
    if (remote) {
      logger.info(`원격 CAPTCHA 입력 사용: "${remote}"`);
      return remote;
    }
  }

  // 4차: TTY 수동 입력
  if (cfg.manual_fallback !== false) {
    const manual = await promptManualCaptcha();
    if (manual) {
      logger.info('수동 CAPTCHA 입력 사용');
      return manual;
    }
  }

  throw new Error('CAPTCHA 해결 실패: 모든 엔진에서 실패했습니다.');
}

async function recognize(
  imageBuffer: Buffer,
  engine: 'tesseract' | 'openai-vision',
  config: CaptchaConfig,
): Promise<string> {
  switch (engine) {
    case 'tesseract': {
      const result = await recognizeWithTesseract(
        imageBuffer,
        config.tesseract?.lang ?? 'eng',
        config.tesseract?.confidence_threshold ?? 70,
      );
      return result.text;
    }
    case 'openai-vision': {
      return recognizeWithOpenAI(imageBuffer);
    }
  }
}

export async function solveCaptchaFromBuffer(
  imageBuffer: Buffer,
  config?: CaptchaConfig,
): Promise<string> {
  const cfg = { ...DEFAULT_CAPTCHA_CONFIG, ...config };

  try {
    return await recognize(imageBuffer, cfg.primary, cfg);
  } catch {
    if (cfg.fallback) {
      try {
        return await recognize(imageBuffer, cfg.fallback, cfg);
      } catch {
        // ignore
      }
    }
    // 3차: 원격 웹 폼 입력
    if (cfg.remote_fallback?.enabled) {
      const remote = await requestRemoteCaptchaInput(imageBuffer, cfg.remote_fallback);
      if (remote) return remote;
    }
    // 4차: TTY 수동 입력
    if (cfg.manual_fallback !== false) {
      const manual = await promptManualCaptcha();
      if (manual) return manual;
    }
    throw new Error('CAPTCHA 해결 실패');
  }
}

async function promptManualCaptcha(): Promise<string | null> {
  if (!process.stdin.isTTY) return null;

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question('CAPTCHA 수동 입력: ');
    const cleaned = answer.trim().replace(/\s/g, '');
    return cleaned.length > 0 ? cleaned : null;
  } finally {
    rl.close();
  }
}
