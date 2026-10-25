// Server /apps/v1/* — npm run server
import { serve } from '@hono/node-server';
import { Client, Connection } from '@temporalio/client';
import { APPS } from './apps';
import { createApi, type Caller } from './platform/api';
import { dataConverter, keyRingFromEnv } from './platform/codec';
import { connectPg } from './platform/db';
import { allowedCallbackHosts } from './platform/security/callback-url';
import { LAC_TASK_QUEUE, TASK_QUEUE, temporalAddress, temporalNamespace } from './platform/temporal';

async function main() {
  const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`thiếu ${k}`); return v; };
  // APPS_CALLERS='[{"id":"LOS","keySha256":"<sha256 hex của API key>","trustedUserHeaders":true}]'
  const callers = JSON.parse(need('APPS_CALLERS')) as Caller[];
  const temporal = new Client({ connection: await Connection.connect({ address: temporalAddress() }),
    namespace: temporalNamespace(), dataConverter: dataConverter(keyRingFromEnv()) });
  const api = createApi({ db: await connectPg(need('APPS_DATABASE_URL')), temporal, apps: APPS, callers, taskQueue: TASK_QUEUE,
    callbackHosts: allowedCallbackHosts(), env: { lacTaskQueue: LAC_TASK_QUEUE, reviewTimeout: (process.env.APPS_REVIEW_TIMEOUT ?? '10 days') as '10 days' } });
  const port = Number(process.env.PORT ?? 2030);
  serve({ fetch: api.fetch, port });
  console.log(`dugate-apps API :${port}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
