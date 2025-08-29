import nextJest from 'next/jest.js'

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.ts and .env files in your test environment
  dir: './',
})

// Add any custom config to be passed to Jest
const config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  // Add more setup options before each test is run
  setupFilesAfterEnv: ['<rootDir>/jest.setup.mjs'],
  testPathIgnorePatterns: ['/node_modules/', '/tests/', '/tests-examples/'],
  moduleNameMapper: {
    'three/examples/jsm/postprocessing/EffectComposer.js': '<rootDir>/__mocks__/fileMock.js',
    'three/examples/jsm/postprocessing/RenderPass.js': '<rootDir>/__mocks__/fileMock.js',
    'three/examples/jsm/postprocessing/UnrealBloomPass.js': '<rootDir>/__mocks__/fileMock.js',
  },
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config)
