import { logger } from '../utils/logger.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

interface KakaoTokens {
  accessToken: string;
  refreshToken?: string;
  restApiKey?: string;
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
  const envAccessToken = process.env['KAKAO_ACCESS_TOKEN'];
  const envRefreshToken = process.env['KAKAO_REFRESH_TOKEN'];
  const envRestApiKey = process.env['KAKAO_REST_API_KEY'];

  const accessToken = envAccessToken ?? fileTokens.accessToken;
  if (!accessToken) {
    throw new Error(
      'KAKAO_ACCESS_TOKEN이 설정되지 않았습니다. ' +
      '카카오 개발자 콘솔에서 토큰을 발급받으세요.'
    );
  }

  const refreshToken = envRefreshToken ?? fileTokens.refreshToken;
  const restApiKey = envRestApiKey ?? fileTokens.restApiKey;

  // env에 값이 있고 파일이 없거나 값이 다른 경우 파일 저장
  if (
    envAccessToken ||
    envRefreshToken ||
    envRestApiKey
  ) {
    const shouldWrite =
      envAccessToken !== undefined && envAccessToken !== fileTokens.accessToken ||
      envRefreshToken !== undefined && envRefreshToken !== fileTokens.refreshToken ||
      envRestApiKey !== undefined && envRestApiKey !== fileTokens.restApiKey ||
      !existsSync(TOKENS_FILE);

    if (shouldWrite) {
      saveTokensFile({
        accessToken,
        refreshToken,
        restApiKey,
      });
    }
  }

  return {
    accessToken,
    refreshToken,
    restApiKey,
  };
}

async function refreshAccessToken(tokens: KakaoTokens): Promise<string> {
  if (!tokens.refreshToken || !tokens.restApiKey) {
    throw new Error('토큰 갱신에 필요한 KAKAO_REFRESH_TOKEN 또는 KAKAO_REST_API_KEY가 없습니다.');
  }

  logger.info('카카오 Access Token 갱신 중...');

  const response = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: tokens.restApiKey,
      refresh_token: tokens.refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`토큰 갱신 실패: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { access_token: string; refresh_token?: string };
  logger.info('카카오 Access Token 갱신 완료');

  // 런타임 env 업데이트
  if (data.refresh_token) {
    process.env['KAKAO_REFRESH_TOKEN'] = data.refresh_token;
  }
  process.env['KAKAO_ACCESS_TOKEN'] = data.access_token;

  // 파일에 저장
  const fileTokens = loadTokensFile();
  saveTokensFile({
    ...fileTokens,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? fileTokens.refreshToken,
    restApiKey: tokens.restApiKey ?? fileTokens.restApiKey,
  });

  return data.access_token;
}

export async function sendKakaoMessage(message: string, linkUrl?: string): Promise<boolean> {
  const tokens = getTokens();
  let { accessToken } = tokens;

  const resolvedLink = linkUrl ?? process.env['KAKAO_MYPAGE_URL'];
  if (!resolvedLink) {
    throw new Error('카카오 메시지 링크가 없습니다. notification.kakao.mypage_url 또는 KAKAO_MYPAGE_URL을 설정하세요.');
  }

  const templateObject = {
    object_type: 'text',
    text: message,
    link: {
      web_url: resolvedLink,
      mobile_web_url: resolvedLink,
    },
    button_title: '결제하러 가기',
  };

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

  return {
    hasFile,
    updatedAt: fileTokens.updatedAt,
    accessToken: maskToken(envAccessToken ?? fileTokens.accessToken),
    refreshToken: maskToken(envRefreshToken ?? fileTokens.refreshToken),
    restApiKey: maskToken(envRestApiKey ?? fileTokens.restApiKey),
    source,
  };
}
