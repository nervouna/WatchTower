import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".wrangler", "node_modules", "worker-configuration.d.ts"] },
  eslint.configs.recommended,
  {
    files: ["**/*.ts"],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        document: "readonly",
        location: "readonly",
        fetch: "readonly",
        URLSearchParams: "readonly",
        Headers: "readonly",
        Map: "readonly",
        queueMicrotask: "readonly",
        window: "readonly",
      },
      parserOptions: { projectService: false },
    },
  },
  {
    files: ["test-web/**/*.js", "vitest.web.config.js"],
    languageOptions: {
      globals: {
        Response: "readonly",
      },
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", fetch: "readonly", console: "readonly" },
    },
  },
  {
    files: ["test/**/*.ts", "vitest.config.ts"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
    },
  },
);
