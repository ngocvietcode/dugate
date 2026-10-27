// lib/secrets/index.ts
// Secret provider selection + singleton accessor.

import type { SecretProvider } from './types';
import { VaultSecretProvider } from './vault-provider';
import { DevSecretProvider } from './dev-provider';
import { SECRET_PROVIDER } from '@/lib/config';

export type { SecretProvider } from './types';
export { parseSecretRef } from './types';

let instance: SecretProvider | null = null;

export function getSecretProvider(): SecretProvider {
  if (instance) return instance;
  instance = SECRET_PROVIDER === 'vault' ? new VaultSecretProvider() : new DevSecretProvider();
  return instance;
}

/** Test hook: override the provider (used by unit tests). */
export function __setSecretProviderForTest(p: SecretProvider | null): void {
  instance = p;
}
