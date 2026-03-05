import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import { logger } from '../utils/logger.js';

export interface OcrResult {
  text: string;
  confidence: number;
}

/**
 * CAPTCHA 이미지 전처리: 그레이스케일 → 대비 강화 → 이진화 → 확대
 */
async function preprocessCaptcha(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer)
    .greyscale()
    .normalize()                    // 대비 자동 조정
    .threshold(140)                 // 이진화 (밝은 배경 + 어두운 글자 기준)
    .resize({ width: 600, kernel: 'lanczos3' }) // 2~3배 확대
    .sharpen()
    .png()
    .toBuffer();
}

export async function recognizeWithTesseract(
  imageBuffer: Buffer,
  lang: string = 'eng',
  confidenceThreshold: number = 70,
): Promise<OcrResult> {
  logger.debug('Tesseract OCR 시작...');

  // 전처리된 이미지로 인식
  const processed = await preprocessCaptcha(imageBuffer);

  const { data } = await Tesseract.recognize(processed, lang, {
    logger: (info) => {
      if (info.status === 'recognizing text') {
        logger.debug(`OCR 진행: ${Math.round((info.progress ?? 0) * 100)}%`);
      }
    },
  });

  const text = data.text
    .trim()
    .replace(/\s/g, '')
    .replace(/[^0-9A-Za-z]/g, '');  // CAPTCHA는 영숫자만

  const confidence = data.confidence;

  logger.info(`Tesseract 결과: "${text}" (신뢰도: ${confidence}%)`);

  if (confidence < confidenceThreshold) {
    throw new TesseractLowConfidenceError(text, confidence, confidenceThreshold);
  }

  return { text, confidence };
}

export class TesseractLowConfidenceError extends Error {
  constructor(
    public readonly text: string,
    public readonly confidence: number,
    public readonly threshold: number,
  ) {
    super(
      `Tesseract 신뢰도 부족: ${confidence}% < ${threshold}% (결과: "${text}")`
    );
    this.name = 'TesseractLowConfidenceError';
  }
}
