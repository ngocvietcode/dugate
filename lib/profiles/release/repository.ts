import { createHash, randomBytes } from 'crypto';
import { and, eq, notInArray } from 'drizzle-orm';
import type { db } from '@/lib/db';
import {
  apiKeys,
  externalApiConnections,
  externalApiOverrides,
  profileEndpoints,
  profileReleases,
} from '@/lib/db/schema';
import type { TransactionLike } from './apply';

type DrizzleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Adapts a real Drizzle transaction to the pure applyBundle repository contract. */
export function createDrizzleAdapter(
  tx: DrizzleTransaction,
  apiKeyId: string,
  profileName: string,
): TransactionLike {
  let resolvedApiKeyId = apiKeyId;
  const adapter: TransactionLike = {
    profile: null,
    endpoints: [],
    revision: 0,
    async update(table, payload) {
      if (table === 'ApiKey') {
        await tx.update(apiKeys).set(payload as any).where(eq(apiKeys.id, resolvedApiKeyId));
        return;
      }

      if (table === 'ProfileEndpoint') {
        const { endpointSlug, ...fields } = payload;
        const [existing] = await tx.select({ id: profileEndpoints.id })
          .from(profileEndpoints)
          .where(and(
            eq(profileEndpoints.apiKeyId, resolvedApiKeyId),
            eq(profileEndpoints.endpointSlug, String(endpointSlug)),
          ))
          .limit(1);

        if (existing) {
          await tx.update(profileEndpoints).set(fields as any).where(eq(profileEndpoints.id, existing.id));
        } else {
          await tx.insert(profileEndpoints).values({
            apiKeyId: resolvedApiKeyId,
            endpointSlug: String(endpointSlug),
            ...fields,
          } as any);
        }
        return;
      }

      if (table === 'ExternalApiOverride') {
        const { endpointSlug, connectorSlug, stepId, ...fields } = payload;
        const [connection] = await tx.select({ id: externalApiConnections.id })
          .from(externalApiConnections)
          .where(eq(externalApiConnections.slug, String(connectorSlug)))
          .limit(1);
        if (!connection) return;

        await tx.insert(externalApiOverrides).values({
          connectionId: connection.id,
          apiKeyId: resolvedApiKeyId,
          endpointSlug: String(endpointSlug),
          stepId: String(stepId ?? '_default'),
          ...fields,
        } as any).onConflictDoUpdate({
          target: [
            externalApiOverrides.connectionId,
            externalApiOverrides.apiKeyId,
            externalApiOverrides.endpointSlug,
            externalApiOverrides.stepId,
          ],
          set: fields as any,
        });
      }
    },
    async insert(table, payload) {
      if (table === 'ApiKey') {
        const rawKey = `dg_${randomBytes(32).toString('base64url')}`;
        const keyHash = createHash('sha256').update(rawKey).digest('hex');
        const [created] = await tx.insert(apiKeys).values({
          name: String(payload.name),
          displayName: payload.displayName as any,
          status: payload.status as any,
          role: payload.role as any,
          note: payload.note as any,
          keyHash,
          prefix: rawKey.slice(0, 7),
        }).returning({ id: apiKeys.id });
        if (!created) throw new Error(`Profile '${profileName}' was not created`);

        resolvedApiKeyId = created.id;
        adapter._rawKey = rawKey;
        return;
      }

      if (table === 'ProfileRelease') {
        await tx.insert(profileReleases).values({
          ...payload,
          apiKeyId: resolvedApiKeyId,
        } as any);
      }
    },
    async delete(table, payload) {
      if (table !== 'ProfileEndpoint' || !Array.isArray(payload.except)) return;
      await tx.delete(profileEndpoints).where(and(
        eq(profileEndpoints.apiKeyId, resolvedApiKeyId),
        notInArray(profileEndpoints.endpointSlug, payload.except as string[]),
      ));
    },
    async deleteOverridesNotIn(endpointSlug, keepKeys) {
      const existingOverrides = await tx.select({
        id: externalApiOverrides.id,
        connectionId: externalApiOverrides.connectionId,
        stepId: externalApiOverrides.stepId,
      })
        .from(externalApiOverrides)
        .where(and(
          eq(externalApiOverrides.apiKeyId, resolvedApiKeyId),
          eq(externalApiOverrides.endpointSlug, endpointSlug),
        ));

      for (const override of existingOverrides) {
        const [connection] = await tx.select({ slug: externalApiConnections.slug })
          .from(externalApiConnections)
          .where(eq(externalApiConnections.id, override.connectionId))
          .limit(1);
        const overrideKey = `${connection?.slug ?? ''}\0${override.stepId ?? '_default'}`;
        if (!keepKeys.includes(overrideKey)) {
          await tx.delete(externalApiOverrides).where(eq(externalApiOverrides.id, override.id));
        }
      }
    },
  };

  return adapter;
}
