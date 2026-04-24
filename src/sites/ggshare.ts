import type { Page } from 'playwright';
import type { Credentials, TimeSlot } from '../config/schema.js';
import { BaseSiteAdapter, type AvailableSlot, type ReservationTarget } from './base-site.js';
import { logger } from '../utils/logger.js';

/**
 * 경기도 공유서비스 (share.gg.go.kr)
 *
 * - 매월 말일 09:00 오픈 → 다음 달 일정 예약
 * - 달력에서 일요일 4개를 각각 클릭 → 시간대 클릭 → "예약신청" → 약관 동의 → "완료"
 * - CAPTCHA 없음
 *
 * config 매핑:
 *   facility = instiCode (예: "1200004")
 *   court    = facilityId (예: "F0002")
 *   preferred_slots[*].time = 클릭할 시간 라벨 (예: "16:00-17:00")
 */
export class GgShareSiteAdapter extends BaseSiteAdapter {
  name = 'ggshare';
  baseUrl = 'https://share.gg.go.kr';

  async login(page: Page, credentials: Credentials): Promise<void> {
    logger.info(`[${this.name}] 로그인 시작...`);

    const context = page.context();

    // 팝업 창 자동 닫기 (오늘 하루 열지 않기 → 닫기)
    const popupHandler = async (popup: Page) => {
      try {
        await popup.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});

        const todayOff = popup.getByText('오늘 하루 열지 않기').first();
        if (await todayOff.isVisible({ timeout: 2000 }).catch(() => false)) {
          await todayOff.click().catch(() => {});
          await popup.waitForTimeout(300);
        }

        const closeLink = popup.getByText('닫기', { exact: true }).first();
        if (await closeLink.isVisible({ timeout: 2000 }).catch(() => false)) {
          await closeLink.click().catch(() => {});
          await popup.waitForTimeout(300);
        }

        await popup.close().catch(() => {});
      } catch (e) {
        logger.warn(`[${this.name}] 팝업 처리 오류: ${e instanceof Error ? e.message : e}`);
      }
    };
    context.on('page', popupHandler);

    try {
      // /member 직접 goto 시 /index로 리다이렉트되므로, 홈에서 로그인 링크를 클릭해 접근
      await page.goto(`${this.baseUrl}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);

      const loginLink = page.locator('a[href*="/member"]:has-text("로그인")').first();
      await loginLink.waitFor({ state: 'visible', timeout: 10000 });
      await loginLink.click();
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(1500);

      // ID/PW 입력
      const idInput = page.locator('input#mberIdChk');
      await idInput.waitFor({ state: 'visible', timeout: 10000 });
      await idInput.click();
      await idInput.fill('');
      await idInput.type(credentials.id, { delay: 30 });

      const pwInput = page.locator('input#passwordChk');
      await pwInput.click();
      await pwInput.fill('');
      await pwInput.type(credentials.password, { delay: 30 });

      // "로그인" 제출 버튼 (페이지에 "로그인" 텍스트 다수 존재하므로 #loginBtn으로 특정)
      const loginBtn = page.locator('button#loginBtn');
      await loginBtn.waitFor({ state: 'visible', timeout: 5000 });
      await loginBtn.click();

      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);

      // 비밀번호 변경 모달 → "다음에 변경"
      const changeLater = page.getByText('다음에 변경').first();
      if (await changeLater.isVisible({ timeout: 3000 }).catch(() => false)) {
        logger.info(`[${this.name}] 비밀번호 변경 모달 → 다음에 변경`);
        await changeLater.click().catch(() => {});
        await page.waitForTimeout(1000);
      }

      const loggedIn = await this.isLoggedIn(page);
      if (!loggedIn) {
        throw new Error(`[${this.name}] 로그인 실패. ID/PW를 확인하세요.`);
      }
      logger.info(`[${this.name}] 로그인 성공`);
    } finally {
      // 팝업 핸들러는 세션 동안 유지하고 싶지만, 재로그인을 대비해 제거
      context.off('page', popupHandler);
    }
  }

  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      const logoutEl = page.getByText('로그아웃', { exact: true }).first();
      return await logoutEl.isVisible({ timeout: 3000 });
    } catch {
      return false;
    }
  }

  async isOnReservationPage(page: Page): Promise<boolean> {
    return page
      .locator('#finalData .quickReserv-container')
      .isVisible({ timeout: 1000 })
      .catch(() => false);
  }

  async navigateToReservation(page: Page, target: ReservationTarget): Promise<void> {
    const instiCode = target.facility;
    const facilityId = target.court;
    const url = `${this.baseUrl}/facilityListO/view?instiCode=${instiCode}&facilityId=${facilityId}`;

    logger.info(`[${this.name}] 예약 페이지 이동: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // "예약하기" 버튼 (a#oneClick1) 클릭
    const reserveBtn = page.locator('a#oneClick1');
    await reserveBtn.waitFor({ state: 'visible', timeout: 10000 });
    logger.info(`[${this.name}] "예약하기" 클릭`);
    await reserveBtn.click();

    // #finalData .quickReserv-container 대기 (대기열/카운트다운이 있어도 충분한 timeout으로 대응)
    logger.info(`[${this.name}] quickReserv-container 대기 중...`);
    await page
      .locator('#finalData .quickReserv-container')
      .waitFor({ state: 'visible', timeout: 300_000 });
    await page.waitForTimeout(500);
    logger.info(`[${this.name}] 예약 화면 도착`);
  }

  async getAvailableSlots(_page: Page): Promise<AvailableSlot[]> {
    return [];
  }

  /** 단일 슬롯 선택은 이 사이트에선 사용하지 않음 (selectSlots 오버라이드 사용) */
  async selectSlot(_page: Page, _slot: TimeSlot): Promise<boolean> {
    return false;
  }

  /**
   * 다음 달의 일요일 4개를 각각 클릭한 뒤, 각 일요일마다 주어진 시간대를 클릭한다.
   * 마지막에 "예약신청" 버튼 클릭.
   */
  async selectSlots(page: Page, slots: TimeSlot[]): Promise<boolean> {
    const sundays = this.getNextMonthSundays().slice(0, 4);
    const timeLabels = slots.map(s => this.toTimeLabel(s.time));
    logger.info(`[${this.name}] 대상 일요일: ${sundays.join(', ')}, 시간대: ${timeLabels.join(', ')}`);

    for (const sundayStr of sundays) {
      const dateCell = page.locator(`td.day_${sundayStr}`).first();
      if (!(await dateCell.isVisible({ timeout: 5000 }).catch(() => false))) {
        logger.warn(`[${this.name}] 날짜 셀을 찾을 수 없음: ${sundayStr}`);
        return false;
      }

      logger.info(`[${this.name}] 날짜 클릭: ${sundayStr}`);
      await dateCell.click();
      await page.waitForTimeout(800);

      for (const label of timeLabels) {
        const ok = await this.clickTimeSlot(page, label);
        if (!ok) {
          logger.warn(`[${this.name}] 시간대 클릭 실패: ${sundayStr} ${label}`);
          return false;
        }
      }
    }

    // "예약신청" 버튼
    const applyBtn = page
      .locator('button:has-text("예약신청"), a:has-text("예약신청"), input[value="예약신청"]')
      .first();
    await applyBtn.waitFor({ state: 'visible', timeout: 5000 });
    logger.info(`[${this.name}] "예약신청" 클릭`);
    await applyBtn.click();
    await page.waitForTimeout(1500);

    return true;
  }

  async addToCart(page: Page): Promise<boolean> {
    logger.info(`[${this.name}] 약관 동의 + 완료 단계...`);

    let alertMessage = '';
    const dialogHandler = async (dialog: { message(): string; accept(): Promise<void> }) => {
      alertMessage = dialog.message();
      logger.info(`[${this.name}] 알럿: ${alertMessage}`);
      await dialog.accept();
    };
    page.on('dialog', dialogHandler);

    try {
      // 모든 약관에 동의합니다 (label[for="agreeChkAll"])
      const agreeAll = page.locator('label[for="agreeChkAll"]').first();
      await agreeAll.waitFor({ state: 'visible', timeout: 10000 });
      await agreeAll.scrollIntoViewIfNeeded().catch(() => {});
      await agreeAll.click();
      logger.info(`[${this.name}] 모든 약관 동의 체크`);
      await page.waitForTimeout(500);

      // 완료 버튼 (input#oneClick1[value="완료"] — button:has-text("완료")는
      // 숨겨진 "작성완료"(리뷰) 버튼에 먼저 매칭되므로 input만 지정)
      const completeBtn = page.locator('input#oneClick1[value="완료"]');
      await completeBtn.waitFor({ state: 'visible', timeout: 5000 });
      logger.info(`[${this.name}] "완료" 클릭`);
      await completeBtn.click();
      await page.waitForTimeout(3000);

      if (/예약\s*완료/.test(alertMessage)) {
        logger.info(`[${this.name}] 예약 완료 알럿 수신`);
        return true;
      }
      if (alertMessage) {
        logger.error(`[${this.name}] 예약 실패 - 알럿: ${alertMessage}`);
        return false;
      }

      // 알럿이 없다면 페이지 텍스트로 확인
      const successText = page.getByText(/예약\s*완료|신청이?\s*완료/);
      if (await successText.isVisible({ timeout: 3000 }).catch(() => false)) {
        return true;
      }

      logger.warn(`[${this.name}] 완료 여부 확인 불가 - 스크린샷 확인 필요`);
      return false;
    } catch (error) {
      logger.error(`[${this.name}] 완료 처리 오류:`, error);
      return false;
    } finally {
      page.off('dialog', dialogHandler);
    }
  }

  // "16:00-17:00" → "16:00~17:00"
  private toTimeLabel(time: string): string {
    return time.replace('-', '~');
  }

  private async clickTimeSlot(page: Page, label: string): Promise<boolean> {
    // 우측 타임 리스트에서 "16:00~17:00" 같은 라벨을 가진 클릭 가능한 요소
    const candidates = [
      page.locator(`#finalData .quickReserv-container button:has-text("${label}")`).first(),
      page.locator(`#finalData .quickReserv-container label:has-text("${label}")`).first(),
      page.locator(`#finalData .quickReserv-container li:has-text("${label}")`).first(),
      page.getByText(label, { exact: false }).first(),
    ];

    for (const c of candidates) {
      if (await c.isVisible({ timeout: 1500 }).catch(() => false)) {
        await c.click().catch(() => {});
        await page.waitForTimeout(300);
        return true;
      }
    }
    return false;
  }

  /** 다음 달의 일요일을 YYYY-MM-DD 포맷으로 반환 */
  private getNextMonthSundays(): string[] {
    const now = new Date();
    const year = now.getFullYear();
    const monthIdx = now.getMonth();
    const nextMonth = new Date(year, monthIdx + 1, 1);
    const ny = nextMonth.getFullYear();
    const nm = nextMonth.getMonth();
    const daysInNextMonth = new Date(ny, nm + 1, 0).getDate();

    const sundays: string[] = [];
    for (let d = 1; d <= daysInNextMonth; d++) {
      const date = new Date(ny, nm, d);
      if (date.getDay() === 0) {
        const mm = String(nm + 1).padStart(2, '0');
        const dd = String(d).padStart(2, '0');
        sundays.push(`${ny}-${mm}-${dd}`);
      }
    }
    return sundays;
  }
}
