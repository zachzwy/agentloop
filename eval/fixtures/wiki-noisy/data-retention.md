# Data retention

Raw telemetry is retained for **90 days**. Rows tagged PII are purged earlier —
after **14 days** — by the nightly **Nightjar** job. Aggregated metrics are kept
indefinitely.
