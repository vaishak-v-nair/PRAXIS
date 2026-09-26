"""Bounded live retrieval/chat check using existing keys without copying .env."""
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / 'repos' / 'Zentara'
load_dotenv(ROOT / '.env', override=False)
os.environ.update({'CHAT_PROVIDER': 'groq', 'EMBEDDING_PROVIDER': 'gemini',
                   'ENABLE_NIM_FALLBACK': 'false', 'MAX_ATTEMPTS': '1',
                   'REQUEST_TIMEOUT': '60', 'MAX_OUTPUT_TOKENS': '4096'})
sys.path.insert(0, str(PROJECT))

try:
    from ingest import build_vectorstore
    import rag
    from rag import build_rag_chain

    original_factory = rag.get_chat_model
    responses = []
    class Recorder:
        def __init__(self):
            self.model = original_factory()
        def invoke(self, *args, **kwargs):
            response = self.model.invoke(*args, **kwargs)
            responses.append(response)
            return response
    rag.get_chat_model = Recorder

    store = build_vectorstore()
    count = len(store.get(include=[])['ids'])
    chain, _ = build_rag_chain()
    result = chain.invoke({'input': 'What is the rated payload capacity of the ZR-400 Talos?', 'chat_history': []})
    passed = result['citation_status'] == 'valid' and '400' in result['answer'] and bool(result['sources'])
    report = {'passed': passed, 'index_chunks': count, 'provider': result['provider'],
              'used_fallback': result['used_fallback'], 'citation_status': result['citation_status'],
              'diagnostics': result.get('response_diagnostics', {}),
              'answer_characters': len(result['answer']),
              'sources': [{key: source[key] for key in ('source', 'page', 'label')} for source in result['sources']]}
    if not passed and responses:
        # Local, ignored debugging artifact: final text only, never reasoning/provider bodies.
        text = str(responses[-1].content)[:500]
        for name, value in os.environ.items():
            if any(marker in name.upper() for marker in ('KEY', 'TOKEN', 'SECRET', 'PASSWORD')) and len(value) > 6:
                text = text.replace(value, '[REDACTED]')
        (ROOT / '.regen' / 'artifacts' / 'zentara-answer-debug.txt').write_text(text, encoding='utf-8')
except Exception as error:
    # Provider/library errors can echo input and credentials; only log their category.
    report = {'passed': False, 'error_category': type(error).__name__}
(ROOT / '.regen' / 'artifacts' / 'zentara-live.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report), flush=True)
if not report['passed']:
    raise SystemExit(1)
