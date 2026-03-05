import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { config as loadDotenv } from 'dotenv';
import { AppConfigSchema, type AppConfig } from './schema.js';
import { validateConfig } from './validator.js';

loadDotenv();

function substituteEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, key) => {
    const envValue = process.env[key];
    if (!envValue) {
      throw new Error(`환경변수 ${key}가 설정되지 않았습니다. .env 파일을 확인하세요.`);
    }
    return envValue;
  });
}

function deepSubstitute(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return substituteEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(deepSubstitute);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = deepSubstitute(value);
    }
    return result;
  }
  return obj;
}

export function loadConfig(configPath?: string): AppConfig {
  const resolvedPath = resolve(configPath ?? 'config/config.yaml');

  let rawContent: string;
  try {
    rawContent = readFileSync(resolvedPath, 'utf-8');
  } catch {
    throw new Error(`설정 파일을 찾을 수 없습니다: ${resolvedPath}`);
  }

  const parsed = parseYaml(rawContent);
  const substituted = deepSubstitute(parsed);
  const validated = AppConfigSchema.parse(substituted);

  validateConfig(validated);

  return validated;
}
