#!/usr/bin/env python3
"""Convert npm audit JSON to Resend email JSON payload for security alerts."""

import json
import sys
from datetime import datetime, timezone


def main():
    if len(sys.argv) < 2:
        print("Usage: audit-to-email.py <audit-results.json>", file=sys.stderr)
        sys.exit(1)

    try:
        with open(sys.argv[1], "r") as f:
            data = json.load(f)
    except (json.JSONDecodeError, FileNotFoundError) as e:
        # No valid audit data — output no-vuln payload
        payload = {"has_vulnerabilities": False}
        print(json.dumps(payload))
        return

    vulns_meta = data.get("metadata", {}).get("vulnerabilities", {})
    high = vulns_meta.get("high", 0)
    critical = vulns_meta.get("critical", 0)
    total = sum(vulns_meta.values())

    if high + critical == 0:
        payload = {"has_vulnerabilities": False}
        print(json.dumps(payload))
        return

    # Build vulnerability table
    vulns = data.get("vulnerabilities", {})
    rows = []
    for name, info in vulns.items():
        severity = info.get("severity", "unknown")
        if severity not in ("high", "critical"):
            continue
        fix_available = info.get("fixAvailable", False)
        fix_str = "✅ Yes" if fix_available else "❌ No"
        via = info.get("via", [])
        advisory_url = ""
        title = ""
        for v in via:
            if isinstance(v, dict):
                advisory_url = v.get("url", "")
                title = v.get("title", "")
                break
        rows.append(
            f'<tr><td style="padding:8px;border:1px solid #e7e5e4;">{name}</td>'
            f'<td style="padding:8px;border:1px solid #e7e5e4;">'
            f'<span style="color:{"#dc2626" if severity == "critical" else "#ea580c"};font-weight:bold;">{severity.upper()}</span></td>'
            f'<td style="padding:8px;border:1px solid #e7e5e4;">{title}</td>'
            f'<td style="padding:8px;border:1px solid #e7e5e4;">'
            f'{"<a href=" + chr(34) + advisory_url + chr(34) + ">View</a>" if advisory_url else "—"}</td>'
            f'<td style="padding:8px;border:1px solid #e7e5e4;">{fix_str}</td></tr>'
        )

    table = (
        '<table style="border-collapse:collapse;width:100%;font-size:14px;margin:16px 0;">'
        "<tr>"
        '<th style="padding:8px;border:1px solid #e7e5e4;background:#f5f5f4;text-align:left;">Package</th>'
        '<th style="padding:8px;border:1px solid #e7e5e4;background:#f5f5f4;text-align:left;">Severity</th>'
        '<th style="padding:8px;border:1px solid #e7e5e4;background:#f5f5f4;text-align:left;">Issue</th>'
        '<th style="padding:8px;border:1px solid #e7e5e4;background:#f5f5f4;text-align:left;">Advisory</th>'
        '<th style="padding:8px;border:1px solid #e7e5e4;background:#f5f5f4;text-align:left;">Fix Available</th>'
        "</tr>"
        + "\n".join(rows)
        + "</table>"
    )

    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    html_body = f"""<div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;max-width:700px;margin:0 auto;padding:20px;background:#fafaf9;">
<div style="text-align:center;margin-bottom:24px;">
<span style="font-family:serif;font-size:28px;color:#1c1917;">lyra</span>
</div>
<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:24px;">
<h2 style="color:#dc2626;margin:0 0 8px 0;font-size:18px;">⚠️ Security Vulnerabilities Detected</h2>
<p style="color:#44403c;margin:0;">The weekly security audit found <strong>{high + critical} high/critical</strong> vulnerabilities ({total} total) in the Lyra web app dependencies.</p>
</div>
<h3 style="color:#1c1917;margin-top:24px;">Affected Packages</h3>
{table}
<h3 style="color:#1c1917;margin-top:24px;">Recommended Action</h3>
<div style="background:#f5f5f4;border-radius:6px;padding:12px;font-family:monospace;font-size:13px;">
cd lyra<br>
npm audit<br>
npm audit fix --force<br>
npm run build && npx jest<br>
git add -A && git commit -m "security: fix npm audit vulnerabilities"
</div>
<p style="color:#78716c;font-size:13px;margin-top:16px;">Run <code>npm audit</code> locally for full details. If <code>npm audit fix</code> doesn't resolve, manual intervention may be needed.</p>
<div style="text-align:center;margin-top:32px;padding-top:16px;border-top:1px solid #e7e5e4;">
<span style="font-size:12px;color:#a8a29e;">Lyra Security Audit &mdash; generated automatically by GitHub Actions every Wednesday</span>
</div>
</div>"""

    payload = {
        "from": "Lyra Security <reports@checklyra.com>",
        "to": ["luisa@santos-stephens.com"],
        "subject": f"⚠️ Lyra Security Alert — {high + critical} vulnerabilities found ({date})",
        "html": html_body,
        "has_vulnerabilities": True,
    }
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
