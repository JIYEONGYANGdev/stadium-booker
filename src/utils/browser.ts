import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { BrowserConfig } from '../config/schema.js';
import { logger } from './logger.js';

const SCREENSHOTS_DIR = resolve('screenshots');

const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  headless: true,
  block_images: false,
  block_css: true,
  timeout_ms: 30000,
};

export async function launchBrowser(config?: Partial<BrowserConfig>): Promise<Browser> {
  const cfg = { ...DEFAULT_BROWSER_CONFIG, ...config };
  logger.info(`브라우저 실행 (headless: ${cfg.headless})`);

  return chromium.launch({
    headless: cfg.headless,
  });
}

export async function createContext(
  browser: Browser,
  config?: Partial<BrowserConfig>,
): Promise<BrowserContext> {
  const cfg = { ...DEFAULT_BROWSER_CONFIG, ...config };

  const context = await browser.newContext({
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  context.setDefaultTimeout(cfg.timeout_ms);

  if (cfg.block_images || cfg.block_css) {
    await context.route('**/*', (route: Route) => {
      const resourceType = route.request().resourceType();
      if (cfg.block_images && resourceType === 'image') return route.abort();
      if (cfg.block_css && resourceType === 'stylesheet') return route.abort();
      if (resourceType === 'font') return route.abort();
      return route.continue();
    });
  }

  return context;
}

export async function saveScreenshot(
  page: Page,
  name: string,
): Promise<string> {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${name}_${timestamp}.png`;
  const filepath = resolve(SCREENSHOTS_DIR, filename);

  await page.screenshot({ path: filepath, fullPage: false });
  logger.debug(`스크린샷 저장: ${filepath}`);

  return filepath;
}

export async function saveSessionCookies(
  context: BrowserContext,
  siteName: string,
): Promise<string> {
  const cookies = await context.cookies();
  const { writeFileSync } = await import('node:fs');
  const cookiePath = resolve('config', `.cookies-${siteName}.json`);
  writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
  logger.debug(`쿠키 저장: ${cookiePath}`);
  return cookiePath;
}

export async function loadSessionCookies(
  context: BrowserContext,
  siteName: string,
): Promise<boolean> {
  const { readFileSync, existsSync } = await import('node:fs');
  const cookiePath = resolve('config', `.cookies-${siteName}.json`);

  if (!existsSync(cookiePath)) return false;

  try {
    const cookies = JSON.parse(readFileSync(cookiePath, 'utf-8'));
    await context.addCookies(cookies);
    logger.debug(`쿠키 로드: ${cookiePath}`);
    return true;
  } catch {
    logger.warn('저장된 쿠키 로드 실패');
    return false;
  }
}
