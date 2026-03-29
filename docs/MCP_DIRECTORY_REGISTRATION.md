# Registering Lyra across every major MCP directory

**Lyra can be listed on at least 10 MCP directories and both major AI platforms today**, most within minutes and at zero cost. The highest-impact registrations are the official MCP Registry (the canonical source of truth), the Claude.ai Connectors Directory (direct user access), and the ChatGPT App Directory (largest user base). Below is exactly what to do for each, ordered by strategic priority.

---

## The official MCP Registry is your first stop

The **Official MCP Registry** at registry.modelcontextprotocol.io launched in preview on September 8, 2025. It now holds ~2,000 namespace-authenticated entries and operates as the canonical metaregistry that downstream directories aggregate from.

**Submission steps:**

1. Clone the registry repo: `git clone https://github.com/modelcontextprotocol/registry`
2. Build the publisher CLI: `make publisher`, then run `./bin/mcp-publisher --help`
3. Authenticate your namespace — format: **`io.github.luisa-sys/lyra-mcp-server`**
4. Create a `server.json` metadata file
5. Publish using the CLI

---

## Claude.ai offers two paths: instant custom connector and curated directory

**Path 1 — Custom Connector (live in minutes).** Navigate to Settings → Connectors → Add custom connector, paste `https://mcp.checklyra.com/mcp`.

**Path 2 — Official Connectors Directory listing (requires Anthropic review).** Submit the server review form. All 12 tools must include `readOnlyHint` or `destructiveHint` annotations.

---

## ChatGPT's App Directory now accepts MCP servers

**Developer Mode (immediate):** Settings → Apps → Advanced settings → Developer Mode → Create app → enter `https://mcp.checklyra.com/mcp`.

**App Directory submission:** Complete identity verification, domain verification at `/.well-known/openai-apps-challenge`, then submit via Platform Dashboard.

---
## Smithery registration

Install CLI: `npm install -g @smithery/cli`, authenticate, publish: `smithery mcp publish "https://mcp.checklyra.com/mcp" -n lyra/lyra-mcp-server`. Listing is free.

## Glama indexes from GitHub automatically

Go to glama.ai/mcp/servers → Add Server → enter `https://github.com/luisa-sys/lyra-mcp-server`. Add `glama.json` to repo root. Ensure repo has LICENSE file (servers without one get an F score).

## mcpservers.org uses a web form

Submit at mcpservers.org/submit. Free tier or $39 premium for faster approval.

## Other directories

PulseMCP, mcp.so, OpenTools, MCP-Get, GitHub MCP, Protodex — register on each for maximum coverage.

## Prioritized action plan

Before submitting anywhere, ensure: LICENSE file, complete tool annotations, privacy policy URL, working test credentials, `.well-known/mcp.json` discovery endpoint. Then register in order: Official MCP Registry → Claude.ai → ChatGPT → Glama → Smithery → mcpservers.org → remaining directories.
