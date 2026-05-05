import { useState } from "react";

const sections = [
  {
    title: "Live Environments",
    icon: "🌐",
    items: [
      { label: "Production", value: "https://checklyra.com", link: "https://checklyra.com", env: "main" },
      { label: "Staging", value: "https://stage.checklyra.com", link: "https://stage.checklyra.com", env: "staging" },
      { label: "Development", value: "https://dev.checklyra.com", link: "https://dev.checklyra.com", env: "develop" },
      { label: "MCP Server", value: "https://mcp.checklyra.com/mcp", link: "https://mcp.checklyra.com/health", env: "main" },
      { label: "MCP Discovery", value: "/.well-known/mcp.json", link: "https://mcp.checklyra.com/.well-known/mcp.json", env: "main" },
    ],
  },
  {
    title: "Supabase Databases",
    icon: "🗄️",
    items: [
      { label: "Dev Project", value: "ilprytcrnqyrsbsrfujj", link: "https://supabase.com/dashboard/project/ilprytcrnqyrsbsrfujj", env: "develop" },
      { label: "Dev API URL", value: "https://ilprytcrnqyrsbsrfujj.supabase.co", copy: true },
      { label: "Staging Project", value: "uobmlkzrjkptwhttzmmi", link: "https://supabase.com/dashboard/project/uobmlkzrjkptwhttzmmi", env: "staging" },
      { label: "Staging API URL", value: "https://uobmlkzrjkptwhttzmmi.supabase.co", copy: true },
      { label: "Production Project", value: "llzkgprqewuwkiwclowi", link: "https://supabase.com/dashboard/project/llzkgprqewuwkiwclowi", env: "main" },
      { label: "Production API URL", value: "https://llzkgprqewuwkiwclowi.supabase.co", copy: true },
      { label: "Staging Pooler (pg_dump)", value: "aws-1-eu-west-1.pooler.supabase.com:6543", copy: true },
    ],
  },
  {
    title: "Supabase Quick Links",
    icon: "⚡",
    items: [
      { label: "Dev — Auth Settings", link: "https://supabase.com/dashboard/project/ilprytcrnqyrsbsrfujj/auth/url-configuration" },
      { label: "Dev — SQL Editor", link: "https://supabase.com/dashboard/project/ilprytcrnqyrsbsrfujj/sql/new" },
      { label: "Dev — API Keys", link: "https://supabase.com/dashboard/project/ilprytcrnqyrsbsrfujj/settings/api" },
      { label: "Staging — Auth Settings", link: "https://supabase.com/dashboard/project/uobmlkzrjkptwhttzmmi/auth/url-configuration" },
      { label: "Staging — SQL Editor", link: "https://supabase.com/dashboard/project/uobmlkzrjkptwhttzmmi/sql/new" },
      { label: "Staging — API Keys", link: "https://supabase.com/dashboard/project/uobmlkzrjkptwhttzmmi/settings/api" },
      { label: "Prod — Auth Settings", link: "https://supabase.com/dashboard/project/llzkgprqewuwkiwclowi/auth/url-configuration" },
      { label: "Prod — SQL Editor", link: "https://supabase.com/dashboard/project/llzkgprqewuwkiwclowi/sql/new" },
      { label: "Prod — API Keys", link: "https://supabase.com/dashboard/project/llzkgprqewuwkiwclowi/settings/api" },
    ],
  },
  {
    title: "GitHub Repositories",
    icon: "📦",
    items: [
      { label: "Web App (lyra)", link: "https://github.com/luisa-sys/lyra" },
      { label: "MCP Server", link: "https://github.com/luisa-sys/lyra-mcp-server" },
      { label: "Web App — Actions", link: "https://github.com/luisa-sys/lyra/actions" },
      { label: "Web App — Branches", link: "https://github.com/luisa-sys/lyra/branches" },
      { label: "Web App — Settings/Secrets", link: "https://github.com/luisa-sys/lyra/settings/secrets/actions" },
    ],
  },
  {
    title: "Vercel",
    icon: "▲",
    items: [
      { label: "Dashboard", link: "https://vercel.com/luisa-sys-projects" },
      { label: "Lyra Project", link: "https://vercel.com/luisa-sys-projects/lyra" },
      { label: "Environment Variables", link: "https://vercel.com/luisa-sys-projects/lyra/settings/environment-variables" },
      { label: "Domains", link: "https://vercel.com/luisa-sys-projects/lyra/settings/domains" },
      { label: "Deployments", link: "https://vercel.com/luisa-sys-projects/lyra/deployments" },
    ],
  },
  {
    title: "Railway (MCP Server Hosting)",
    icon: "🚂",
    items: [
      { label: "Dashboard", link: "https://railway.app/dashboard" },
      { label: "Note", value: "MCP server auto-deploys from lyra-mcp-server main branch" },
      { label: "Environment vars to set", value: "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MCP_TRANSPORT=http" },
    ],
  },
  {
    title: "Cloudflare",
    icon: "☁️",
    items: [
      { label: "Dashboard", link: "https://dash.cloudflare.com" },
      { label: "DNS Records", link: "https://dash.cloudflare.com/?to=/:account/checklyra.com/dns" },
      { label: "Email Routing", link: "https://dash.cloudflare.com/?to=/:account/checklyra.com/email/routing/routes" },
      { label: "Domain", value: "checklyra.com — registered and managed via Cloudflare" },
    ],
  },
  {
    title: "UptimeRobot (Monitoring) — KAN-163",
    icon: "📡",
    items: [
      { label: "Dashboard", link: "https://dashboard.uptimerobot.com/" },
      { label: "Setup guide", link: "https://github.com/luisa-sys/lyra/blob/develop/docs/UPTIMEROBOT_SETUP.md" },
      { label: "Plan", value: "Free — 50 monitors, 5-minute interval, SSL expiry monitoring" },
      { label: "Alerts to", value: "luisa@santos-stephens.com, ben@santos-stephens.com" },
      { label: "Bootstrap script", value: "scripts/uptimerobot/bootstrap.js (idempotent, dry-run by default)" },
    ],
  },
  {
    title: "Jira (Project Management)",
    icon: "📋",
    items: [
      { label: "KAN — Lyra Board", link: "https://checklyra.atlassian.net/jira/software/projects/KAN/board" },
      { label: "KAN — Backlog", link: "https://checklyra.atlassian.net/jira/software/projects/KAN/backlog" },
      { label: "KAN — Code View", link: "https://checklyra.atlassian.net/jira/software/projects/KAN/code" },
      { label: "BUGS — Bug Board", link: "https://checklyra.atlassian.net/jira/software/projects/BUGS/board" },
      { label: "BUGS — Backlog", link: "https://checklyra.atlassian.net/jira/software/projects/BUGS/backlog" },
      { label: "KAN Project Key", value: "KAN (features, epics, tasks)" },
      { label: "BUGS Project Key", value: "BUGS (automated bug tracking, Bug issue type id: 10047)" },
      { label: "Cloud ID", value: "fde496ba-2db8-481a-8544-39d6e9122101", copy: true },
      { label: "Transition IDs (KAN)", value: "21 = In Progress, 41 = Done" },
    ],
  },
  {
    title: "CI/CD & Branch Strategy",
    icon: "🔄",
    items: [
      { label: "Flow", value: "develop → staging → main (production)" },
      { label: "Dev deploy workflow", value: "deploy-dev.yml (on push to develop)" },
      { label: "Promote to staging", value: "scripts/promote-to-staging.sh" },
      { label: "Promote to production", value: "scripts/promote-to-production.sh" },
      { label: "Vercel env note", value: "Pro plan — full environment separation with custom environments for staging and develop branches" },
    ],
  },
  {
    title: "Key Architecture Notes",
    icon: "🏗️",
    items: [
      { label: "Framework", value: "Next.js 15 (App Router)" },
      { label: "Database", value: "Supabase Pro (PostgreSQL 17), EU West (Ireland), 3 separate projects (dev/staging/prod)" },
      { label: "Auth", value: "Supabase Auth — email/password, Google OAuth (Apple pending)" },
      { label: "Google OAuth", value: "Client ID: 381290542304-...73kn (same across all 3 Supabase projects, Testing mode)" },
      { label: "MCP Transport", value: "Streamable HTTP (stateless, JSON-RPC 2.0)" },
      { label: "MCP Tools", value: "15 registered tools (6 read + 8 write + 1 onboarding coaching)" },
      { label: "MCP Auth", value: "API key auth (lyra_* prefix, SHA-256 hashed) — OAuth 2.1 planned (KAN-88)" },
      { label: "Tables", value: "profiles, profile_items, external_links, school_affiliations, api_keys" },
      { label: "Security", value: "Row Level Security on all tables" },
      { label: "Supabase keys (new projects)", value: "sb_publishable_ (replaces anon), sb_secret_ (replaces service_role)" },
    ],
  },
];

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="ml-2 px-2 py-0.5 text-xs rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-600 transition-all shrink-0"
    >
      {copied ? "✓" : "Copy"}
    </button>
  );
}

export default function LyraProjectReference() {
  const [search, setSearch] = useState("");
  const [expandedSections, setExpandedSections] = useState(
    Object.fromEntries(sections.map((s) => [s.title, true]))
  );

  const toggleSection = (title) => {
    setExpandedSections((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  const filteredSections = sections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          !search ||
          (item.label || "").toLowerCase().includes(search.toLowerCase()) ||
          (item.value || "").toLowerCase().includes(search.toLowerCase()) ||
          (item.link || "").toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter((section) => section.items.length > 0);

  const envColors = {
    main: "bg-emerald-100 text-emerald-800",
    staging: "bg-amber-100 text-amber-800",
    develop: "bg-sky-100 text-sky-800",
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight" style={{ fontFamily: "Georgia, serif" }}>
            Lyra — Project Reference
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            All URLs, dashboards, and environment links in one place. Last updated: 29 March 2026.
          </p>
        </div>

        <div className="mb-5">
          <input
            type="text"
            placeholder="Search links, URLs, services..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-300"
          />
        </div>

        <div className="space-y-3">
          {filteredSections.map((section) => (
            <div key={section.title} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <button
                onClick={() => toggleSection(section.title)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <span>{section.icon}</span>
                  {section.title}
                  <span className="text-xs text-slate-400 font-normal">({section.items.length})</span>
                </span>
                <span className="text-slate-400 text-xs">{expandedSections[section.title] ? "▼" : "▶"}</span>
              </button>

              {expandedSections[section.title] && (
                <div className="border-t border-slate-100">
                  {section.items.map((item, i) => (
                    <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-sm border-b border-slate-50 last:border-b-0 hover:bg-slate-50/50">
                      <span className="text-slate-500 w-44 shrink-0 text-xs font-medium">{item.label}</span>
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {item.link ? (
                          <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 hover:underline truncate text-xs">
                            {item.value || item.link}
                          </a>
                        ) : (
                          <span className="text-slate-700 text-xs truncate">{item.value}</span>
                        )}
                        {item.env && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${envColors[item.env]}`}>{item.env}</span>
                        )}
                        {(item.copy || item.link) && <CopyButton text={item.value || item.link} />}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          <strong>⚠️ Notes:</strong>
          <ul className="mt-1 ml-4 list-disc space-y-0.5">
            <li>Vercel Pro plan — full environment separation with custom environments per branch (staging, develop)</li>
            <li>New Supabase projects use sb_publishable_ and sb_secret_ key formats (not anon/service_role)</li>
            <li>Cloudflare proxy for mcp CNAME was set up automatically by Railway and is working — no manual grey-cloud override needed</li>
            <li>Railway MCP server must point to production Supabase (llzkgprqewuwkiwclowi)</li>
            <li>API keys and secrets are in Vercel env vars, GitHub secrets, and Railway variables — never in code</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
