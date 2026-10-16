module.exports = {
  testEnvironment: 'node',
  testRegex: '.*\\.int-spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }]
  },
  moduleNameMapper: {
    '^@lab/common$': '<rootDir>/libs/common/src/index.ts',
    '^@lab/database$': '<rootDir>/libs/database/src/index.ts'
  },
  clearMocks: true
};
