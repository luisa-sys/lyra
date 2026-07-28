const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// BUGS-79: the github-actions ecosystem block had no target-branch, so it
// fell back to the repo default (main) — putting every weekly bump in direct
// conflict with SEC-98 (main-chain-guard.yml blocks any PR targeting main).
// This test is the control: it fails the build if a future ecosystem block
// omits target-branch, so the config cannot silently drift back.
describe('.github/dependabot.yml', () => {
  const configPath = path.join(__dirname, '..', '..', '.github', 'dependabot.yml');
  const config = yaml.load(fs.readFileSync(configPath, 'utf8'));

  test('every ecosystem targets develop (SEC-98: main is reached only via the promote chain)', () => {
    expect(Array.isArray(config.updates)).toBe(true);
    expect(config.updates.length).toBeGreaterThan(0);

    for (const update of config.updates) {
      expect(update['target-branch']).toBe('develop');
    }
  });
});
