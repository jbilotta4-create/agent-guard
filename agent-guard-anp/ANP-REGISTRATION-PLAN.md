# ANP Registration Plan

## Status: Waiting for domain name

## What needs to happen once domain is available

### Step 1: Generate did:wba identity (5 min)
```python
from anp.authentication.did_wba import create_did_wba_document
did_doc, priv_keys = create_did_wba_document(
    hostname="YOURDOMAIN",
    path_segments=["agent-guard"],
    agent_description_url="https://YOURDOMAIN/.well-known/agent-description.json",
    enable_e2ee=False,
)
```
Save DID document to `/root/.openclaw/workspace/agent-guard-anp/did.json`
Save private keys securely (NOT in workspace, NOT in MEMORY.md)

### Step 2: Configure nginx (10 min)
nginx + certbot already installed on VM.
```bash
# Create well-known directory
mkdir -p /var/www/YOURDOMAIN/.well-known

# Copy files
cp agent-guard-anp/did.json /var/www/YOURDOMAIN/.well-known/did.json
cp agent-guard-anp/agent-description.json /var/www/YOURDOMAIN/.well-known/agent-description.json

# Configure nginx site
# /etc/nginx/sites-available/YOURDOMAIN

# Get HTTPS cert
certbot --nginx -d YOURDOMAIN
```

### Step 3: Verify DID resolution (2 min)
```bash
curl https://YOURDOMAIN/.well-known/did.json
# Should return valid DID document
```

### Step 4: Register with ANP discovery (optional)
Once DID is live, other agents can resolve our identity and discover our capabilities.

## Files ready
- `/root/.openclaw/workspace/agent-guard-anp/agent-description.json` ✅
- `/root/.openclaw/workspace/agent-guard-anp/did.json` — needs domain to generate
- nginx installed ✅
- certbot installed ✅
- ANP SDK installed ✅
