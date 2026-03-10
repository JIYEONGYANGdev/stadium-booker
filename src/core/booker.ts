import type { Browser, BrowserContext, Page } from 'playwright';
import type { AppConfig, Reservation, TimeSlot } from '../config/schema.js';
import { getSiteAdapter } from '../sites/index.js';
import type { SiteAdapter } from '../sites/base-site.js';
import { solveCaptcha } from '../captcha/solver.js';
import { sendNotification } from '../notification/notifier.js';
import { withRetry } from './retry.js';
import {
  launchBrowser,
  createContext,
  saveScreenshot,
  saveSessionCookies,
  loadSessionCookies,
} from '../utils/browser.js';
import { waitUntil, getNextOpenTime, formatDateTime } from '../utils/time.js';
import { logger } from '../utils/logger.js';
import { uploadScreenshot } from '../utils/image-upload.js';
import { recordSuccess, getMonthlySuccessCount } from '../history/store.js';

export interface BookingResult {
  success: boolean;
  reservation: string;
  slot?: TimeSlot;
  message: string;
  timestamp: Date;
  stage?: string;
  screenshot?: string;
}

export class Booker {
  private config: AppConfig;
  private dryRun: boolean;

  constructor(config: AppConfig, dryRun: boolean = false) {
    this.config = config;
    this.dryRun = dryRun;
  }

  async executeReservation(reservationName: string): Promise<BookingResult> {
    const reservation = this.config.reservations.find(r => r.name === reservationName);
    if (!reservation) {
      throw new Error(`예약 "${reservationName}"을 찾을 수 없습니다.`);
    }

    const credentials = this.config.credentials[reservation.site];
    if (!credentials) {
      throw new Error(`사이트 "${reservation.site}"의 로그인 정보가 없습니다.`);
    }

    const site = getSiteAdapter(reservation.site);
    let browser: Browser | undefined;

    let lastStage = 'init';
    let lastScreenshot: string | undefined;

    try {
      browser = await launchBrowser(this.config.browser);
      const context = await createContext(browser, this.config.browser);

      // 세션 쿠키 로드 시도
      await loadSessionCookies(context, site.name);

      const page = await context.newPage();

      // 로그인
      lastStage = 'login';
      const loggedIn = await site.isLoggedIn(page).catch(() => false);
      if (!loggedIn) {
        await withRetry(
          () => site.login(page, credentials),
          { maxAttempts: 2, delayMs: 1000 },
        );
        await saveSessionCookies(context, site.name);
      } else {
        logger.info('기존 세션으로 로그인 유지됨');
      }

      // 예약 시도
      const result = await this.tryBookSlots(page, context, site, reservation, (stage, screenshot) => {
        lastStage = stage;
        if (screenshot) lastScreenshot = screenshot;
      });

      // 알림 발송
      await this.notify(result);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      try {
        if (!lastScreenshot && browser) {
          const page = await (await browser.newContext()).newPage();
          lastScreenshot = await saveScreenshot(page, 'booking-failure');
        }
      } catch {
        // ignore
      }
      const result: BookingResult = {
        success: false,
        reservation: reservationName,
        message: `예약 실패: ${errorMessage}`,
        timestamp: new Date(),
        stage: lastStage,
        screenshot: lastScreenshot,
      };

      await this.notify(result);
      return result;
    } finally {
      await browser?.close();
    }
  }

  async executeWithWait(reservationName: string): Promise<BookingResult> {
    const reservation = this.config.reservations.find(r => r.name === reservationName);
    if (!reservation) {
      throw new Error(`예약 "${reservationName}"을 찾을 수 없습니다.`);
    }

    const { open_schedule } = reservation;
    const openTime = getNextOpenTime(
      open_schedule.type,
      open_schedule.time,
      open_schedule.day,
      open_schedule.day_of_week,
    );

    logger.info(`예약 오픈 시간: ${formatDateTime(openTime)}`);

    const preloginMinutes = reservation.prelogin_minutes ?? 5;
    if (preloginMinutes > 0) {
      const preloginTime = new Date(openTime.getTime() - preloginMinutes * 60_000);
      logger.info(`사전 로그인 시간: ${formatDateTime(preloginTime)}`);
      await waitUntil(preloginTime);
      await this.prelogin(reservation);
    }

    // 오픈 시간까지 대기
    await waitUntil(openTime);

    // 즉시 예약 실행
    return this.executeReservation(reservationName);
  }

  private async tryBookSlots(
    page: Page,
    context: BrowserContext,
    site: SiteAdapter,
    reservation: Reservation,
    onStage?: (stage: string, screenshot?: string) => void,
  ): Promise<BookingResult> {
    const retryConfig = reservation.retry ?? { max_attempts: 3, delay_ms: 500 };

    return withRetry(
      async (attempt) => {
        logger.info(`예약 시도 ${attempt}: ${reservation.name}`);

        // 예약 페이지 이동
        onStage?.('navigate');
        await site.navigateToReservation(page, {
          facility: reservation.facility,
          court: reservation.court,
          date: reservation.target_date,
        });

        // 약관 동의
        onStage?.('accept_terms');
        await site.acceptTerms(page);

        if (reservation.multi_slot) {
          logger.info('다중 시간대 선택 모드');

          onStage?.('select_slots');
          const selected = await site.selectSlots(page, reservation.preferred_slots);
          if (!selected) {
            throw new Error('다중 시간대 선택 실패');
          }

          if (reservation.form) {
            onStage?.('fill_form');
            await site.fillReservationForm(page, reservation.form);
          }

          const captchaSelector = await site.getCaptchaSelector(page);
          if (captchaSelector) {
            onStage?.('captcha');
            await this.solveCaptchaWithRetry(page, site, captchaSelector);
          }

          if (this.dryRun) {
            logger.info('[DRY RUN] 예약 실행을 건너뜁니다.');
            const shot = await saveScreenshot(page, 'dry-run');
            onStage?.('dry_run', shot);
            return {
              success: true,
              reservation: reservation.name,
              slot: reservation.preferred_slots[0],
              message: `[DRY RUN] 시간대 선택 성공: ${reservation.preferred_slots.map(s => s.time).join(', ')}`,
              timestamp: new Date(),
              stage: 'dry_run',
              screenshot: shot,
            };
          }

          const added = await site.addToCart(page);
          if (added) {
            const shot = await saveScreenshot(page, 'booking-success');
            await saveSessionCookies(context, site.name);

            recordSuccess({
              reservation: reservation.name,
              site: reservation.site,
              facility: reservation.facility,
              court: reservation.court,
              slot_time: reservation.preferred_slots.map(s => s.time).join(', '),
              timestamp: new Date().toISOString(),
            });

            return {
              success: true,
              reservation: reservation.name,
              slot: reservation.preferred_slots[0],
              message: `예약 성공! ${reservation.facility} ${reservation.court} - ${reservation.preferred_slots.map(s => s.time).join(', ')}`,
              timestamp: new Date(),
              stage: 'add_to_cart',
              screenshot: shot,
            };
          }
        } else {
          // 우선순위 순서로 슬롯 시도
          for (const preferredSlot of reservation.preferred_slots) {
            logger.info(`슬롯 시도: ${preferredSlot.day} ${preferredSlot.time}`);

            onStage?.('select_slot');
            const selected = await site.selectSlot(page, preferredSlot);
            if (!selected) {
              logger.info(`슬롯 불가: ${preferredSlot.time}, 다음 슬롯 시도...`);
              continue;
            }

            // 폼 입력
            if (reservation.form) {
              onStage?.('fill_form');
              await site.fillReservationForm(page, reservation.form);
            }

            // CAPTCHA 처리
            const captchaSelector = await site.getCaptchaSelector(page);
            let captchaAnswer = '';
            if (captchaSelector) {
              onStage?.('captcha');
              captchaAnswer = await this.solveCaptchaWithRetry(page, site, captchaSelector);
            }

            if (this.dryRun) {
              logger.info('[DRY RUN] 예약 실행을 건너뜁니다.');
              const shot = await saveScreenshot(page, 'dry-run');
              return {
                success: true,
                reservation: reservation.name,
                slot: preferredSlot,
                message: `[DRY RUN] ${preferredSlot.day} ${preferredSlot.time}\nCAPTCHA 인식: "${captchaAnswer}"`,
                timestamp: new Date(),
                stage: 'dry_run',
                screenshot: shot,
              };
            }

            // 예약바구니 담기
            onStage?.('add_to_cart');
            const added = await site.addToCart(page);
            if (added) {
              const shot = await saveScreenshot(page, 'booking-success');
              await saveSessionCookies(context, site.name);

              recordSuccess({
                reservation: reservation.name,
                site: reservation.site,
                facility: reservation.facility,
                court: reservation.court,
                slot_time: preferredSlot.time,
                timestamp: new Date().toISOString(),
              });

              return {
                success: true,
                reservation: reservation.name,
                slot: preferredSlot,
                message: `예약 성공! ${reservation.facility} ${reservation.court} - ${preferredSlot.day} ${preferredSlot.time}`,
                timestamp: new Date(),
                stage: 'add_to_cart',
                screenshot: shot,
              };
            }
          }

          throw new Error('모든 선호 시간대가 불가합니다.');
        }

        throw new Error('예약바구니 담기 실패');
      },
      {
        maxAttempts: retryConfig.max_attempts,
        delayMs: retryConfig.delay_ms,
      },
    );
  }

  private async notify(result: BookingResult): Promise<void> {
    const kakaoConfig = this.config.notification?.kakao;
    if (!kakaoConfig?.enabled) return;

    if (result.success && kakaoConfig.on_success) {
      const monthlyCount = getMonthlySuccessCount(result.timestamp);
      const mention = process.env['KAKAO_MENTION_ID'] ? `@${process.env['KAKAO_MENTION_ID']} ` : '';
      await sendNotification(
        `${mention}결제대기중입니다. 마이페이지 이동하여 결제하기\n\n${result.message}\n\n이번달 예약 성공: ${monthlyCount}건\n\n⏰ ${formatDateTime(result.timestamp)}`,
        kakaoConfig.mypage_url,
      );
    } else if (!result.success && kakaoConfig.on_failure) {
      let screenshotInfo: string | undefined;
      if (result.screenshot) {
        const imgurUrl = await uploadScreenshot(result.screenshot);
        screenshotInfo = imgurUrl
          ? `스크린샷: ${imgurUrl}`
          : `스크린샷: ${result.screenshot}`;
      }
      const details = [
        result.stage ? `단계: ${result.stage}` : undefined,
        screenshotInfo,
      ].filter(Boolean).join('\n');
      await sendNotification(
        `❌ 예약 실패\n\n${result.message}\n${details ? `\n${details}\n` : '\n'}⏰ ${formatDateTime(result.timestamp)}`,
        kakaoConfig.mypage_url,
      );
    }
  }

  private async prelogin(reservation: Reservation): Promise<void> {
    const credentials = this.config.credentials[reservation.site];
    if (!credentials) return;
    const site = getSiteAdapter(reservation.site);
    let browser: Browser | undefined;

    try {
      browser = await launchBrowser(this.config.browser);
      const context = await createContext(browser, this.config.browser);
      const page = await context.newPage();

      await site.login(page, credentials);
      await saveSessionCookies(context, site.name);
      logger.info('사전 로그인 완료');
    } catch (error) {
      logger.warn(`사전 로그인 실패: ${error instanceof Error ? error.message : error}`);
    } finally {
      await browser?.close();
    }
  }

  private async solveCaptchaWithRetry(
    page: Page,
    site: SiteAdapter,
    captchaSelector: string,
  ): Promise<string> {
    const attempts = 5;
    for (let i = 1; i <= attempts; i++) {
      try {
        const answer = await solveCaptcha(page, captchaSelector, this.config.captcha);
        await site.submitCaptcha(page, answer);
        return answer;
      } catch (error) {
        logger.warn(`CAPTCHA 처리 실패 (시도 ${i}/${attempts}): ${error instanceof Error ? error.message : error}`);
        if (i < attempts && site.refreshCaptcha) {
          await site.refreshCaptcha(page);
        }
      }
    }
    throw new Error('CAPTCHA 처리 실패');
    return ''; // unreachable
  }
}
