import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import type { RemoteCaptchaConfig } from '../config/schema.js';
import { sendKakaoMessage } from '../notification/kakao.js';
import { sendCaptchaEmail } from '../notification/gmail.js';
import { logger } from '../utils/logger.js';

let lastRemoteAttemptTime = 0;

function buildFormHtml(imageBase64: string, token: string, timeoutSec: number): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>CAPTCHA 입력</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #1a1a2e; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { width: 100%; max-width: 400px; padding: 24px; text-align: center; }
    h1 { font-size: 20px; margin-bottom: 16px; color: #e0e0e0; }
    .captcha-img { width: 100%; max-width: 300px; border-radius: 8px; border: 2px solid #333; margin-bottom: 16px; }
    .timer { font-size: 14px; color: #ff6b6b; margin-bottom: 16px; }
    .timer.ok { color: #51cf66; }
    input[type="text"] { width: 100%; padding: 16px; font-size: 24px; text-align: center; border: 2px solid #444; border-radius: 8px; background: #16213e; color: #fff; letter-spacing: 8px; outline: none; }
    input[type="text"]:focus { border-color: #4dabf7; }
    button { width: 100%; margin-top: 12px; padding: 16px; font-size: 18px; font-weight: bold; border: none; border-radius: 8px; background: #4dabf7; color: #fff; cursor: pointer; }
    button:active { background: #339af0; }
    .expired { opacity: 0.5; pointer-events: none; }
  </style>
</head>
<body>
  <div class="container" id="form-container">
    <h1>CAPTCHA 입력</h1>
    <img class="captcha-img" src="data:image/png;base64,${imageBase64}" alt="CAPTCHA">
    <div class="timer ok" id="timer">${timeoutSec}초 남음</div>
    <form method="POST" action="/${token}" id="captcha-form">
      <input type="text" name="answer" id="answer" placeholder="숫자 입력" autocomplete="off" autofocus inputmode="numeric" pattern="[0-9]*">
      <button type="submit">제출</button>
    </form>
  </div>
  <script>
    let remaining = ${timeoutSec};
    const timer = document.getElementById('timer');
    const container = document.getElementById('form-container');
    const interval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(interval);
        timer.textContent = '시간 초과';
        timer.classList.remove('ok');
        container.classList.add('expired');
        return;
      }
      timer.textContent = remaining + '초 남음';
      if (remaining <= 30) { timer.classList.remove('ok'); }
    }, 1000);

    document.getElementById('captcha-form').addEventListener('submit', function(e) {
      const val = document.getElementById('answer').value.trim();
      if (!val) { e.preventDefault(); return; }
    });
  </script>
</body>
</html>`;
}

function buildSuccessHtml(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>완료</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #1a1a2e; color: #51cf66; min-height: 100vh; display: flex; align-items: center; justify-content: center; text-align: center; }
    h1 { font-size: 24px; }
    p { color: #aaa; margin-top: 8px; }
  </style>
</head>
<body>
  <div>
    <h1>CAPTCHA 전송 완료</h1>
    <p>이 페이지를 닫아도 됩니다.</p>
  </div>
</body>
</html>`;
}

/** cloudflared tunnel을 시작하고 공개 URL을 반환 */
function startCloudflaredTunnel(port: number): Promise<{ url: string; process: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    const urlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

    const onData = (data: Buffer) => {
      const text = data.toString();
      const match = text.match(urlPattern);
      if (match && !resolved) {
        resolved = true;
        resolve({ url: match[0], process: proc });
      }
    };

    // cloudflared는 URL을 stderr로 출력
    proc.stderr?.on('data', onData);
    proc.stdout?.on('data', onData);

    proc.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`cloudflared 실행 실패: ${err.message}`));
      }
    });

    proc.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`cloudflared가 종료됨 (code: ${code})`));
      }
    });

    // 15초 내에 URL을 못 얻으면 타임아웃
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        reject(new Error('cloudflared URL 획득 타임아웃'));
      }
    }, 15_000);
  });
}

export async function requestRemoteCaptchaInput(
  imageBuffer: Buffer,
  config?: Partial<RemoteCaptchaConfig>,
): Promise<string | null> {
  const timeoutMs = config?.timeout_ms ?? 180_000;
  const shouldNotify = config?.notify ?? true;

  // 스팸 방지: timeout_ms 이내 재시도 건너뜀
  const now = Date.now();
  if (now - lastRemoteAttemptTime < timeoutMs) {
    logger.warn('원격 CAPTCHA 입력: 최근 시도 후 대기 시간 미경과, 건너뜀');
    return null;
  }
  lastRemoteAttemptTime = now;

  const token = randomUUID();
  const imageBase64 = imageBuffer.toString('base64');
  const timeoutSec = Math.floor(timeoutMs / 1000);

  return new Promise<string | null>((resolve) => {
    let server: Server;
    let tunnelProcess: ChildProcess | null = null;
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      try { tunnelProcess?.kill(); } catch { /* ignore */ }
      try { server.close(); } catch { /* ignore */ }
    };

    const timer = setTimeout(() => {
      logger.warn('원격 CAPTCHA 입력: 타임아웃');
      cleanup();
      resolve(null);
    }, timeoutMs);

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost`);
      const path = url.pathname;

      // GET /{token} → 폼 페이지
      if (req.method === 'GET' && path === `/${token}`) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(buildFormHtml(imageBase64, token, timeoutSec));
        return;
      }

      // POST /{token} → 답변 수신
      if (req.method === 'POST' && path === `/${token}`) {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          const answer = params.get('answer')?.trim().replace(/\D/g, '') ?? '';

          if (answer.length > 0) {
            logger.info(`원격 CAPTCHA 답변 수신: "${answer}"`);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(buildSuccessHtml());
            clearTimeout(timer);
            cleanup();
            resolve(answer);
          } else {
            res.writeHead(302, { Location: `/${token}` });
            res.end();
          }
        });
        return;
      }

      // 그 외 → 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    server.listen(0, async () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      logger.info(`원격 CAPTCHA 서버 시작: 포트 ${port}`);

      try {
        const { url: tunnelUrl, process: proc } = await startCloudflaredTunnel(port);
        tunnelProcess = proc;

        const publicUrl = `${tunnelUrl}/${token}`;
        logger.info(`원격 CAPTCHA URL: ${publicUrl}`);

        // 콘솔에 QR 코드 출력
        try {
          const QRCode = (await import('qrcode')).default;
          const qrText = await QRCode.toString(publicUrl, { type: 'terminal', small: true });
          console.log('\n' + qrText);
        } catch {
          logger.debug('QR 코드 출력 실패 (qrcode 모듈 없음)');
        }

        if (shouldNotify) {
          try {
            // 터널이 실제 동작하는지 헬스체크 후 알림 전송
            let tunnelReady = false;
            for (let hc = 0; hc < 5; hc++) {
              try {
                const check = await fetch(publicUrl, { signal: AbortSignal.timeout(3000) });
                if (check.status === 200) { tunnelReady = true; break; }
              } catch { /* retry */ }
              await new Promise(r => setTimeout(r, 1000));
            }
            if (!tunnelReady) {
              logger.warn('터널 헬스체크 실패, 알림은 전송 시도');
            }

            await Promise.allSettled([
              sendKakaoMessage(
                `[CAPTCHA 입력 필요]\n${timeoutSec}초 이내에 아래 링크를 열어 입력해주세요.\n\n${publicUrl}`,
                publicUrl,
                { buttonTitle: 'CAPTCHA 입력하기' },
              ).then(() => logger.info('카카오톡 CAPTCHA 알림 전송 완료')),
              sendCaptchaEmail({
                publicUrl,
                timeoutSec,
                imageBase64,
              }).then(() => logger.info('Gmail CAPTCHA 알림 전송 완료')),
            ]);
          } catch (err) {
            logger.warn('CAPTCHA 알림 전송 실패:', err);
          }
        }
      } catch (err) {
        logger.error('터널 생성 실패:', err);
        clearTimeout(timer);
        cleanup();
        resolve(null);
      }
    });

    server.on('error', (err) => {
      logger.error('원격 CAPTCHA 서버 오류:', err);
      clearTimeout(timer);
      cleanup();
      resolve(null);
    });
  });
}
