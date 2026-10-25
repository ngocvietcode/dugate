module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    // Handle module aliases (this will be automatically configured for you soon)
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
    '**/tests/**/*.test.ts'
  ],
  setupFiles: ['<rootDir>/tests/setup.ts']
};
