import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { logger } from './logger.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const PERMISSIONS_URL = 'https://www.googleapis.com/drive/v3/files';

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

  if (!response.ok) return null;

  const data = (await response.json()) as { access_token?: string };
  return data.access_token ?? null;
}

export async function uploadScreenshot(imagePath: string): Promise<string | null> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    logger.warn('Google Drive 인증 정보가 없어 스크린샷 업로드를 건너뜁니다.');
    return null;
  }

  try {
    const imageBuffer = readFileSync(imagePath);
    const fileName = basename(imagePath);
    const folderId = process.env['GOOGLE_DRIVE_FOLDER_ID'];

    // multipart/related 요청 생성
    const boundary = '---screenshot-upload-boundary';
    const metadata: Record<string, unknown> = {
      name: fileName,
      mimeType: 'image/png',
    };
    if (folderId) {
      metadata.parents = [folderId];
    }

    const multipartBody = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: image/png',
      'Content-Transfer-Encoding: base64',
      '',
      imageBuffer.toString('base64'),
      `--${boundary}--`,
    ].join('\r\n');

    // 파일 업로드
    const uploadRes = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    if (!uploadRes.ok) {
      logger.warn(`Google Drive 업로드 실패: HTTP ${uploadRes.status}`);
      return null;
    }

    const file = (await uploadRes.json()) as { id?: string };
    if (!file.id) {
      logger.warn('Google Drive 응답에 파일 ID가 없습니다.');
      return null;
    }

    // 공개 권한 설정 (누구나 링크로 보기 가능)
    await fetch(`${PERMISSIONS_URL}/${file.id}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });

    const viewUrl = `https://drive.google.com/file/d/${file.id}/view`;
    logger.info(`스크린샷 업로드 완료: ${viewUrl}`);
    return viewUrl;
  } catch (error) {
    logger.warn(`Google Drive 업로드 중 오류: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
