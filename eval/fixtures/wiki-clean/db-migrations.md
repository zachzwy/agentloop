# Database migrations

Migrations run through the **Swift** migrator, expand-then-contract only. A
migration touching more than **1 million** rows must be run in off-peak hours
(before 06:00 UTC) and needs a backfill plan attached.
