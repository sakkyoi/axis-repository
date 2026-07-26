import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * The TypeScript config already carries most of the load (strict,
 * noUncheckedIndexedAccess, exactOptionalPropertyTypes), so this focuses on
 * what the compiler does not catch: unused code, floating promises, unsound
 * stringification, and accidental `any`.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      "packages/runtime-cloudflare/src/admin-ui-assets/generated.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
          // Destructuring is how several call sites drop fields deliberately,
          // e.g. stripping a token hash before returning a record.
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      // React event handlers are routinely async; the return value is ignored
      // by design there.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      // Store and broker adapters implement Promise-returning ports; several
      // have nothing to await, and widening the signature would be wrong.
      "@typescript-eslint/require-await": "off",
      // Each package compiles against a different lib set (workers-types vs
      // DOM), so one lint project cannot judge which assertions the real build
      // needs; it reported casts as redundant that tsc requires.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "no-console": ["error", { allow: ["error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      // Context values and hook results are object-literal or useCallback
      // members that never reference `this`, so passing them as callbacks is
      // the intended style here.
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    // Tests assert on shapes the compiler cannot narrow.
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.test-support.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-implied-eval": "off",
      "no-console": "off",
    },
  },
  {
    // The publish CLI writes its result to stdout by design.
    files: ["**/cli.ts"],
    rules: { "no-console": "off" },
  },
  {
    // Build and tooling configs are outside the lint type project. Last so it
    // wins over the type-aware settings above.
    files: ["**/*.mjs", "**/*.js", "**/*.config.ts", "scripts/**/*.ts"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: { console: "readonly", process: "readonly", URL: "readonly" },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      "no-console": "off",
    },
  },
);
