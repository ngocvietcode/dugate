// Temporal worker TypeScript cho tầng Apps — npm run worker. Worker LAC Python chạy riêng (python -m lac.worker).
import { NativeConnection, Worker } from '@temporalio/worker';
import { createCaseActivities } from './credit-appraisal-assist/activities';
import { createCoreActivities, createProjectionActivities, createWebhookActivities } from './platform/activities';
import { dataConverter, keyRingFromEnv } from './platform/codec';
import { CoreClient } from './platform/core-client';
import { connectPg } from './platform/db';
import { allowedCallbackHosts } from './platform/security/callback-url';
import { TASK_QUEUE, temporalAddress, temporalNamespace } from './platform/temporal';

export function buildActivities(o: { core: CoreClient; db: Awaited<ReturnType<typeof connectPg>>; webhookSecret: string;
  callbackHosts: string[]; sourceHosts: string[]; pollMs?: number }) {
  return {
    ...createCoreActivities(o.core, { pollMs: o.pollMs }),
    ...createProjectionActivities(o.db),
    ...createWebhookActivities({ secret: o.webhookSecret, allowedHosts: o.callbackHosts }),
    ...createCaseActivities({ core: o.core, allowedSourceHosts: o.sourceHosts }),
  };
}

async function main() {
  const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`thiếu ${k}`); return v; };
  const activities = buildActivities({
    core: new CoreClient({ baseUrl: need('CORE_BASE_URL'), apiKey: need('CORE_API_KEY') }),
    db: await connectPg(need('APPS_DATABASE_URL')), webhookSecret: need('APPS_WEBHOOK_SECRET'),
    callbackHosts: allowedCallbackHosts(),
    sourceHosts: (process.env.APPS_SOURCE_ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  });
  const worker = await Worker.create({
    connection: await NativeConnection.connect({ address: temporalAddress() }), namespace: temporalNamespace(),
    taskQueue: TASK_QUEUE, workflowsPath: require.resolve('./workflows'), activities,
    dataConverter: dataConverter(keyRingFromEnv()),
  });
  await worker.run();
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
