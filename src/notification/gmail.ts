import { logger } from '../utils/logger.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

async function getAccessToken(): Promise<string | null> {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  const refreshToken = process.env['GOOGLE_REFRESH_TOKEN'];
  if (!clientId || !clientSecret || !refreshToken) return null;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    logger.error(`Gmail 토큰 갱신 실패: ${response.status}`);
    return null;
  }

  const data = (await response.json()) as { access_token?: string };
  return data.access_token ?? null;
}

function buildMimeMessage(options: {
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  inlineImage?: { cid: string; contentType: string; base64Data: string };
}): string {
  const boundary = `boundary_${Date.now()}`;
  const { to, subject, textBody, htmlBody, inlineImage } = options;

  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;

  if (!inlineImage) {
    // Simple text/html email
    const lines = [
      `To: ${to}`,
      `Subject: ${encodedSubject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      textBody,
    ];

    if (htmlBody) {
      lines.push(
        `--${boundary}`,
        'Content-Type: text/html; charset=UTF-8',
        '',
        htmlBody,
      );
    }

    lines.push(`--${boundary}--`);
    return lines.join('\r\n');
  }

  // Email with inline image
  const relatedBoundary = `related_${Date.now()}`;
  const lines = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
    '',
    `--${relatedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    textBody,
  ];

  if (htmlBody) {
    lines.push(
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      htmlBody,
    );
  }

  lines.push(
    `--${boundary}--`,
    `--${relatedBoundary}`,
    `Content-Type: ${inlineImage.contentType}`,
    `Content-Transfer-Encoding: base64`,
    `Content-ID: <${inlineImage.cid}>`,
    '',
    inlineImage.base64Data,
    `--${relatedBoundary}--`,
  );

  return lines.join('\r\n');
}

export async function sendGmail(options: {
  subject: string;
  textBody: string;
  htmlBody?: string;
  inlineImage?: { cid: string; contentType: string; base64Data: string };
}): Promise<boolean> {
  const to = process.env['GMAIL_TO'];
  if (!to) {
    logger.debug('GMAIL_TO 미설정, 이메일 알림 건너뜀');
    return false;
  }

  const accessToken = await getAccessToken();
  if (!accessToken) {
    logger.warn('Gmail 액세스 토큰 획득 실패');
    return false;
  }

  const raw = buildMimeMessage({ to, ...options });
  const encodedMessage = Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const response = await fetch(GMAIL_SEND_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encodedMessage }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(`Gmail 전송 실패: ${response.status} - ${errorBody}`);
    return false;
  }

  logger.info('Gmail 알림 전송 성공');
  return true;
}

export async function sendBookingSuccessEmail(params: {
  targetDate: string;
  slotTime: string;
  facility: string;
  court: string;
  mypageUrl?: string;
  monthlyCount: number;
  monthlyDetails: string;
  timestamp: string;
}): Promise<boolean> {
  const { targetDate, slotTime, facility, court, mypageUrl, monthlyCount, monthlyDetails, timestamp } = params;

  const subject = `[예약 성공] ${facility} ${court} - ${targetDate} ${slotTime}`;

  const textBody = [
    '결제대기중입니다. 마이페이지에서 결제하세요.',
    '',
    `예약 성공: ${targetDate} ${slotTime}`,
    `시설: ${facility} ${court}`,
    '',
    `이번달 예약 성공: ${monthlyCount}건`,
    monthlyDetails,
    '',
    `⏰ ${timestamp}`,
    mypageUrl ? `\n결제: ${mypageUrl}` : '',
  ].join('\n');

  const htmlBody = `
<div style="font-family:-apple-system,sans-serif;max-width:500px;margin:0 auto;padding:20px;">
  <h2 style="color:#2e7d32;">예약 성공</h2>
  <div style="background:#e8f5e9;padding:16px;border-radius:8px;margin:12px 0;">
    <p style="font-size:18px;font-weight:bold;margin:0;">${targetDate} ${slotTime}</p>
    <p style="color:#555;margin:4px 0 0;">${facility} ${court}</p>
  </div>
  ${mypageUrl ? `<a href="${mypageUrl}" style="display:inline-block;padding:12px 24px;background:#1976d2;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;margin:12px 0;">결제하러 가기</a>` : ''}
  <p style="color:#888;font-size:13px;margin-top:16px;">이번달 예약 성공: ${monthlyCount}건</p>
  <pre style="color:#666;font-size:12px;">${monthlyDetails}</pre>
  <p style="color:#aaa;font-size:12px;">⏰ ${timestamp}</p>
</div>`;

  return sendGmail({ subject, textBody, htmlBody });
}

export async function sendBookingFailureEmail(params: {
  reservationName: string;
  errorMessage: string;
  stage?: string;
  screenshotUrl?: string;
  timestamp: string;
}): Promise<boolean> {
  const { reservationName, errorMessage, stage, screenshotUrl, timestamp } = params;

  const subject = `[예약 실패] ${reservationName}`;

  const textBody = [
    `예약 실패: ${reservationName}`,
    '',
    errorMessage,
    stage ? `단계: ${stage}` : '',
    screenshotUrl ? `스크린샷: ${screenshotUrl}` : '',
    '',
    `⏰ ${timestamp}`,
  ].filter(Boolean).join('\n');

  const htmlBody = `
<div style="font-family:-apple-system,sans-serif;max-width:500px;margin:0 auto;padding:20px;">
  <h2 style="color:#c62828;">예약 실패</h2>
  <div style="background:#ffebee;padding:16px;border-radius:8px;margin:12px 0;">
    <p style="font-weight:bold;margin:0;">${reservationName}</p>
    <p style="color:#555;margin:8px 0 0;">${errorMessage}</p>
    ${stage ? `<p style="color:#888;margin:4px 0 0;">단계: ${stage}</p>` : ''}
  </div>
  ${screenshotUrl ? `<p><a href="${screenshotUrl}">스크린샷 보기</a></p>` : ''}
  <p style="color:#aaa;font-size:12px;">⏰ ${timestamp}</p>
</div>`;

  return sendGmail({ subject, textBody, htmlBody });
}

export async function sendCaptchaEmail(params: {
  publicUrl: string;
  timeoutSec: number;
  imageBase64?: string;
}): Promise<boolean> {
  const { publicUrl, timeoutSec, imageBase64 } = params;

  const subject = `[CAPTCHA 입력 필요] ${timeoutSec}초 이내 입력`;

  const textBody = [
    'CAPTCHA 입력이 필요합니다.',
    `${timeoutSec}초 이내에 아래 링크를 열어 입력해주세요.`,
    '',
    publicUrl,
  ].join('\n');

  const cid = 'captcha-image';

  const htmlBody = `
<div style="font-family:-apple-system,sans-serif;max-width:500px;margin:0 auto;padding:20px;">
  <h2 style="color:#e65100;">CAPTCHA 입력 필요</h2>
  <p>${timeoutSec}초 이내에 입력해주세요.</p>
  ${imageBase64 ? `<img src="cid:${cid}" style="max-width:300px;border:2px solid #333;border-radius:8px;margin:12px 0;" alt="CAPTCHA">` : ''}
  <a href="${publicUrl}" style="display:inline-block;padding:14px 28px;background:#e65100;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:16px;margin:12px 0;">CAPTCHA 입력하기</a>
</div>`;

  return sendGmail({
    subject,
    textBody,
    htmlBody,
    inlineImage: imageBase64
      ? { cid, contentType: 'image/png', base64Data: imageBase64 }
      : undefined,
  });
}
