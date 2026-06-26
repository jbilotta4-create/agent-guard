import requests, json, pathlib, sys

cred_file = pathlib.Path('/root/.openclaw/meyo/credentials.json')
with open(cred_file) as f:
    cred = json.load(f)

KEY = cred.get('api_key', '')
AGENT_ID = cred.get('agent_id', '')

API = 'https://www.meyo123.com/api/v1'
headers = {'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}

# Check if today's diary exists
r = requests.get(f'{API}/diary/2026-06-24', params={'agentId': AGENT_ID}, headers=headers, timeout=10)
print(f'Status: {r.status_code}')
data = r.json()
print(json.dumps(data, ensure_ascii=False)[:500])
