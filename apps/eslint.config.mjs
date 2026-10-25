// Lint ranh giới tầng Apps (constitution L1–L2, §10). Kiểm bằng test/lint-boundaries.test.ts.
import tseslint from 'typescript-eslint';

const CORE_IMPORTS = {
  group: ['@/*', '**/lib/*', '**/lib/**', '../../lib/**', '../../../lib/**'],
  message: 'Apps không import code của Core (constitution L2). Gọi Core qua platform/core-client.',
};

const NODE_BUILTINS = ['fs', 'fs/promises', 'path', 'os', 'crypto', 'http', 'https', 'net', 'child_process',
  'worker_threads', 'node:fs', 'node:path', 'node:os', 'node:crypto', 'node:http', 'node:https', 'node:net',
  'node:child_process', 'node:fs/promises'];

export default tseslint.config(
  { ignores: ['node_modules/**', 'src/generated/**', 'credit-kit/**', 'dist/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: [CORE_IMPORTS] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' }, // test đọc JSON động từ API
  },
  {
    // Code chạy trong sandbox workflow của Temporal: chỉ logic tất định (constitution §10)
    files: ['src/**/workflow.ts', 'src/**/workflows/**/*.ts', 'src/platform/workflow-kit/**/*.ts', 'src/**/merge.ts', 'src/**/findings.ts',
      'src/**/verify.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        paths: [
          ...NODE_BUILTINS.map((name) => ({ name, message: 'Workflow không được I/O (constitution §10).' })),
          ...['pg', 'drizzle-orm', 'hono', '@temporalio/client', '@temporalio/worker', '@temporalio/activity'].map(
            (name) => ({ name, message: 'Workflow không được import thư viện I/O hoặc SDK ngoài workflow.', allowTypeImports: true })),
        ],
        patterns: [
          CORE_IMPORTS,
          { group: ['**/activities', '**/activities/*', '**/db', '**/db/*', '**/core-client', '**/core-client/*'],
            allowTypeImports: true,
            message: 'Workflow chỉ được import KIỂU từ activities/db/core-client (gọi qua proxyActivities).' },
        ],
      }],
      'no-restricted-globals': ['error',
        { name: 'fetch', message: 'Workflow không gọi mạng; dùng activity.' },
        { name: 'process', message: 'Workflow không đọc môi trường; truyền qua input.' }],
    },
  },
);
