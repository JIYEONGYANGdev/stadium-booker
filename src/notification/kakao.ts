import { logger } from '../utils/logger.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

interface KakaoTokens {
  accessToken: string;
  refreshToken?: string;
  restApiKey?: string;
  clientSecret?: string;
}

const TOKENS_FILE = resolve('config', 'kakao.tokens.json');

interface KakaoTokensFile extends Partial<KakaoTokens> {
  updatedAt?: string;
}

function loadTokensFile(): KakaoTokensFile {
  if (!existsSync(TOKENS_FILE)) return {};
  try {
    const raw = readFileSync(TOKENS_FILE, 'utf-8');
    const data = JSON.parse(raw) as KakaoTokensFile;
    return data ?? {};
  } catch {
    return {};
  }
}

function saveTokensFile(tokens: Partial<KakaoTokens>, updatedAt: string = new Date().toISOString()): void {
  mkdirSync(resolve('config'), { recursive: true });
  const payload: KakaoTokensFile = { ...tokens, updatedAt };
  writeFileSync(TOKENS_FILE, JSON.stringify(payload, null, 2));
}

function getTokens(): KakaoTokens {
  const fileTokens = loadTokensFile();
  // 파일 토큰이 더 최신이면 파일 우선 사용 (env는 프로세스 시작 시 고정됨)
  const fileAccessToken = fileTokens.accessToken;
  const fileRefreshToken = fileTokens.refreshToken;
  const envAccessToken = process.env['KAKAO_ACCESS_TOKEN'];
  const envRefreshToken = process.env['KAKAO_REFRESH_TOKEN'];
  const envRestApiKey = process.env['KAKAO_REST_API_KEY'];
  const envClientSecret = process.env['KAKAO_CLIENT_SECRET'];

  // 파일이 env보다 최신일 수 있으므로 파일 우선
  const accessToken = fileAccessToken ?? envAccessToken;
  if (!accessToken) {
    throw new Error(
      'KAKAO_ACCESS_TOKEN이 설정되지 않았습니다. ' +
      '`npx stadium-booker tokens kakao-init` 를 실행하세요.'
    );
  }

  const refreshToken = fileRefreshToken ?? envRefreshToken;
  const restApiKey = envRestApiKey ?? fileTokens.restApiKey;
  const clientSecret = envClientSecret ?? fileTokens.clientSecret;

  return {
    accessToken,
    refreshToken,
    restApiKey,
    clientSecret,
  };
}

async function refreshAccessToken(tokens: KakaoTokens): Promise<string> {
  if (!tokens.refreshToken || !tokens.restApiKey) {
    throw new Error('토큰 갱신에 필요한 KAKAO_REFRESH_TOKEN 또는 KAKAO_REST_API_KEY가 없습니다.');
  }

  logger.info('카카오 Access Token 갱신 중...');

  const params: Record<string, string> = {
    grant_type: 'refresh_token',
    client_id: tokens.restApiKey,
    refresh_token: tokens.refreshToken,
  };

  // client_secret이 설정된 경우 포함 (카카오 앱 보안 설정에 따라 필수)
  if (tokens.clientSecret) {
    params['client_secret'] = tokens.clientSecret;
  }

  const response = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(`토큰 갱신 응답: ${errorBody}`);
    throw new Error(`토큰 갱신 실패: ${response.status} ${response.statusText} - ${errorBody}`);
  }

  const data = await response.json() as { access_token: string; refresh_token?: string };
  logger.info('카카오 Access Token 갱신 완료');

  // 파일에 저장 (다음 실행 시 파일에서 최신 토큰 로드)
  saveTokensFile({
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? tokens.refreshToken,
    restApiKey: tokens.restApiKey,
    clientSecret: tokens.clientSecret,
  });

  // 런타임 env도 업데이트 (현재 프로세스용)
  process.env['KAKAO_ACCESS_TOKEN'] = data.access_token;
  if (data.refresh_token) {
    process.env['KAKAO_REFRESH_TOKEN'] = data.refresh_token;
  }

  return data.access_token;
}

export async function sendKakaoMessage(
  message: string,
  linkUrl?: string,
  options?: { buttonTitle?: string | null },
): Promise<boolean> {
  const tokens = getTokens();
  let { accessToken } = tokens;

  const resolvedLink = linkUrl ?? process.env['KAKAO_MYPAGE_URL'];
  if (!resolvedLink) {
    throw new Error('카카오 메시지 링크가 없습니다. notification.kakao.mypage_url 또는 KAKAO_MYPAGE_URL을 설정하세요.');
  }

  const templateObject: Record<string, unknown> = {
    object_type: 'text',
    text: message,
    link: {
      web_url: resolvedLink,
      mobile_web_url: resolvedLink,
    },
  };

  // buttonTitle: undefined → 기본값 '결제하러 가기', string → 커스텀, null → 버튼 숨김
  const buttonTitle = options?.buttonTitle;
  if (buttonTitle !== null) {
    templateObject.button_title = buttonTitle ?? '결제하러 가기';
  }

  const sendRequest = async (token: string): Promise<Response> => {
    return fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        template_object: JSON.stringify(templateObject),
      }),
    });
  };

  let response = await sendRequest(accessToken);

  // 토큰 만료 시 갱신 후 재시도
  if (response.status === 401) {
    logger.warn('카카오 Access Token 만료, 갱신 시도...');
    accessToken = await refreshAccessToken(tokens);
    response = await sendRequest(accessToken);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(`카카오 메시지 전송 실패: ${response.status} - ${errorBody}`);
    return false;
  }

  logger.info('카카오톡 메시지 전송 성공');
  return true;
}

function maskToken(value?: string): string | undefined {
  if (!value) return undefined;
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export interface CalendarEventParams {
  title: string;
  startAt: Date;
  endAt: Date;
  description?: string;
  location?: string;
  reminders?: number[];
}

export async function createCalendarEvent(params: CalendarEventParams): Promise<string | null> {
  const tokens = getTokens();
  let { accessToken } = tokens;

  const event: Record<string, unknown> = {
    title: params.title.slice(0, 50),
    time: {
      start_at: params.startAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      end_at: params.endAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      time_zone: 'Asia/Seoul',
      all_day: false,
      lunar: false,
    },
    reminders: params.reminders ?? [30],
    color: 'GREEN',
  };

  if (params.description) {
    event.description = params.description.slice(0, 5000);
  }

  if (params.location) {
    event.location = { name: params.location };
  }

  const sendRequest = async (token: string): Promise<Response> => {
    return fetch('https://kapi.kakao.com/v2/api/calendar/create/event', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ event: JSON.stringify(event) }),
    });
  };

  let response = await sendRequest(accessToken);

  if (response.status === 401) {
    logger.warn('카카오 Access Token 만료, 갱신 시도...');
    accessToken = await refreshAccessToken(tokens);
    response = await sendRequest(accessToken);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(`톡캘린더 일정 생성 실패: ${response.status} - ${errorBody}`);
    return null;
  }

  const data = await response.json() as { event_id?: string };
  logger.info(`톡캘린더 일정 생성 완료: ${data.event_id}`);
  return data.event_id ?? null;
}

export function getKakaoTokenStatus(): {
  hasFile: boolean;
  updatedAt?: string;
  accessToken?: string;
  refreshToken?: string;
  restApiKey?: string;
  source: 'env' | 'file' | 'mixed' | 'missing';
} {
  const fileTokens = loadTokensFile();
  const envAccessToken = process.env['KAKAO_ACCESS_TOKEN'];
  const envRefreshToken = process.env['KAKAO_REFRESH_TOKEN'];
  const envRestApiKey = process.env['KAKAO_REST_API_KEY'];

  const hasEnv = Boolean(envAccessToken || envRefreshToken || envRestApiKey);
  const hasFile = Boolean(fileTokens.accessToken || fileTokens.refreshToken || fileTokens.restApiKey);

  let source: 'env' | 'file' | 'mixed' | 'missing' = 'missing';
  if (hasEnv && hasFile) source = 'mixed';
  else if (hasEnv) source = 'env';
  else if (hasFile) source = 'file';

  // 파일 우선 (갱신된 토큰이 파일에 저장됨)
  return {
    hasFile,
    updatedAt: fileTokens.updatedAt,
    accessToken: maskToken(fileTokens.accessToken ?? envAccessToken),
    refreshToken: maskToken(fileTokens.refreshToken ?? envRefreshToken),
    restApiKey: maskToken(envRestApiKey ?? fileTokens.restApiKey),
    source,
  };
}
