"""Frozen entrypoint: existing PRAXIS engine, no alternative review logic."""
from __future__ import annotations
import os
import sys

if __name__ == '__main__':
    if sys.argv[1:] == ['--install-browser']:
        from playwright.__main__ import main
        sys.argv = ['playwright', 'install', 'chromium']
        main()
    else:
        import uvicorn
        uvicorn.run('regen.app:app', host='127.0.0.1', port=int(os.environ['REGEN_BACKEND_PORT']), log_level='warning', access_log=False)
