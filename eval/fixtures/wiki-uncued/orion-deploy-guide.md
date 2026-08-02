# Deploying the Orion service

Orion deployment guide. Deploy Orion with `orion-ctl push --ring canary`. The
Orion canary ring holds for **30 minutes** before auto-promoting the Orion deploy
to the stable ring. Orion canary promote rollback: `orion-ctl rollback --ring canary`.
