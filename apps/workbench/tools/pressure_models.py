"""Small, bounded capability probes. Never log keys or model reasoning."""
import concurrent.futures
import json
import os
import time
from pathlib import Path
import httpx
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / '.env')


def nim(model):
    started = time.monotonic()
    content, reasoning_bytes, first_token = '', 0, None
    body = {'model': model, 'messages': [{'role': 'user', 'content': 'Review requests.get(url, verify=False). Return JSON with two short strings: issue and fix. No prose outside JSON.'}], 'max_tokens': 8192, 'reasoning_effort': 'low', 'stream': True}
    try:
        with httpx.Client(timeout=httpx.Timeout(90, connect=15)) as client:
            with client.stream('POST', 'https://integrate.api.nvidia.com/v1/chat/completions', headers={'Authorization': 'Bearer ' + os.getenv('NVIDIA_NIM_KEY', '')}, json=body) as response:
                if not response.is_success:
                    return {'model': model, 'status': response.status_code}
                for line in response.iter_lines():
                    if time.monotonic() - started > 180:
                        return {'model': model, 'status': 'deadline', 'content_chars': len(content)}
                    if not line.startswith('data: ') or line == 'data: [DONE]':
                        continue
                    if first_token is None:
                        first_token = round(time.monotonic() - started, 2)
                    data = json.loads(line[6:])
                    for choice in data.get('choices', []):
                        delta = choice.get('delta', {})
                        content += delta.get('content') or ''
                        reasoning_bytes += len(delta.get('reasoning_content') or '')
        return {'model': model, 'status': 'ok' if content.strip() else 'empty', 'seconds': round(time.monotonic() - started, 2), 'first_token': first_token, 'reasoning_chars': reasoning_bytes, 'answer': content[:1500]}
    except Exception as error:
        return {'model': model, 'status': type(error).__name__, 'seconds': round(time.monotonic() - started, 2)}


def google():
    headers = {'x-goog-api-key': os.getenv('GEMINI_API_KEY', '')}
    results = []
    with httpx.Client(timeout=45) as client:
        for model, operation, body in [
            ('gemini-2.5-flash', 'generateContent', {'contents': [{'parts': [{'text': 'Return the word READY.'}]}], 'generationConfig': {'maxOutputTokens': 512, 'thinkingConfig': {'thinkingBudget': 0}}}),
            ('gemini-embedding-001', 'embedContent', {'model': 'models/gemini-embedding-001', 'content': {'parts': [{'text': 'A harmless capability test.'}]}, 'outputDimensionality': 768}),
        ]:
            try:
                response = client.post(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:{operation}', headers=headers, json=body)
                data = response.json()
                results.append({'model': model, 'status': response.status_code, 'embedding_dimensions': len(data.get('embedding', {}).get('values', []))})
            except Exception as error:
                results.append({'model': model, 'status': type(error).__name__})
    return results


def nim_embedding():
    headers = {'Authorization': 'Bearer ' + os.getenv('NVIDIA_NIM_KEY', '')}
    with httpx.Client(timeout=45) as client:
        try:
            catalog = client.get('https://integrate.api.nvidia.com/v1/models', headers=headers).json()
            models = [item['id'] for item in catalog.get('data', []) if 'embed' in item['id'].lower()]
            model = next((item for item in models if item == 'nvidia/nv-embedqa-e5-v5'), models[0] if models else None)
            if not model:
                return {'embeddings': 'no model', 'models': models}
            response = client.post('https://integrate.api.nvidia.com/v1/embeddings', headers=headers, json={'model': model, 'input': ['A harmless capability test.'], 'input_type': 'query', 'truncate': 'END'})
            data = response.json()
            return {'model': model, 'status': response.status_code, 'embedding_dimensions': len(data.get('data', [{}])[0].get('embedding', [])), 'available_embedding_models': models}
        except Exception as error:
            return {'embeddings': type(error).__name__}


with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
    tasks = [executor.submit(nim, 'moonshotai/kimi-k3'), executor.submit(nim, 'z-ai/glm-5.3'), executor.submit(google), executor.submit(nim_embedding)]
    for future in concurrent.futures.as_completed(tasks):
        print(json.dumps(future.result()), flush=True)
