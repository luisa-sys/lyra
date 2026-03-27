/**
 * MCP Discoverability unit tests
 * KAN-29: MCP discoverability (llms.txt, registries)
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

describe('MCP Discoverability', () => {
  test('llms.txt exists in public directory', () => {
    const llmsTxt = fs.readFileSync(path.join(root, 'public/llms.txt'), 'utf8');
    expect(llmsTxt).toContain('# Lyra');
    expect(llmsTxt).toContain('MCP');
    expect(llmsTxt).toContain('lyra_search_profiles');
    expect(llmsTxt).toContain('lyra_get_profile');
    expect(llmsTxt).toContain('lyra_recommend_gifts');
  });

  test('llms.txt follows spec format (H1, blockquote, sections)', () => {
    const llmsTxt = fs.readFileSync(path.join(root, 'public/llms.txt'), 'utf8');
    const lines = llmsTxt.split('\n');
    expect(lines[0]).toBe('# Lyra');
    expect(llmsTxt).toContain('> ');
    expect(llmsTxt).toContain('## ');
  });

  test('.well-known/mcp.json exists with valid structure', () => {
    const mcpJson = JSON.parse(fs.readFileSync(path.join(root, 'public/.well-known/mcp.json'), 'utf8'));
    expect(mcpJson.name).toBe('Lyra');
    expect(mcpJson.mcp).toBeDefined();
    expect(mcpJson.mcp.transport).toBe('streamable-http');
    expect(mcpJson.mcp.tools).toContain('lyra_search_profiles');
    expect(mcpJson.mcp.tools.length).toBe(6);
  });

  test('public profile page includes JSON-LD structured data', () => {
    const profilePage = fs.readFileSync(path.join(root, 'src/app/[slug]/page.tsx'), 'utf8');
    expect(profilePage).toContain('application/ld+json');
    expect(profilePage).toContain('@context');
    expect(profilePage).toContain('schema.org');
    expect(profilePage).toContain('@type');
  });

  test('landing page includes JSON-LD structured data', () => {
    const homePage = fs.readFileSync(path.join(root, 'src/app/page.tsx'), 'utf8');
    expect(homePage).toContain('application/ld+json');
    expect(homePage).toContain('WebSite');
    expect(homePage).toContain('checklyra.com');
  });
});
