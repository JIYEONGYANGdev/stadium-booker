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

    // 다이얼로그 메시지 캡처
    let dialogMessage = '';
    const dialogHandler = async (dialog: { message(): string; accept(): Promise<void> }) => {
      dialogMessage = dialog.message();
      logger.info(`[${this.name}] 알림: ${dialogMessage}`);
      await dialog.accept();
    };
    page.on('dialog', dialogHandler);

    // 로그인 페이지로 직접 이동 (JS 완전 로드까지 대기)
    await page.goto(`${this.baseUrl}/main/login/login.do`, { waitUntil: 'networkidle' });
    await this.dismissPopup(page);

    // 로그인 폼 입력 (type()으로 실제 키 입력 시뮬레이션)
    const idInput = page.locator('input#mem_id');
    await idInput.waitFor({ state: 'visible', timeout: 10000 });

    // ID 입력: 기존 값 클리어 후 한 글자씩 타이핑
    await idInput.click();
    await idInput.fill('');
    await idInput.type(credentials.id, { delay: 50 });

    // PW 입력
    const passwordInput = page.locator('input[type="password"]').first();
    await passwordInput.click();
    await passwordInput.fill('');
    await passwordInput.type(credentials.password, { delay: 50 });

    // 입력값 확인
    const filledId = await idInput.inputValue().catch(() => '');
    const filledPw = await passwordInput.inputValue().catch(() => '');
    logger.info(`[${this.name}] 폼 입력 확인 - ID: ${filledId ? '입력됨' : '비어있음'}, PW: ${filledPw ? '입력됨' : '비어있음'}`);

    // 제출: button#btn_login 클릭
    logger.info(`[${this.name}] 로그인 제출...`);
    const loginBtn = page.locator('button#btn_login');
    await loginBtn.waitFor({ state: 'visible', timeout: 5000 });
    await loginBtn.click();

    // 응답 대기 (페이지 이동 또는 다이얼로그)
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);

    page.off('dialog', dialogHandler);

    if (dialogMessage) {
      throw new Error(`[${this.name}] 로그인 실패 - 사이트 응답: "${dialogMessage}"`);
    }

    // URL 변경 확인
    const currentUrl = page.url();
    logger.info(`[${this.name}] 로그인 후 URL: ${currentUrl}`);

    // 로그인 후 리다이렉트된 페이지에서 팝업이 뜰 수 있음
    await this.dismissPopup(page);

    const loggedIn = await this.isLoggedIn(page);
    if (!loggedIn) {
      throw new Error(`[${this.name}] 로그인 실패. ID/PW를 확인하세요.`);
    }

    logger.info(`[${this.name}] 로그인 성공`);
  }

  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      // "로그아웃" 텍스트가 보이면 로그인 상태 (link일 수도, button일 수도 있음)
      const logoutEl = page.getByText('로그아웃', { exact: true }).first();
      return await logoutEl.isVisible({ timeout: 5000 });
    } catch {
      return false;
    }
  }

  async navigateToReservation(page: Page, target: ReservationTarget): Promise<void> {
    logger.info(`[${this.name}] 예약 페이지 이동: ${target.facility} - ${target.court}`);

    // 홈이 아니면 홈으로 이동
    if (!page.url().startsWith(this.baseUrl)) {
      await page.goto(`${this.baseUrl}/`, { waitUntil: 'domcontentloaded' });
    }
    await this.dismissPopup(page);

    // 시설 클릭 (예: "풋살장")
    await this.clickWithPopupRetry(page, target.facility);
    await page.waitForLoadState('networkidle');

    // 구장 대기 후 클릭 (예: "고덕풋살장")
    await this.clickWithPopupRetry(page, target.court);
    await page.waitForLoadState('networkidle');

    // 예약 페이지에서도 팝업이 뜰 수 있음
    await this.dismissPopup(page);

    // 날짜 선택
    const targetDate = target.date
      ? new Date(`${target.date}T00:00:00`)
      : getNextNextWeekday(3);
    const dateValue = formatDateYYYYMMDD(targetDate);

    const dateSelect = page.locator('select[title="날짜"]');
    if (await dateSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      logger.info(`[${this.name}] 날짜 선택: ${dateValue}`);
      await dateSelect.selectOption({ value: dateValue });
      await page.waitForLoadState('networkidle');
    } else {
      // 다른 셀렉터 시도
      const altDateSelect = page.locator('select').filter({ hasText: /\d{4}-\d{2}-\d{2}/ }).first();
      if (await altDateSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
        logger.info(`[${this.name}] 날짜 선택 (대체): ${dateValue}`);
        await altDateSelect.selectOption({ value: dateValue });
        await page.waitForLoadState('networkidle');
      } else {
        logger.warn(`[${this.name}] 날짜 select를 찾지 못했습니다. 현재 URL: ${page.url()}`);
      }
    }

    // 날짜 선택 후 테이블 렌더링 대기 (깜빡이며 로드됨)
    await page.waitForLoadState('networkidle');
    await page.locator('table tr').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

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

    const input = page.locator('input#captchaAnswer');
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await input.click();
    await input.fill('');
    await input.type(answer, { delay: 50 });

    // CAPTCHA 입력 후 예약담기 버튼 활성화 대기
    const resAddBtn = page.locator('button#resAddBtn');
    await page.waitForTimeout(1000);
    const isEnabled = await resAddBtn.isEnabled({ timeout: 5000 }).catch(() => false);
    logger.info(`[${this.name}] 예약담기 버튼 활성화: ${isEnabled}`);
  }

  async refreshCaptcha(page: Page): Promise<void> {
    const reloadBtn = page.locator('button#reload');
    if (await reloadBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      logger.info(`[${this.name}] CAPTCHA 새로고침`);
      await reloadBtn.click();
      await page.waitForTimeout(1000);
    }
  }

  async acceptTerms(_page: Page): Promise<void> {
    // 별도 약관 없음
  }

  async fillReservationForm(page: Page, info: ReservationInfo): Promise<void> {
    logger.info(`[${this.name}] 예약 폼 입력...`);

    // 1. 행사명
    if (info.event_name) {
      await this.fillByLabelOrSelector(page, /행사명/, [
        'input[name*=event i]',
        'input[id*=event i]',
        'input[name*=title i]',
      ], info.event_name);
      logger.info(`[${this.name}] 행사명 입력 완료`);
    }

    // 2. 행사목적
    if (info.purpose) {
      await this.fillByLabelOrSelector(page, /행사목적|이용목적|목적/, [
        'input[name*=purpose i]',
        'input[id*=purpose i]',
      ], info.purpose);
      logger.info(`[${this.name}] 행사목적 입력 완료`);
    }

    // 3. 관내인원: select#rmt_in_num
    if (info.headcount) {
      const headcountSelect = page.locator('select#rmt_in_num');
      if (await headcountSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
        await headcountSelect.selectOption(info.headcount.toString());
        logger.info(`[${this.name}] 관내인원 선택: ${info.headcount}`);
      }
    }

    // 4. 부속설비: 풋살장 라이트시설(1시간) 버튼 클릭 → select 활성화 → 수량 2 선택
    const lightBtn = page.locator('button[id^="facbtn_"]:has-text("풋살장 라이트시설")').first();
    if (await lightBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await lightBtn.click();
      await page.waitForTimeout(500);
      // 클릭 후 select가 enabled 되므로 같은 li 안에서 선택
      const lightSelect = page.locator('select#rot_cnt_5');
      if (await lightSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
        await lightSelect.selectOption('2');
        logger.info(`[${this.name}] 부속설비 라이트시설 x2 선택`);
      } else {
        logger.warn(`[${this.name}] 부속설비 select를 찾지 못함, 스킵`);
      }
    } else {
      logger.info(`[${this.name}] 부속설비 버튼 없음, 스킵`);
    }

    // 5. 결제방식: 신용카드 (radio input은 숨겨져 있을 수 있으므로 label/text 우선)
    const cardLabel = page.locator('label[for="radioPay1"]');
    if (await cardLabel.isVisible({ timeout: 1000 }).catch(() => false)) {
      await cardLabel.click();
      logger.info(`[${this.name}] 결제방식: 신용카드 선택`);
    } else {
      const cardText = page.getByText('신용카드').first();
      if (await cardText.isVisible({ timeout: 1000 }).catch(() => false)) {
        await cardText.click();
        logger.info(`[${this.name}] 결제방식: 신용카드 선택 (text)`);
      } else {
        // 최후: JS로 직접 체크
        await page.evaluate(() => {
          const radio = document.querySelector('input#radioPay1') as HTMLInputElement;
          if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }
        });
        logger.info(`[${this.name}] 결제방식: 신용카드 선택 (evaluate)`);
      }
    }
  }

  async getAvailableSlots(_page: Page): Promise<AvailableSlot[]> {
    return [];
  }

  async selectSlot(page: Page, slot: TimeSlot): Promise<boolean> {
    // 사이트 형식: "20:00~21:00" (config는 "20:00-21:00")
    const timeLabel = slot.time.replace('-', '~');

    // 페이지 렌더링이 깜빡이므로 재시도
    for (let attempt = 1; attempt <= 3; attempt++) {
      // 시간대 버튼 찾기: <button> 안에 <span class="left">20:00~21:00</span>
      const timeBtn = page.locator(`button:has(span.left:text-is("${timeLabel}"))`).first();

      if (await timeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        // 마감 여부 확인 (버튼 클래스에 disabled 등)
        const btnClass = await timeBtn.getAttribute('class') ?? '';
        if (/disabled|closed|soldout/i.test(btnClass)) {
          logger.warn(`[${this.name}] 시간대 마감: ${slot.time} (class: ${btnClass})`);
          return false;
        }

        logger.info(`[${this.name}] 시간대 버튼 클릭: ${timeLabel}`);
        await timeBtn.click();
        return true;
      }

      if (attempt < 3) {
        logger.info(`[${this.name}] 시간대 미발견 (시도 ${attempt}/3), 대기 후 재시도...`);
        await page.waitForTimeout(1500);
        await page.waitForLoadState('networkidle').catch(() => {});
      }
    }

    // 디버깅: 현재 페이지의 시간대 버튼 목록 출력
    const allTimes = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button span.left'))
        .map(el => el.textContent?.trim())
        .filter(Boolean);
    });
    logger.warn(`[${this.name}] 시간대를 찾을 수 없음: ${slot.time}`);
    logger.warn(`[${this.name}] 현재 시간대 목록: ${JSON.stringify(allTimes)}`);
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

    let dialogMessage = '';
    const dialogHandler = async (dialog: { message(): string; accept(): Promise<void> }) => {
      dialogMessage = dialog.message();
      logger.info(`[${this.name}] 알럿: ${dialogMessage}`);
      await dialog.accept();
    };
    page.on('dialog', dialogHandler);

    try {
      const cartBtn = page.locator('button#resAddBtn');
      await cartBtn.waitFor({ state: 'visible', timeout: 5000 });

      // 버튼이 활성화될 때까지 대기 (CAPTCHA 입력 후 활성화됨)
      const isEnabled = await cartBtn.isEnabled({ timeout: 5000 }).catch(() => false);
      if (!isEnabled) {
        logger.error(`[${this.name}] 예약담기 버튼이 비활성화 상태입니다. CAPTCHA를 확인하세요.`);
        return false;
      }

      logger.info(`[${this.name}] 예약담기 버튼 클릭`);
      await cartBtn.click();
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);

      // 다이얼로그로 성공/실패 메시지가 올 수 있음
      if (dialogMessage) {
        if (/완료|성공|바구니/.test(dialogMessage)) {
          logger.info(`[${this.name}] 예약바구니 담기 성공! (${dialogMessage})`);
          return true;
        }
        if (/실패|오류|불가|마감|틀렸습니다/.test(dialogMessage)) {
          logger.error(`[${this.name}] 예약 실패: ${dialogMessage}`);
          return false;
        }
        // 기타 다이얼로그 (확인 메시지 등) → 일단 성공으로 간주
        logger.info(`[${this.name}] 다이얼로그 응답: ${dialogMessage}`);
        return true;
      }

      // 페이지 내 성공/실패 메시지 확인
      const successMsg = page.getByText(/신청이 완료되었습니다|예약바구니|완료되었습니다/);
      if (await successMsg.isVisible({ timeout: 3000 }).catch(() => false)) {
        logger.info(`[${this.name}] 예약바구니 담기 성공!`);
        return true;
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

  private async dismissPopup(page: Page): Promise<void> {
    const popup = page.locator('#mainLayerPopup');
    if (await popup.isVisible({ timeout: 2000 }).catch(() => false)) {
      logger.info(`[${this.name}] 메인 팝업 닫기`);
      await page.locator('#btnPopClosePopup').dispatchEvent('click');
      await popup.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }
  }

  /**
   * 요소를 찾아 클릭하되, 실패하면 팝업을 닫고 재시도한다.
   * 예약 페이지 진입 전까지의 네비게이션에서 사용.
   */
  private async clickWithPopupRetry(page: Page, text: string, maxRetries = 2): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const link = page.getByText(text, { exact: true }).first();
      const visible = await link.isVisible({ timeout: 5000 }).catch(() => false);

      if (visible) {
        logger.info(`[${this.name}] "${text}" 클릭`);
        await link.click();
        return;
      }

      // 요소를 못 찾음 → 팝업이 가리고 있을 수 있음
      logger.info(`[${this.name}] "${text}" 요소 미발견 (시도 ${attempt}/${maxRetries}), 팝업 닫기 후 재시도...`);
      await this.dismissPopup(page);
      await page.waitForTimeout(500);
    }

    // 마지막으로 한번 더 시도 (실패 시 에러)
    const link = page.getByText(text, { exact: true }).first();
    await link.waitFor({ state: 'visible', timeout: 10000 });
    logger.info(`[${this.name}] "${text}" 클릭`);
    await link.click();
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
