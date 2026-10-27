module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    // Handle module aliases (this will be automatically configured for you soon)
    '^@/(.*)$': '<rootDir>/$1',
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: 'tsconfig.jest.json'
    }]
  },
  testMatch: [
    '**/tests/**/*.test.ts'
  ],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.kilo/worktrees/', '<rootDir>/.claude/worktrees/'],
  modulePathIgnorePatterns: ['<rootDir>/.kilo/worktrees/', '<rootDir>/.claude/worktrees/'],
  setupFiles: ['<rootDir>/tests/setup.ts']
};
