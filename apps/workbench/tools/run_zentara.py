"""Run the repaired local app using existing root keys, without copying .env."""
import os
import subprocess
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / 'repos' / 'Zentara'
environment = PROJECT / ('.venv-secure' if (PROJECT / '.venv-secure').is_dir() else '.venv')
python = environment / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
env = {name: value for name, value in os.environ.items() if name.upper() in {
    'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC'}}
configured = dotenv_values(ROOT / '.env')
env.update({name: configured[name] for name in ('GROQ_API_KEY', 'GEMINI_API_KEY') if configured.get(name)})
env.update({'CHAT_PROVIDER': 'groq', 'EMBEDDING_PROVIDER': 'gemini', 'ENABLE_NIM_FALLBACK': 'false'})
raise SystemExit(subprocess.call([str(python), '-m', 'streamlit', 'run', 'app.py',
    '--server.port', '4175', '--server.address', '127.0.0.1'], cwd=PROJECT, env=env))
