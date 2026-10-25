// Cấu hình kết nối Temporal dùng chung cho server, worker và test.
export const TASK_QUEUE = process.env.APPS_TASK_QUEUE ?? 'dugate-apps';
export const LAC_TASK_QUEUE = process.env.LAC_TASK_QUEUE ?? 'credit-lac-py';
export const temporalAddress = () => process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
export const temporalNamespace = () => process.env.TEMPORAL_NAMESPACE ?? 'apps-dev';
