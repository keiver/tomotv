const fs = require("node:fs");
const path = require("node:path");
const globals = require("globals");
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const eslintPluginPrettierRecommended = require("eslint-plugin-prettier/recommended");

// The one ignore list, read from .prettierignore so ESLint and the Prettier rule
// it runs can never disagree about which files are in scope.
// Each entry covers both a file and a directory, since .prettierignore does not
// distinguish them and neither does .gitignore syntax.
const ignores = fs
  .readFileSync(path.join(__dirname, ".prettierignore"), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .flatMap((line) => (line.endsWith("/") ? [`${line}**`] : [line, `${line}/**`]));

module.exports = defineConfig([
  expoConfig,
  eslintPluginPrettierRecommended,
  { ignores },
  {
    // Scoped to the globs eslint-config-expo loads @typescript-eslint for. Left
    // unscoped it applies to plain .js too, where the plugin is absent, and every
    // repo-wide run dies on a missing-plugin error instead of linting.
    files: ["**/*.ts", "**/*.tsx", "**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Tooling that runs in Node, not in the app: build scripts, config plugins,
    // and the ESLint/Jest/Metro config files themselves.
    files: ["scripts/**", "plugins/**", "*.config.js", "*.config.mjs", "jest.setup.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["jest.setup.js", "**/__tests__/**", "**/*.test.{ts,tsx,js}"],
    languageOptions: { globals: globals.jest },
    rules: {
      // Jest idioms: imports placed below jest.mock() blocks, require() to
      // reach mocked modules after resetModules.
      "import/first": "off",
    },
  },
  {
    files: ["**/__tests__/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);
