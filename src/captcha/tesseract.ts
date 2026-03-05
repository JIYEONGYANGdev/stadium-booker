import Tesseract from 'tesseract.js';
import { logger } from '../utils/logger.js';

export interface OcrResult {
  text: string;
  confidence: number;
}

export async function recognizeWithTesseract(
  imageBuffer: Buffer,
  lang: string = 'eng',
  confidenceThreshold: number = 70,
): Promise<OcrResult> {
  logger.debug('Tesseract OCR 시작...');

  const { data } = await Tesseract.recognize(imageBuffer, lang, {
    logger: (info) => {
      if (info.status === 'recognizing text') {
        logger.debug(`OCR 진행: ${Math.round((info.progress ?? 0) * 100)}%`);
      }
    },
  });

  const text = data.text
    .trim()
    .replace(/\s/g, '')
    .replace(/[^0-9A-Za-z가-힣]/g, '');

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
