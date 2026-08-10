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
  {
    // KAN-425: tool configs carry the .cjs extension precisely because the
    // tool loads them as CommonJS — .dependency-cruiser.cjs is read with
    // require(), so require()/module.exports is the only valid form there.
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  // ── CTL-046 (KAN-415 D4) ──────────────────────────────────────────────
  // The three gates that consult the exemption table must not compare
  // `pathname` directly. Those comparisons are exactly what the table
  // replaced — 19 disjuncts across three inline `||` chains — and a single
  // `ctx.pathname === '/gifts'` added to a gate would bypass it silently: the
  // table's own tests would still pass, because the table would still be
  // correct; it would simply no longer be the only thing deciding.
  //
  // Scoped to these three files only. After C6/C7 they contain ZERO such
  // comparisons, so the rule has no false positives today and fires on the one
  // edit that matters. `startsWith` stays legal — /admin needs it, and it is
  // the literal qa-sweep/inventory.py derives the admin prefix list from.
  {
    files: [
      "src/modules/access/gates/suspension.ts",
      "src/modules/access/gates/beta-tier.ts",
      "src/modules/access/gates/admin-host.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "BinaryExpression[operator=/^[!=]==$/] > MemberExpression[property.name='pathname']",
          message:
            "CTL-046: this gate must not compare `pathname` directly — path exemptions belong in src/modules/access/exemptions.ts. A comparison here bypasses the table while the table's own tests stay green. `startsWith` is still allowed.",
        },
        {
          selector:
            "BinaryExpression[operator=/^[!=]==$/] > Identifier[name='pathname']",
          message:
            "CTL-046: this gate must not compare `pathname` directly — path exemptions belong in src/modules/access/exemptions.ts.",
        },
      ],
    },
  },

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
    // KAN-154: test-artifact directories created by `jest --coverage`
    // and Playwright runs. Pure local-DX — CI starts from a clean
    // checkout so these never appear in CI lint runs.
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
