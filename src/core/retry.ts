import { logger } from '../utils/logger.js';
import { sleep } from '../utils/time.js';

export interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  delayMs: 500,
  backoffMultiplier: 1.5,
};

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  const opts = { ...DEFAULT_RETRY, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < opts.maxAttempts) {
        const delay = opts.delayMs * Math.pow(opts.backoffMultiplier ?? 1.5, attempt - 1);
        logger.warn(`시도 ${attempt}/${opts.maxAttempts} 실패: ${lastError.message}. ${delay}ms 후 재시도...`);
        opts.onRetry?.(attempt, lastError);
        await sleep(delay);
      } else {
        logger.error(`모든 시도 실패 (${opts.maxAttempts}회): ${lastError.message}`);
      }
    }
  }

  throw lastError;
}
