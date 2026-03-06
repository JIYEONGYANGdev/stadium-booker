import OpenAI from 'openai';
import { logger } from '../utils/logger.js';

export async function recognizeWithOpenAI(imageBuffer: Buffer): Promise<string> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY 환경변수가 설정되지 않았습니다.');
  }

  const client = new OpenAI({ apiKey });
  const base64 = imageBuffer.toString('base64');

  logger.info('OpenAI Vision CAPTCHA 인식 중...');

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 20,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${base64}` },
          },
          {
            type: 'text',
            text: '이 CAPTCHA 이미지에 보이는 숫자를 정확히 읽어주세요. 숫자만 응답하세요. 다른 설명 없이 숫자만.',
          },
        ],
      },
    ],
  });

  const text = (response.choices[0]?.message?.content ?? '')
    .trim()
    .replace(/[^0-9]/g, '');

  logger.info(`OpenAI Vision 결과: "${text}"`);

  if (text.length === 0) {
    throw new Error('OpenAI Vision: 숫자를 인식하지 못했습니다.');
  }

  return text;
}
