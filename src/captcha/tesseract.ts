import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import { logger } from '../utils/logger.js';

export interface OcrResult {
  text: string;
  confidence: number;
}

/**
 * 여러 전처리 변형을 생성하여 최적 결과를 찾는다.
 * 양주시 CAPTCHA: 어두운 배경 + 밝은 숫자 6자리 + 가로 방해선
 * → 반전 → median(노이즈/선 제거) → 이진화 → 확대
 */
async function preprocessVariants(imageBuffer: Buffer): Promise<Buffer[]> {
  const variants: Promise<Buffer>[] = [
    // 변형1: 반전 + median3(얇은 선 제거) + threshold 120 + 확대
    sharp(imageBuffer).greyscale().normalize().negate().median(3)
      .threshold(120).resize({ width: 600, kernel: 'lanczos3' }).sharpen().png().toBuffer(),
    // 변형2: 반전 + median5(더 강한 선 제거) + threshold 100
    sharp(imageBuffer).greyscale().normalize().negate().median(5)
      .threshold(100).resize({ width: 600, kernel: 'lanczos3' }).sharpen().png().toBuffer(),
    // 변형3: 반전 + median3 + threshold 150
    sharp(imageBuffer).greyscale().normalize().negate().median(3)
      .threshold(150).resize({ width: 600, kernel: 'lanczos3' }).sharpen().png().toBuffer(),
    // 변형4: 반전 + median 없이 + threshold 130 (선이 약한 경우)
    sharp(imageBuffer).greyscale().normalize().negate()
      .threshold(130).resize({ width: 600, kernel: 'lanczos3' }).sharpen().png().toBuffer(),
  ];

  return Promise.all(variants);
}

export async function recognizeWithTesseract(
  imageBuffer: Buffer,
  lang: string = 'eng',
  confidenceThreshold: number = 70,
): Promise<OcrResult> {
  logger.debug('Tesseract OCR 시작 (다중 전처리 변형)...');

  const variants = await preprocessVariants(imageBuffer);
  let bestResult: OcrResult = { text: '', confidence: 0 };

  for (let i = 0; i < variants.length; i++) {
    try {
      const { data } = await Tesseract.recognize(variants[i], lang);

      // 숫자만 추출 + 오인식 보정
      let text = data.text.trim().replace(/\s/g, '');
      text = text
        .replace(/[OoQD]/g, '0')
        .replace(/[IilL|]/g, '1')
        .replace(/[Ss]/g, '5')
        .replace(/[Bb]/g, '8')
        .replace(/[Zz]/g, '2')
        .replace(/[^0-9]/g, '');

      logger.info(`변형${i + 1} 결과: "${text}" (신뢰도: ${data.confidence}%, 길이: ${text.length})`);

      // 5~6자리 숫자가 나오면 신뢰도 무관하게 채택 (틀리면 새로고침 후 재시도)
      if (text.length >= 5 && text.length <= 6) {
        logger.info(`${text.length}자리 숫자 채택: "${text}" (변형${i + 1}, 신뢰도: ${data.confidence}%)`);
        return { text, confidence: 100 };  // 강제 통과
      }

      // 그 외 가장 긴 숫자열 + 높은 신뢰도 선택
      if (text.length > bestResult.text.length ||
          (text.length === bestResult.text.length && data.confidence > bestResult.confidence)) {
        bestResult = { text, confidence: data.confidence };
      }
    } catch (error) {
      logger.debug(`변형${i + 1} 실패: ${error}`);
    }
  }

  logger.info(`Tesseract 최종 결과: "${bestResult.text}" (신뢰도: ${bestResult.confidence}%)`);

  if (bestResult.text.length === 0 || bestResult.confidence < confidenceThreshold) {
    throw new TesseractLowConfidenceError(bestResult.text, bestResult.confidence, confidenceThreshold);
  }

  return bestResult;
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
