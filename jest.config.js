module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.test.ts'],
  testPathIgnorePatterns: [
    '<rootDir>/docs/backups/',
    '<rootDir>/docs/ai/'
  ],
  moduleNameMapper: {
    '^vscode$': '<rootDir>/src/test/mocks/vscode.ts'
  },
  collectCoverage: false,
  verbose: true
};
