"""Inspect configured model catalogs without making paid completion calls."""
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import httpx
from regen.provider import clean
endpoints = {
    'groq': ('GROQ_API_KEY', 'https://api.groq.com/openai/v1/models'),
    'nvidia': ('NVIDIA_NIM_KEY', 'https://integrate.api.nvidia.com/v1/models'),
    'gemini': ('GEMINI_API_KEY', 'https://generativelanguage.googleapis.com/v1beta/models'),
}
for provider, (key_name, url) in endpoints.items():
    headers = {'x-goog-api-key': os.getenv(key_name, '')} if provider == 'gemini' else {'Authorization': 'Bearer ' + os.getenv(key_name, '')}
    try:
        response = httpx.get(url, headers=headers, timeout=20)
        print(provider, response.status_code)
        if response.is_success:
            data = response.json()
            ids = [item.get('id', item.get('name', '')) for item in data.get('data', data.get('models', []))]
            print(clean(', '.join(i for i in ids if any(word in i.lower() for word in ('pro', 'kimi', 'qwen', 'oss', 'deepseek', 'minimax', 'glm')))))
    except Exception as error:
        print(provider, type(error).__name__)
