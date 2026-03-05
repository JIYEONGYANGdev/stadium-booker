import type { Page } from 'playwright';
import type { Credentials, TimeSlot } from '../config/schema.js';

export interface AvailableSlot {
  day: string;
  time: string;
  available: boolean;
  label?: string;
}

export interface ReservationTarget {
  facility: string;
  court: string;
  date?: string;
}

export interface ReservationInfo {
  event_name?: string;
  headcount?: number;
  purpose?: string;
  phone?: string;
}

export interface SiteAdapter {
  name: string;
  baseUrl: string;

  /** 사이트 로그인 */
  login(page: Page, credentials: Credentials): Promise<void>;

  /** 예약 페이지로 이동 */
  navigateToReservation(page: Page, target: ReservationTarget): Promise<void>;

  /** CAPTCHA 이미지 셀렉터 반환 (없으면 null) */
  getCaptchaSelector(page: Page): Promise<string | null>;

  /** CAPTCHA 결과 입력 */
  submitCaptcha(page: Page, answer: string): Promise<void>;

  /** CAPTCHA 새로고침 (선택) */
  refreshCaptcha?(page: Page): Promise<void>;

  /** 약관 동의 등 사전 체크박스/동의 처리 */
  acceptTerms(page: Page): Promise<void>;

  /** 예약 폼 입력 (인원수, 용도 등) */
  fillReservationForm(page: Page, info: ReservationInfo): Promise<void>;

  /** 가능한 시간대 조회 */
  getAvailableSlots(page: Page): Promise<AvailableSlot[]>;

  /** 시간대 선택 */
  selectSlot(page: Page, slot: TimeSlot): Promise<boolean>;

  /** 여러 시간대 선택 (기본: 순차 선택) */
  selectSlots(page: Page, slots: TimeSlot[]): Promise<boolean>;

  /** 예약바구니에 담기 */
  addToCart(page: Page): Promise<boolean>;

  /** 로그인 상태 확인 */
  isLoggedIn(page: Page): Promise<boolean>;
}

export abstract class BaseSiteAdapter implements SiteAdapter {
  abstract name: string;
  abstract baseUrl: string;

  abstract login(page: Page, credentials: Credentials): Promise<void>;
  abstract navigateToReservation(page: Page, target: ReservationTarget): Promise<void>;
  abstract getAvailableSlots(page: Page): Promise<AvailableSlot[]>;
  abstract selectSlot(page: Page, slot: TimeSlot): Promise<boolean>;
  abstract addToCart(page: Page): Promise<boolean>;

  async selectSlots(page: Page, slots: TimeSlot[]): Promise<boolean> {
    for (const slot of slots) {
      const ok = await this.selectSlot(page, slot);
      if (!ok) return false;
    }
    return true;
  }

  async getCaptchaSelector(_page: Page): Promise<string | null> {
    return null;
  }

  async submitCaptcha(_page: Page, _answer: string): Promise<void> {
    // 기본: CAPTCHA 없음
  }

  async acceptTerms(_page: Page): Promise<void> {
    // 기본: 약관 동의 없음
  }

  async fillReservationForm(_page: Page, _info: ReservationInfo): Promise<void> {
    // 기본: 추가 폼 없음
  }

  async isLoggedIn(_page: Page): Promise<boolean> {
    return false;
  }
}
