import type { SiteAdapter } from './base-site.js';
import { YangjuSiteAdapter } from './yangju.js';

const registry = new Map<string, () => SiteAdapter>();

// 사이트 어댑터 등록
registry.set('yangju', () => new YangjuSiteAdapter());

export function getSiteAdapter(name: string): SiteAdapter {
  const factory = registry.get(name);
  if (!factory) {
    const available = Array.from(registry.keys()).join(', ');
    throw new Error(
      `사이트 어댑터 "${name}"을 찾을 수 없습니다. 사용 가능: ${available}`
    );
  }
  return factory();
}

export function getAvailableSites(): string[] {
  return Array.from(registry.keys());
}

export function registerSite(name: string, factory: () => SiteAdapter): void {
  registry.set(name, factory);
}
