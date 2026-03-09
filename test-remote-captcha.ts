import { requestRemoteCaptchaInput } from './src/captcha/remote-input.js';

// 실제 사이트에서 CAPTCHA 이미지 직접 다운로드
const captchaUrl = `https://reserve.yjuc.or.kr/captchaImg.do?rand=${Math.random()}`;
console.log(`CAPTCHA 이미지 다운로드: ${captchaUrl}`);

const response = await fetch(captchaUrl);
if (!response.ok) {
  console.error(`다운로드 실패: ${response.status}`);
  process.exit(1);
}
const imageBuffer = Buffer.from(await response.arrayBuffer());
console.log(`이미지 크기: ${imageBuffer.length} bytes\n`);

console.log('원격 CAPTCHA 입력 서버 시작 중...');
console.log('(180초 타임아웃, 카카오톡 알림 ON)\n');

const result = await requestRemoteCaptchaInput(imageBuffer, {
  timeout_ms: 180_000,
  notify: true,
});

if (result) {
  console.log(`\n입력된 CAPTCHA: "${result}"`);
} else {
  console.log('\n타임아웃 또는 실패');
}

process.exit(0);
