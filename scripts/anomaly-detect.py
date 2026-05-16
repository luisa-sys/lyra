#!/usr/bin/env python3
"""
Anomaly detection — KAN-63-A first sub-ticket of autonomous monitoring.

Walks rolling-window counts (1h / 24h / 7d) for the four metrics that
matter most for operator awareness:

    * profile_signups      — new users
    * profile_publishes    — profiles flipped to is_published
    * profile_items_added  — new items on profile_items
    * reports_filed        — new user-filed reports (KAN-141)

For each metric × window combination, the script compares the current
value to a baseline computed from the same metric over the trailing
30 days at 1-hour granularity. If the current observation lies more
than 3 standard deviations above OR below the baseline mean, the
script emits a `::warning::` to its stdout (so the calling workflow
can surface it in GitHub Actions logs) and exits 0.

Why exit 0 on detection? Anomalies are an expected operational signal,
not an error. The workflow itself opens / updates a labelled GitHub
issue (the actual alerting surface) — see `cleanup-issue` step in
.github/workflows/anomaly-detect.yml. The script's job is the maths;
the workflow's job is the routing.

This is a stdlib-only Python script (no deps) so the workflow runs on
a clean ubuntu-latest with just `setup-python`.

Calls the Supabase `get_metrics_for_window` Postgres function via
the v1 REST API (`POST /rest/v1/rpc/get_metrics_for_window`) using the
service-role JWT. The function is SECURITY DEFINER + only returns
counts, so the service-role key here is used solely for its bypass
of RLS — no PII is exposed.

Usage:

    SUPABASE_URL=https://<project>.supabase.co \\
    SUPABASE_SERVICE_ROLE_KEY=... \\
        python3 scripts/anomaly-detect.py
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

# Metrics we score. Keep in sync with `get_metrics_for_window` SQL fn.
METRIC_KEYS = (
    "profile_signups",
    "profile_publishes",
    "profile_items_added",
    "reports_filed",
)

# Number of standard deviations from the baseline mean that triggers
# an anomaly. 3σ ≈ 99.7th percentile under a normal distribution —
# tighter than typical SRE practice (3σ for paging) and loose enough
# that quiet weeks don't fire false positives.
SIGMA_THRESHOLD = 3.0


def rpc_call(supabase_url: str, service_role_key: str, body: dict) -> dict:
    """POST to the v1 REST RPC for `get_metrics_for_window`.

    Returns the parsed JSON response. Raises RuntimeError on any
    HTTP error so the caller surfaces it as a workflow failure (we
    DO fail the workflow on Supabase outages — distinct from "no
    anomalies found", which is the steady-state happy path).
    """
    url = f"{supabase_url.rstrip('/')}/rest/v1/rpc/get_metrics_for_window"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = ""
        try:
            body_text = e.read().decode("utf-8")
        except Exception:
            pass
        raise RuntimeError(
            f"Supabase RPC returned HTTP {e.code}: {body_text[:200]}"
        ) from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Supabase RPC network error: {e}") from e


def get_window(
    supabase_url: str, key: str, start: datetime, end: datetime
) -> dict:
    return rpc_call(
        supabase_url,
        key,
        {"p_start_at": start.isoformat(), "p_end_at": end.isoformat()},
    )


def compute_baseline(
    supabase_url: str, key: str, baseline_days: int, now: datetime
) -> dict[str, tuple[float, float]]:
    """Returns {metric_name: (mean, stddev)} computed from `baseline_days`
    1-hour windows.

    Sampling at 1-hour granularity keeps the call count bounded:
    baseline_days=30 → 720 RPCs. At Supabase's free-tier 1000 req/min
    cap this is well within budget and still gives enough samples for
    a meaningful stddev.
    """
    one_hour = timedelta(hours=1)
    samples_per_metric: dict[str, list[float]] = {k: [] for k in METRIC_KEYS}

    for hour_offset in range(baseline_days * 24):
        end = now - hour_offset * one_hour
        start = end - one_hour
        data = get_window(supabase_url, key, start, end)
        for metric in METRIC_KEYS:
            samples_per_metric[metric].append(float(data.get(metric, 0)))

    out: dict[str, tuple[float, float]] = {}
    for metric, samples in samples_per_metric.items():
        mean = sum(samples) / len(samples) if samples else 0.0
        if len(samples) < 2:
            stddev = 0.0
        else:
            variance = sum((s - mean) ** 2 for s in samples) / (len(samples) - 1)
            stddev = math.sqrt(variance)
        out[metric] = (mean, stddev)
    return out


# Public, pure-function entrypoints for testing.

def is_anomalous(
    current: float,
    baseline_mean: float,
    baseline_stddev: float,
    sigma_threshold: float = SIGMA_THRESHOLD,
) -> tuple[bool, str | None]:
    """Decides whether `current` is anomalous relative to the baseline.

    Returns (True, kind) or (False, None). `kind` is 'spike' for high-
    side anomalies or 'drop' for low-side. Both matter: a sudden spike
    in signups might be a bot wave; a sudden drop in items added might
    mean a regression broke the create flow.

    Special case: when baseline_stddev is 0 (cold start, all samples
    identical), we fall back to checking whether `current` differs from
    the mean at all — but only if the baseline has more than zero
    samples. This avoids false-positives on brand-new tables that have
    no historical data yet.
    """
    if baseline_stddev <= 0:
        # Cold-start / quiet-history case. Don't fire on the literal-
        # first-event-ever — that's normal noise.
        if baseline_mean == 0 and current <= 1:
            return False, None
        if current > baseline_mean * 2:
            return True, "spike"
        if current < baseline_mean * 0.5:
            return True, "drop"
        return False, None

    z = (current - baseline_mean) / baseline_stddev
    if z >= sigma_threshold:
        return True, "spike"
    if z <= -sigma_threshold:
        return True, "drop"
    return False, None


def compare_window_against_baseline(
    window_counts: dict[str, int | float],
    baseline_per_metric: dict[str, tuple[float, float]],
    sigma_threshold: float = SIGMA_THRESHOLD,
) -> list[dict]:
    """Returns a list of anomaly findings, one per metric that fires.

    Each finding is a dict with keys: metric, current, mean, stddev, kind, z.
    Suitable for direct JSON dump into a workflow summary or a Sentry
    breadcrumb.
    """
    findings: list[dict] = []
    for metric, current in window_counts.items():
        if metric not in baseline_per_metric:
            continue
        mean, stddev = baseline_per_metric[metric]
        is_a, kind = is_anomalous(float(current), mean, stddev, sigma_threshold)
        if not is_a:
            continue
        z = (float(current) - mean) / stddev if stddev > 0 else float("inf")
        findings.append({
            "metric": metric,
            "current": float(current),
            "mean": round(mean, 2),
            "stddev": round(stddev, 2),
            "z": round(z, 2),
            "kind": kind,
        })
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--windows",
        nargs="+",
        default=["1h", "24h", "7d"],
        help="Which rolling windows to check.",
    )
    parser.add_argument(
        "--baseline-days",
        type=int,
        default=30,
        help="Trailing days to compute the baseline from.",
    )
    parser.add_argument(
        "--sigma-threshold",
        type=float,
        default=SIGMA_THRESHOLD,
        help="Standard deviations from baseline mean that fires anomaly.",
    )
    parser.add_argument(
        "--supabase-url",
        default=os.environ.get("SUPABASE_URL"),
        help="Supabase project URL.",
    )
    parser.add_argument(
        "--supabase-key",
        default=os.environ.get("SUPABASE_SERVICE_ROLE_KEY"),
        help="Service-role key (RPC bypasses RLS but only returns counts).",
    )
    args = parser.parse_args()

    if not args.supabase_url or not args.supabase_key:
        print(
            "::error::SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required",
            file=sys.stderr,
        )
        return 2

    window_seconds = {"1h": 3600, "24h": 86400, "7d": 604800}
    now = datetime.now(timezone.utc)

    # Build the trailing-30d baseline once. The 1h/24h/7d window comparisons
    # all use the same baseline.
    try:
        baseline = compute_baseline(
            args.supabase_url, args.supabase_key, args.baseline_days, now
        )
    except RuntimeError as e:
        print(f"::error::Baseline computation failed: {e}", file=sys.stderr)
        return 1

    # For each rolling window, fetch the current counts and compare.
    total_findings = 0
    for window in args.windows:
        if window not in window_seconds:
            print(f"::warning::Unknown window {window!r} — skipped")
            continue
        end = now
        start = end - timedelta(seconds=window_seconds[window])

        try:
            current = get_window(args.supabase_url, args.supabase_key, start, end)
        except RuntimeError as e:
            print(f"::error::Window fetch failed for {window}: {e}", file=sys.stderr)
            return 1

        findings = compare_window_against_baseline(
            {k: current.get(k, 0) for k in METRIC_KEYS},
            baseline,
            args.sigma_threshold,
        )
        if findings:
            for f in findings:
                print(
                    f"::warning::ANOMALY {window} {f['metric']} {f['kind']}: "
                    f"current={f['current']} vs baseline {f['mean']}±{f['stddev']} (z={f['z']})"
                )
            total_findings += len(findings)
        else:
            print(f"::notice::window={window} — clean")

    print(f"\n=== anomaly-detect summary: {total_findings} finding(s) ===")
    # Always exit zero — anomaly counts are reported to the workflow via
    # stdout, and the workflow decides whether to escalate via issue or
    # email. Exit non-zero only on Supabase outages (handled above).
    return 0


if __name__ == "__main__":
    sys.exit(main())
