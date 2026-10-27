// lib/pipelines/workflows/payment-account-management/shared/webhook-transform.ts
//
// PAM-specific webhook payload transform: AES-256-GCM + RSA-OAEP-256.
// Passed as ctx.transformWebhookPayload — engine calls it just before dispatch.
// DB always stores the plain payload; only the wire body is encrypted.

import { encryptPayload } from '@/lib/crypto/payload-encrypt';
import type { WorkflowContext } from '@/lib/pipelines/workflow-engine';

/**
 * Build a transformWebhookPayload function bound to this context.
 * Returns undefined when partner_public_key is not configured — engine falls back to plain JSON.
 */
export function buildPamWebhookTransform(
  ctx: WorkflowContext,
): WorkflowContext['transformWebhookPayload'] {
  const publicKeyPem = (ctx.pipelineVars.partner_public_key as string | undefined)?.trim();
  if (!publicKeyPem) return undefined;

  return async (payload: object) => {
    const plaintext = JSON.stringify(payload);
    const { encryptedPayload, nonce, encKey } = encryptPayload(plaintext, publicKeyPem);
    ctx.logger.info('[PAM] Webhook payload encrypted (AES-256-GCM + RSA-OAEP-256)');
    return {
      body: JSON.stringify({
        encrypt_mode: 'full',
        nonce,
        encrypted_key: encKey,
        encrypted_payload: encryptedPayload,
      }),
      headers: {},
    };
  };
}
