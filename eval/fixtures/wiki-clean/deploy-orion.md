# Deploying the Orion service

Orion is deployed with `orion-ctl push --ring canary`. The canary ring holds for
**45 minutes** before auto-promoting to the stable ring. To abort, run
`orion-ctl rollback --ring canary` before the hold expires.
