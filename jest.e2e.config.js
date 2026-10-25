module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: 'tsconfig.json'
    }]
  },
  // apps/ là dự án riêng (tầng Apps, ADR-0002) với test runner riêng
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/apps/'],
  testMatch: [
    '**/tests/e2e/**/*.test.ts'
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/e2e/setup.ts'],
  testTimeout: 15000, // 15 seconds timeout for e2e tests
};
