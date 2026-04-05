#!/usr/bin/env python3
"""Convert markdown weekly report to Resend email JSON payload."""

import json
import sys
import html
import re
from datetime import datetime, timezone

def md_to_html(md):
    """Simple markdown to HTML conversion for email."""
    h = html.escape(md)
    # Headers
    h = re.sub(r'^## (.+)$', r'<h2 style="color:#1c1917;border-bottom:1px solid #e7e5e4;padding-bottom:6px;margin-top:24px;">\1</h2>', h, flags=re.MULTILINE)
    h = re.sub(r'^# (.+)$', r'<h1 style="color:#1c1917;font-size:24px;">\1</h1>', h, flags=re.MULTILINE)
    # Bold
    h = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', h)

    lines = h.split('\n')
    in_table = False
    out = []
    for line in lines:
        stripped = line.strip()
        if '|' in stripped and stripped.startswith('|'):
            cells = [c.strip() for c in stripped.split('|')[1:-1]]
            if all(set(c) <= set('- ') for c in cells):
                continue
            if not in_table:
                out.append('<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:12px 0;width:100%;">')
                tag = 'th'
                in_table = True
            else:
                tag = 'td'
            row = ''.join(f'<{tag} style="text-align:left;padding:8px;">{c}</{tag}>' for c in cells)
            out.append(f'<tr>{row}</tr>')
        else:
            if in_table:
                out.append('</table>')
                in_table = False
            if stripped.startswith('- '):
                out.append(f'<p style="margin:4px 0 4px 16px;">&bull; {stripped[2:]}</p>')
            elif stripped.startswith('---'):
                out.append('<hr style="border:none;border-top:1px solid #e7e5e4;margin:24px 0;">')
            elif stripped:
                out.append(f'<p style="margin:8px 0;color:#44403c;line-height:1.6;">{stripped}</p>')
    if in_table:
        out.append('</table>')
    return '\n'.join(out)


def main():
    if len(sys.argv) < 2:
        print("Usage: report-to-email.py <report.md>", file=sys.stderr)
        sys.exit(1)

    with open(sys.argv[1], 'r') as f:
        md = f.read()

    html_body = md_to_html(md)
    date = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    wrapper = f'''<div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;max-width:700px;margin:0 auto;padding:20px;background:#fafaf9;">
<div style="text-align:center;margin-bottom:24px;">
<span style="font-family:serif;font-size:28px;color:#1c1917;">lyra</span>
</div>
{html_body}
<div style="text-align:center;margin-top:32px;padding-top:16px;border-top:1px solid #e7e5e4;">
<span style="font-size:12px;color:#a8a29e;">Lyra Weekly Report &mdash; generated automatically by GitHub Actions</span>
</div>
</div>'''

    payload = {
        'from': 'Lyra Reports <reports@checklyra.com>',
        'to': ['luisa@santos-stephens.com'],
        'subject': f'Lyra Weekly Report — {date}',
        'html': wrapper
    }
    print(json.dumps(payload))


if __name__ == '__main__':
    main()
