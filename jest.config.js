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
  collectCoverageFrom: ["services/**/*.{ts,tsx}", "utils/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}", "!**/__tests__/**", "!**/node_modules/**"],
};
