module.exports = {
  preset: "jest-expo",
  testEnvironment: "jest-environment-node",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)",
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  testMatch: ["**/__tests__/**/*.test.[jt]s?(x)", "**/?(*.)+(spec|test).[jt]s?(x)"],
  // .claude/ holds agent worktrees (full repo checkouts) — scanning them runs every suite twice.
  testPathIgnorePatterns: ["/node_modules/", "/.claude/"],
  modulePathIgnorePatterns: ["<rootDir>/.claude/"],
  // components/ and app/ were excluded, so the coverage number described only the
  // layers that happened to be tested and flattered itself accordingly. They are
  // in now, which drops the headline figure but makes it mean something.
  collectCoverageFrom: [
    "services/**/*.{ts,tsx}",
    "utils/**/*.{ts,tsx}",
    "hooks/**/*.{ts,tsx}",
    "contexts/**/*.{ts,tsx}",
    "components/**/*.{ts,tsx}",
    "app/**/*.{ts,tsx}",
    "!**/__tests__/**",
    "!**/node_modules/**",
  ],
  // Measured 49.89 / 40.51 / 46.20 / 51.00 on 2026-08-20 with the widened
  // denominator above. The floor sits a few points under that so it ratchets
  // upward without failing the build the day it lands. Raise it when coverage
  // rises; never lower it to make a red run green.
  coverageThreshold: {
    global: { statements: 47, branches: 38, functions: 44, lines: 48 },
  },
};
