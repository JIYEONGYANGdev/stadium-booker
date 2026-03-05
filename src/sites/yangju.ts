import type { Page } from 'playwright';
import type { Credentials, TimeSlot } from '../config/schema.js';
import { BaseSiteAdapter, type AvailableSlot, type ReservationInfo, type ReservationTarget } from './base-site.js';
import { formatDateYYYYMMDD, getNextNextWeekday } from '../utils/date.js';
import { logger } from '../utils/logger.js';

export class YangjuSiteAdapter extends BaseSiteAdapter {
  name = 'yangju';
  baseUrl = 'https://reserve.yjuc.or.kr';

  async login(page: Page, credentials: Credentials): Promise<void> {
    logger.info(`[${this.name}] 로그인 시작...`);

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.goto(`${this.baseUrl}/main/rent/rent_req_list.do`, { waitUntil: 'domcontentloaded' });

    await page.waitForLoadState('domcontentloaded');

    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.waitFor({ state: 'visible', timeout: 5000 });

    const idInput = page.locator('input[type="text"], input[name*=id i], input[id*=id i]').first();
    await idInput.fill(credentials.id);
    await passwordInput.fill(credentials.password);

    const loginButton = page.getByRole('button', { name: /로그인/ });
    if (await loginButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await loginButton.click();
    } else {
      const submitButton = page.locator('input[type="submit"], button[type="submit"]').first();
      await submitButton.click();
    }

    await page.waitForLoadState('networkidle');

    const loggedIn = await this.isLoggedIn(page);
    if (!loggedIn) {
      throw new Error(`[${this.name}] 로그인 실패. ID/PW를 확인하세요.`);
    }

    logger.info(`[${this.name}] 로그인 성공`);
  }

  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      const logoutBtn = page.getByRole('link', { name: /로그아웃|마이페이지/ });
      return await logoutBtn.isVisible({ timeout: 3000 });
    } catch {
      return false;
    }
  }

  async navigateToReservation(page: Page, target: ReservationTarget): Promise<void> {
    logger.info(`[${this.name}] 예약 페이지 이동: ${target.facility} - ${target.court}`);

    await page.goto(`${this.baseUrl}/main/rent/rent_req_list.do`, { waitUntil: 'domcontentloaded' });

    const facilityLink = page.getByText(target.facility, { exact: true });
    if (await facilityLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await facilityLink.click();
      await page.waitForLoadState('networkidle');
    }

    const courtLink = page.getByText(target.court, { exact: true });
    if (await courtLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await courtLink.click();
      await page.waitForLoadState('networkidle');
    }

    // 날짜 선택: 다다음주 수요일
    const targetDate = getNextNextWeekday(3);
    const dateValue = formatDateYYYYMMDD(targetDate);
    const dateLabel = `${dateValue} (수)`;

    const dateSelect = page.locator('select[title="날짜"]');
    if (await dateSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      try {
        await dateSelect.selectOption({ value: dateValue });
      } catch {
        await dateSelect.selectOption({ label: dateLabel });
      }
    } else {
      logger.warn(`[${this.name}] 날짜 select를 찾지 못했습니다.`);
    }

    logger.info(`[${this.name}] 예약 페이지 도착`);
  }

  async getCaptchaSelector(page: Page): Promise<string | null> {
    const captcha = page.locator('#captchaImage');
    if (await captcha.isVisible({ timeout: 3000 }).catch(() => false)) {
      return '#captchaImage';
    }
    return null;
  }

  async submitCaptcha(page: Page, answer: string): Promise<void> {
    logger.info(`[${this.name}] CAPTCHA 입력: ${answer}`);

    const input = page.locator('input[name*=captcha i], input[id*=captcha i]').first();
    if (await input.isVisible({ timeout: 2000 }).catch(() => false)) {
      await input.fill(answer);
      return;
    }

    throw new Error('CAPTCHA 입력 필드를 찾지 못했습니다.');
  }

  async refreshCaptcha(page: Page): Promise<void> {
    const captcha = page.locator('#captchaImage');
    if (await captcha.isVisible({ timeout: 2000 }).catch(() => false)) {
      await captcha.click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }

  async acceptTerms(_page: Page): Promise<void> {
    // 별도 약관 없음
  }

  async fillReservationForm(page: Page, info: ReservationInfo): Promise<void> {
    logger.info(`[${this.name}] 예약 폼 입력...`);

    if (info.event_name) {
      await this.fillByLabelOrSelector(page, /행사명/, [
        'input[name*=event i]',
        'input[id*=event i]',
        'input[name*=title i]',
      ], info.event_name);
    }

    if (info.purpose) {
      await this.fillByLabelOrSelector(page, /행사목적|이용목적|목적/, [
        'input[name*=purpose i]',
        'input[id*=purpose i]',
      ], info.purpose);
    }

    if (info.headcount) {
      const headcountSelect = page.getByLabel(/관내인원|이용인원|인원/);
      if (await headcountSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
        await headcountSelect.selectOption(info.headcount.toString());
      } else {
        const select = page.locator('select[name*=count i], select[id*=count i], select[name*=people i]').first();
        if (await select.isVisible({ timeout: 2000 }).catch(() => false)) {
          await select.selectOption(info.headcount.toString());
        }
      }
    }

    // 부속설비: 풋살장 라이트시설(1시간) x 2
    const lightBtn = page.getByRole('button', { name: /풋살장 라이트시설/ });
    if (await lightBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await lightBtn.click();
      const row = lightBtn.locator('xpath=ancestor::tr[1]');
      const select = row.locator('select').first();
      if (await select.isVisible({ timeout: 2000 }).catch(() => false)) {
        await select.selectOption('2');
      }
    }

    // 결제방식: 신용카드
    const cardRadio = page.getByRole('radio', { name: /신용카드/ });
    if (await cardRadio.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cardRadio.check();
    } else {
      const cardLabel = page.getByText('신용카드', { exact: true });
      if (await cardLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
        await cardLabel.click();
      }
    }
  }

  async getAvailableSlots(_page: Page): Promise<AvailableSlot[]> {
    return [];
  }

  async selectSlot(page: Page, slot: TimeSlot): Promise<boolean> {
    const timeLabel = slot.time.replace('-', '~');
    const row = page.locator(`tr:has-text("${timeLabel}")`).first();

    if (await row.isVisible({ timeout: 3000 }).catch(() => false)) {
      const rowText = (await row.textContent()) ?? '';
      if (/마감|불가|예약완료/.test(rowText)) {
        logger.warn(`[${this.name}] 시간대 마감: ${slot.time}`);
        return false;
      }

      const input = row.locator('input[type="checkbox"], input[type="radio"]').first();
      if (await input.isVisible({ timeout: 2000 }).catch(() => false)) {
        if (await input.isDisabled().catch(() => false)) return false;
        await input.check();
        return true;
      }

      const timeCell = row.getByText(new RegExp(timeLabel.replace('~', '\\s*~\\s*')));
      if (await timeCell.isVisible({ timeout: 2000 }).catch(() => false)) {
        await timeCell.click();
        return true;
      }
    }

    logger.warn(`[${this.name}] 시간대를 찾을 수 없음: ${slot.time}`);
    return false;
  }

  async selectSlots(page: Page, slots: TimeSlot[]): Promise<boolean> {
    for (const slot of slots) {
      const ok = await this.selectSlot(page, slot);
      if (!ok) return false;
    }
    return true;
  }

  async addToCart(page: Page): Promise<boolean> {
    logger.info(`[${this.name}] 예약바구니 담기...`);

    const dialogHandler = async (dialog: { message(): string; accept(): Promise<void> }) => {
      logger.info(`[${this.name}] 알럿 확인: ${dialog.message()}`);
      await dialog.accept();
    };
    page.on('dialog', dialogHandler);

    try {
      const cartBtn = page.getByRole('button', { name: /예약담기/ });
      await cartBtn.click();
      await page.waitForLoadState('networkidle');

      const successMsg = page.getByText(/신청이 완료되었습니다|예약바구니|완료되었습니다/);
      const isSuccess = await successMsg.isVisible({ timeout: 5000 }).catch(() => false);
      if (isSuccess) {
        logger.info(`[${this.name}] 예약바구니 담기 성공!`);
        return true;
      }

      const errorMsg = page.getByText(/실패|오류|불가|마감/);
      if (await errorMsg.isVisible({ timeout: 2000 }).catch(() => false)) {
        const errorText = await errorMsg.textContent();
        logger.error(`[${this.name}] 예약 실패: ${errorText}`);
        return false;
      }

      logger.warn(`[${this.name}] 예약 결과 확인 불가 - 스크린샷을 확인하세요`);
      return false;
    } catch (error) {
      logger.error(`[${this.name}] 예약바구니 담기 오류:`, error);
      return false;
    } finally {
      page.off('dialog', dialogHandler);
    }
  }

  private async fillByLabelOrSelector(
    page: Page,
    label: RegExp,
    selectors: string[],
    value: string,
  ): Promise<void> {
    const labeled = page.getByLabel(label);
    if (await labeled.isVisible({ timeout: 2000 }).catch(() => false)) {
      await labeled.fill(value);
      return;
    }

    for (const selector of selectors) {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.fill(value);
        return;
      }
    }
  }
}
