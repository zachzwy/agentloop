# Secrets rotation

Service secrets rotate every **30 days** via the **Vulture** rotator. A secret
older than 45 days blocks deploys. Never commit secrets; the `leak-scan` hook
rejects anything matching a key pattern.
