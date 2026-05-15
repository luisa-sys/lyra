import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["tests/**/*.js", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // scripts/ are runnable Node entry points — CommonJS is the natural fit
    // (no transpile step). Allow require()/module.exports here.
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // KAN-180: ignore agent-sandbox worktrees so a local `npm run lint`
    // doesn't drown in errors from snapshots of older code. CI never
    // sees `.claude/`; this is purely a local-DX fix.
    ".claude/**",
  ]),
]);

export default eslintConfig;
