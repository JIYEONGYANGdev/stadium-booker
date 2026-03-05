import { Command } from 'commander';
import { config as loadDotenv } from 'dotenv';
import { loadConfig } from '../config/loader.js';
import { Booker } from '../core/booker.js';
import { Scheduler } from '../core/scheduler.js';
import { getSiteAdapter, getAvailableSites } from '../sites/index.js';
import { sendKakaoMessage, getKakaoTokenStatus } from '../notification/kakao.js';
import { solveCaptchaFromBuffer } from '../captcha/solver.js';
import { launchBrowser, createContext, saveScreenshot } from '../utils/browser.js';
import { logger } from '../utils/logger.js';
import { readFileSync, existsSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

loadDotenv();

const HISTORY_FILE = resolve('logs', 'history.jsonl');

function appendHistory(entry: Record<string, unknown>): void {
  mkdirSync(resolve('logs'), { recursive: true });
  appendFileSync(HISTORY_FILE, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n');
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('stadium-booker')
    .description('공공체육시설 구장 예약 자동화 CLI')
    .version('1.0.0');

  // ── book ──────────────────────────────────────────
  program
    .command('book')
    .description('즉시 예약 실행')
    .option('-c, --config <path>', '설정 파일 경로', 'config/config.yaml')
    .option('-r, --reservation <name>', '예약 이름')
    .option('--dry-run', '실제 예약 없이 테스트', false)
    .option('--no-headless', '브라우저 표시')
    .action(async (opts) => {
      const config = loadConfig(opts.config);

      if (opts.headless === false) {
        config.browser = { ...config.browser, headless: false } as typeof config.browser;
      }

      if (!opts.reservation) {
        console.log('\n사용 가능한 예약:');
        for (const r of config.reservations) {
          console.log(`  - ${r.name} (${r.site}: ${r.facility} ${r.court})`);
        }
        console.log('\n--reservation <name> 으로 예약을 지정하세요.');
        return;
      }

      const booker = new Booker(config, opts.dryRun);
      const result = await booker.executeReservation(opts.reservation);

      appendHistory({ command: 'book', ...result });

      if (result.success) {
        console.log(`\n✅ ${result.message}`);
        console.log('💳 예약 사이트에서 결제를 완료하세요!');
      } else {
        console.log(`\n❌ ${result.message}`);
        process.exitCode = 1;
      }
    });

  // ── schedule ──────────────────────────────────────
  program
    .command('schedule')
    .description('스케줄러 시작 (예약 오픈 시간에 자동 실행)')
    .option('-c, --config <path>', '설정 파일 경로', 'config/config.yaml')
    .option('-r, --reservation <name>', '특정 예약만 스케줄')
    .action(async (opts) => {
      const config = loadConfig(opts.config);
      const scheduler = new Scheduler(config);

      if (opts.reservation) {
        scheduler.scheduleOne(opts.reservation);
      } else {
        scheduler.scheduleAll();
      }

      // Graceful shutdown
      process.on('SIGINT', () => {
        console.log('\n스케줄러 종료...');
        scheduler.stop();
        process.exit(0);
      });

      // Keep process alive
      await new Promise(() => {});
    });

  // ── test ──────────────────────────────────────────
  const testCmd = program
    .command('test')
    .description('기능 테스트');

  testCmd
    .command('login')
    .description('사이트 로그인 테스트')
    .option('-c, --config <path>', '설정 파일 경로', 'config/config.yaml')
    .requiredOption('-s, --site <name>', '사이트 이름')
    .option('--no-headless', '브라우저 표시')
    .action(async (opts) => {
      const config = loadConfig(opts.config);
      const credentials = config.credentials[opts.site];

      if (!credentials) {
        console.error(`사이트 "${opts.site}"의 로그인 정보가 없습니다.`);
        process.exitCode = 1;
        return;
      }

      const site = getSiteAdapter(opts.site);
      const browserConfig = {
        ...config.browser,
        headless: opts.headless,
        block_images: false,
        block_css: false,
      };

      const browser = await launchBrowser(browserConfig);
      try {
        const context = await createContext(browser, browserConfig);
        const page = await context.newPage();

        await site.login(page, credentials);
        console.log('✅ 로그인 성공!');

        await saveScreenshot(page, 'login-test');
      } catch (error) {
        console.error('❌ 로그인 실패:', error);
        process.exitCode = 1;
      } finally {
        await browser.close();
      }
    });

  testCmd
    .command('captcha')
    .description('CAPTCHA 인식 테스트')
    .option('-c, --config <path>', '설정 파일 경로', 'config/config.yaml')
    .option('-f, --file <path>', 'CAPTCHA 이미지 파일')
    .option('-s, --site <name>', '사이트에서 직접 캡처')
    .option('--no-headless', '브라우저 표시')
    .action(async (opts) => {
      const config = loadConfig(opts.config);

      if (opts.file) {
        const imageBuffer = readFileSync(opts.file);
        const result = await solveCaptchaFromBuffer(imageBuffer, config.captcha);
        console.log(`\n인식 결과: "${result}"`);
        return;
      }

      if (opts.site) {
        const credentials = config.credentials[opts.site];
        if (!credentials) {
          console.error(`사이트 "${opts.site}"의 로그인 정보가 없습니다.`);
          return;
        }

        const site = getSiteAdapter(opts.site);
        const browserConfig = {
          ...config.browser,
          headless: opts.headless,
          block_images: false,
          block_css: false,
        };

        const browser = await launchBrowser(browserConfig);
        try {
          const context = await createContext(browser, browserConfig);
          const page = await context.newPage();

          await site.login(page, credentials);

          // 예약 페이지로 이동해서 CAPTCHA 캡처
          const reservation = config.reservations.find(r => r.site === opts.site);
          if (reservation) {
            await site.navigateToReservation(page, {
              facility: reservation.facility,
              court: reservation.court,
            });
          }

          const captchaSelector = await site.getCaptchaSelector(page);
          if (captchaSelector) {
            const captchaEl = page.locator(captchaSelector);
            if (await captchaEl.isVisible({ timeout: 5000 }).catch(() => false)) {
              const imageBuffer = await captchaEl.screenshot();
              const result = await solveCaptchaFromBuffer(imageBuffer, config.captcha);
              console.log(`\nCAPTCHA 인식 결과: "${result}"`);
              await saveScreenshot(page, 'captcha-test');
            } else {
              console.log('CAPTCHA 요소를 찾을 수 없습니다.');
            }
          } else {
            console.log('이 사이트에는 CAPTCHA가 없습니다.');
          }
        } finally {
          await browser.close();
        }
        return;
      }

      console.log('--file <path> 또는 --site <name> 옵션을 사용하세요.');
    });

  testCmd
    .command('notify')
    .description('알림 테스트')
    .option('-m, --message <text>', '테스트 메시지', '🏟️ Stadium Booker 테스트 알림입니다.')
    .action(async (opts) => {
      try {
        await sendKakaoMessage(opts.message);
        console.log('✅ 알림 전송 성공!');
      } catch (error) {
        console.error('❌ 알림 전송 실패:', error);
        process.exitCode = 1;
      }
    });

  // ── config ────────────────────────────────────────
  const configCmd = program
    .command('config')
    .description('설정 관리');

  configCmd
    .command('init')
    .description('대화형 설정 파일 생성')
    .action(async () => {
      const { createConfigInteractively } = await import('./interactive.js');
      await createConfigInteractively();
    });

  configCmd
    .command('validate')
    .description('설정 파일 검증')
    .option('-c, --config <path>', '설정 파일 경로', 'config/config.yaml')
    .action((opts) => {
      try {
        loadConfig(opts.config);
        console.log('✅ 설정 파일이 유효합니다.');
      } catch (error) {
        console.error('❌ 설정 오류:', error instanceof Error ? error.message : error);
        process.exitCode = 1;
      }
    });

  configCmd
    .command('sites')
    .description('지원하는 사이트 목록')
    .action(() => {
      console.log('\n지원 사이트:');
      for (const site of getAvailableSites()) {
        const adapter = getSiteAdapter(site);
        console.log(`  - ${site}: ${adapter.baseUrl}`);
      }
    });

  // ── history ───────────────────────────────────────
  program
    .command('history')
    .description('예약 히스토리 조회')
    .option('-n, --last <count>', '최근 N건', '10')
    .action((opts) => {
      if (!existsSync(HISTORY_FILE)) {
        console.log('예약 히스토리가 없습니다.');
        return;
      }

      const lines = readFileSync(HISTORY_FILE, 'utf-8')
        .trim()
        .split('\n')
        .filter(Boolean);

      const lastN = parseInt(opts.last, 10);
      const entries = lines.slice(-lastN).map(line => JSON.parse(line));

      console.log('\n📋 예약 히스토리');
      console.log('─'.repeat(60));

      for (const entry of entries) {
        const icon = entry.success ? '✅' : '❌';
        console.log(`  ${icon} [${entry.timestamp}] ${entry.reservation ?? entry.command}`);
        if (entry.message) console.log(`     ${entry.message}`);
      }

      console.log('─'.repeat(60));
    });

  // ── tokens ────────────────────────────────────────
  const tokensCmd = program
    .command('tokens')
    .description('토큰 상태 조회');

  tokensCmd
    .command('kakao')
    .description('카카오 토큰 상태 확인')
    .action(() => {
      const status = getKakaoTokenStatus();
      console.log('\n🔐 카카오 토큰 상태');
      console.log(`- source: ${status.source}`);
      console.log(`- access_token: ${status.accessToken ?? 'missing'}`);
      console.log(`- refresh_token: ${status.refreshToken ?? 'missing'}`);
      console.log(`- rest_api_key: ${status.restApiKey ?? 'missing'}`);
      console.log(`- tokens_file: ${status.hasFile ? 'exists' : 'missing'}`);
      if (status.updatedAt) {
        console.log(`- updated_at: ${status.updatedAt}`);
      }
    });

  tokensCmd
    .command('kakao-init')
    .description('카카오 인가코드로 토큰 발급 후 저장')
    .action(async () => {
      const restApiKey = process.env['KAKAO_REST_API_KEY'];
      if (!restApiKey) {
        console.error('KAKAO_REST_API_KEY가 필요합니다. .env에 먼저 입력하세요.');
        process.exitCode = 1;
        return;
      }

      const rl = createInterface({ input, output });
      try {
        const defaultRedirect = process.env['KAKAO_REDIRECT_URI'] ?? '';
        const redirectUri = (await rl.question(
          `Redirect URI를 입력하세요${defaultRedirect ? ` (기본: ${defaultRedirect})` : ''}: `
        )).trim() || defaultRedirect;

        if (!redirectUri) {
          console.error('Redirect URI가 필요합니다.');
          process.exitCode = 1;
          return;
        }

        const authUrl = new URL('https://kauth.kakao.com/oauth/authorize');
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', restApiKey);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', 'talk_message');

        console.log('\n1) 아래 URL을 브라우저에서 열어 로그인하세요:');
        console.log(authUrl.toString());
        console.log('\n2) 리다이렉트된 주소의 code 값을 복사해 입력하세요.');

        const code = (await rl.question('Authorization Code: ')).trim();
        if (!code) {
          console.error('Authorization Code가 필요합니다.');
          process.exitCode = 1;
          return;
        }

        const clientSecret = process.env['KAKAO_CLIENT_SECRET'];

        const tokenResponse = await fetch('https://kauth.kakao.com/oauth/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: restApiKey,
            redirect_uri: redirectUri,
            code,
            ...(clientSecret ? { client_secret: clientSecret } : {}),
          }),
        });

        if (!tokenResponse.ok) {
          const errorBody = await tokenResponse.text();
          console.error(`토큰 발급 실패: ${tokenResponse.status} ${tokenResponse.statusText}`);
          console.error(errorBody);
          process.exitCode = 1;
          return;
        }

        const data = await tokenResponse.json() as {
          access_token: string;
          refresh_token: string;
        };

        const tokensPath = resolve('config', 'kakao.tokens.json');
        mkdirSync(resolve('config'), { recursive: true });
        writeFileSync(tokensPath, JSON.stringify({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          restApiKey,
          updatedAt: new Date().toISOString(),
        }, null, 2));

        upsertEnvFile({
          KAKAO_ACCESS_TOKEN: data.access_token,
          KAKAO_REFRESH_TOKEN: data.refresh_token,
          KAKAO_REST_API_KEY: restApiKey,
          KAKAO_REDIRECT_URI: redirectUri,
          ...(clientSecret ? { KAKAO_CLIENT_SECRET: clientSecret } : {}),
        });

        console.log('\n✅ 토큰 발급 완료');
        console.log(`- 저장 파일: ${tokensPath}`);
        console.log('- .env 업데이트 완료');
      } finally {
        rl.close();
      }
    });

  return program;
}

function upsertEnvFile(values: Record<string, string>): void {
  const envPath = resolve('.env');
  const existing = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
  const lines = existing.split('\n');
  const keys = Object.keys(values);

  const used = new Set<string>();
  const updated = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match) return line;
    const key = match[1];
    if (key && values[key] !== undefined) {
      used.add(key);
      return `${key}=${values[key]}`;
    }
    return line;
  });

  for (const key of keys) {
    if (!used.has(key)) {
      updated.push(`${key}=${values[key]}`);
    }
  }

  writeFileSync(envPath, updated.join('\n'));
}
