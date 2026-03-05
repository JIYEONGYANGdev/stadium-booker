import inquirer from 'inquirer';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { stringify as toYaml } from 'yaml';
import { getAvailableSites } from '../sites/index.js';

export async function createConfigInteractively(): Promise<void> {
  console.log('\n🏟️  Stadium Booker 설정 생성\n');

  const sites = getAvailableSites();

  const { site } = await inquirer.prompt([{
    type: 'list',
    name: 'site',
    message: '예약 사이트를 선택하세요:',
    choices: sites,
  }]);

  const credentials = await inquirer.prompt([
    { type: 'input', name: 'id', message: `${site} 아이디:` },
    { type: 'password', name: 'password', message: `${site} 비밀번호:` },
  ]);

  const reservation = await inquirer.prompt([
    { type: 'input', name: 'name', message: '예약 이름 (예: 주말 풋살):' },
    { type: 'input', name: 'facility', message: '시설 이름 (예: 마포구민체육센터):' },
    { type: 'input', name: 'court', message: '구장 이름 (예: 풋살장 A):' },
  ]);

  const slot = await inquirer.prompt([
    {
      type: 'list',
      name: 'day',
      message: '선호 요일:',
      choices: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    },
    { type: 'input', name: 'time', message: '선호 시간 (예: 18:00-20:00):' },
  ]);

  const schedule = await inquirer.prompt([
    {
      type: 'list',
      name: 'type',
      message: '예약 오픈 주기:',
      choices: [
        { name: '매월', value: 'monthly' },
        { name: '매주', value: 'weekly' },
        { name: '매일', value: 'daily' },
      ],
    },
    {
      type: 'input',
      name: 'time',
      message: '오픈 시간 (예: 10:00:00):',
      default: '10:00:00',
    },
  ]);

  let scheduleExtra: Record<string, unknown> = {};
  if (schedule.type === 'monthly') {
    const { day } = await inquirer.prompt([{
      type: 'number',
      name: 'day',
      message: '오픈 일자 (1-31):',
      default: 1,
    }]);
    scheduleExtra = { day };
  } else if (schedule.type === 'weekly') {
    const { day_of_week } = await inquirer.prompt([{
      type: 'list',
      name: 'day_of_week',
      message: '오픈 요일:',
      choices: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    }]);
    scheduleExtra = { day_of_week };
  }

  const config = {
    credentials: {
      [site]: {
        id: `\${${site.toUpperCase()}_ID}`,
        password: `\${${site.toUpperCase()}_PW}`,
      },
    },
    reservations: [
      {
        name: reservation.name,
        site,
        facility: reservation.facility,
        court: reservation.court,
        preferred_slots: [{ day: slot.day, time: slot.time }],
        open_schedule: { type: schedule.type, ...scheduleExtra, time: schedule.time },
        retry: { max_attempts: 3, delay_ms: 500 },
      },
    ],
    captcha: {
      primary: 'tesseract',
      tesseract: { lang: 'eng', confidence_threshold: 70 },
      manual_fallback: true,
    },
    notification: {
      kakao: {
        enabled: true,
        on_success: true,
        on_failure: true,
        on_cart_added: true,
      },
    },
    browser: {
      headless: true,
      block_images: false,
      block_css: true,
      timeout_ms: 30000,
    },
  };

  // Save config
  mkdirSync(resolve('config'), { recursive: true });
  const configPath = resolve('config', 'config.yaml');
  writeFileSync(configPath, toYaml(config));
  console.log(`\n✅ 설정 파일 생성: ${configPath}`);

  // Save .env
  const envContent = [
    `${site.toUpperCase()}_ID=${credentials.id}`,
    `${site.toUpperCase()}_PW=${credentials.password}`,
    '',
    '# 카카오 API (알림용)',
    'KAKAO_REST_API_KEY=',
    'KAKAO_ACCESS_TOKEN=',
    'KAKAO_REFRESH_TOKEN=',
    'KAKAO_MYPAGE_URL=',
    '',
  ].join('\n');

  writeFileSync(resolve('.env'), envContent);
  console.log(`✅ 환경변수 파일 생성: .env`);
  console.log('\n⚠️  .env 파일의 API 키를 입력한 후 사용하세요.');
  console.log('💡 테스트: stadium-booker test login --site ' + site);
}
