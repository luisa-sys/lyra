/**
 * SEC-174 / SEC-197 — fail loudly, once, when the local Node major is not the
 * one the repo is built and tested on (`.nvmrc`, which every CI workflow and
 * the Vercel project also use).
 *
 * WHY THIS EXISTS
 * ---------------
 * dependency-cruiser 18 declares engines `^22||^24||>=26` and refuses to start
 * on Node 25 (Homebrew's default in late 2026). Without this preflight, a
 * Node-25 machine ran the unit suite and got 10 red cases across 4 suites
 * (CTL-051/053/054, KAN-425) that look unrelated to the runtime, plus 5,800
 * greens around them. "Those 10 are expected" is a switched-off control
 * (CLAUDE.md catalogue #7). One clear failure naming the fix is better than
 * ten misleading ones, and it also catches the next engines bump in any tool,
 * not just this one.
 *
 * Wired as jest `globalSetup`, so it covers every jest invocation (npm run
 * test:unit, CI's direct `npx jest ...`, an agent's ad-hoc run). There is
 * deliberately no bypass variable: a bypass is the expected-red problem again.
 * Also runnable directly: `node scripts/check-node-version.cjs`.
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const NVMRC = join(__dirname, '..', '.nvmrc');

/** Parse a major from "24", "v24", "24.11.0", "v25.8.1"; null if not numeric. */
function majorOf(version) {
  const m = /^v?(\d+)(?:\.|$)/.exec(String(version).trim());
  return m ? Number(m[1]) : null;
}

/**
 * Pure check, so it can be tested without changing the running Node.
 * @param {{actual: string, required: string}} args
 * @returns {{ok: boolean, message: string}}
 */
function checkNodeVersion({ actual, required }) {
  const want = majorOf(required);
  const have = majorOf(actual);
  if (want === null) {
    return {
      ok: false,
      message: `.nvmrc must hold a numeric Node major (e.g. "24"); found "${String(required).trim()}".`,
    };
  }
  if (have === want) return { ok: true, message: `Node ${actual} matches .nvmrc (${want}).` };
  return {
    ok: false,
    message: [
      `Wrong Node version: this repo runs on Node ${want} (.nvmrc, CI, Vercel), but this shell is on Node ${actual}.`,
      `Tests would fail for reasons unrelated to your change (e.g. dependency-cruiser 18 refuses Node 25).`,
      `Fix: \`nvm use\` / \`fnm use\`, or with Homebrew:`,
      `  brew install node@${want} && export PATH="$(brew --prefix node@${want})/bin:$PATH"`,
      `then \`rm -rf node_modules && npm ci\` and re-run.`,
    ].join('\n'),
  };
}

function assertNodeVersion() {
  const result = checkNodeVersion({
    actual: process.versions.node,
    required: readFileSync(NVMRC, 'utf8'),
  });
  if (!result.ok) throw new Error(result.message);
  return result;
}

/** jest globalSetup entry point. */
module.exports = async function globalSetup() {
  assertNodeVersion();
};
module.exports.checkNodeVersion = checkNodeVersion;
module.exports.majorOf = majorOf;
module.exports.assertNodeVersion = assertNodeVersion;

if (require.main === module) {
  try {
    console.log(assertNodeVersion().message);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
