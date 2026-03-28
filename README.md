# Lyra — checklyra.com

A calm, structured public profile platform where people share preferences, gift ideas, boundaries, and personal details — so the people in their lives never have to guess.

## Architecture

**MCP-first**: AI companions are the primary interface. The MCP server allows Claude, ChatGPT, Gemini and other AI assistants to search and retrieve Lyra profiles on behalf of users.

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Web app | Next.js 16, TypeScript, Tailwind CSS | User-facing website |
| Database | Supabase (PostgreSQL + Auth) | Data storage and authentication |
| Hosting | Vercel | Web app hosting and CDN |
| MCP Server | Node.js, TypeScript, Railway | AI companion interface |
| Security | Cloudflare | DNS, CDN, WAF, DDoS protection |
| CI/CD | GitHub Actions | Automated testing and deployment |
| Project | Jira (Atlassian) | Issue tracking |

## Environments

| Environment | URL | Branch | Database |
|-------------|-----|--------|----------|
| Production | https://checklyra.com | main | Supabase production |
| Staging | https://stage.checklyra.com | staging | Supabase staging |
| Development | https://dev.checklyra.com | develop | Supabase dev |
| MCP Server | https://mcp.checklyra.com | main (lyra-mcp-server) | Supabase production |

Each environment has a completely separate Supabase project (database + auth). No data crosses between environments.

## Development

```bash
# Clone and install
git clone https://github.com/luisa-sys/lyra.git
cd lyra
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase dev project credentials

# Run locally
npm run dev
```

### Required environment variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret key (server-side only) |
| `NEXT_PUBLIC_SITE_URL` | Full URL of the environment (e.g. `https://dev.checklyra.com`) |

## CI/CD Pipeline

```
Push to develop → Lint + Typecheck + Unit tests + npm audit + Coverage → Deploy to dev
                  ↓ (manual promote)
Promote to staging → Lint + Typecheck + Tests → Deploy to staging + Health checks
                  ↓ (manual promote, requires "PRODUCTION" confirmation)
Promote to production → Deploy to production + Smoke tests + Auto-rollback on failure
```

All GitHub Actions are SHA-pinned to v6 (Node.js 24 compatible). CodeQL security scanning runs on every push.

## MCP Server

The Lyra MCP server at `mcp.checklyra.com` provides 6 read-only tools for AI companions:

- `lyra_search_profiles` — Search profiles by name or keyword
- `lyra_get_profile` — Get a complete profile by slug or name
- `lyra_get_section` — Get a specific section of a profile
- `lyra_get_insights` — Get a summary of someone based on their profile
- `lyra_recommend_gifts` — Get gift ideas from a profile
- `lyra_list_schools` — Search school affiliations

Discovery: `https://checklyra.com/.well-known/mcp.json`

### Connect to the MCP server

**Claude Desktop** — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "lyra": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.checklyra.com/mcp"]
    }
  }
}
```

**Claude.ai** — Settings → Connectors → Add `https://mcp.checklyra.com/mcp`

## Security

- Cloudflare proxy on all domains (WAF, DDoS, bot management)
- CSP, COOP, CORP, HSTS, X-Frame-Options, Referrer-Policy headers
- Rate limiting on auth endpoints (10 attempts / 15 minutes)
- Input sanitisation on all profile write actions
- npm audit blocking in all CI pipelines (0 vulnerabilities)
- CodeQL security scanning on every push + weekly
- GitHub secret scanning + push protection enabled
- Dependabot security updates enabled
- All API keys separated per environment
- Vulnerability disclosure: `/.well-known/security.txt`

## Licence

Proprietary. All rights reserved.
