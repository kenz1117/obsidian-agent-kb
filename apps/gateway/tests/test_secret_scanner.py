import subprocess
from pathlib import Path
import tempfile

APP=Path(__file__).resolve().parents[1]

def test_clean_repository_passes():
  result=subprocess.run([str(APP/"bin/oakb-secret-scan"), str(APP)], capture_output=True, text=True)
  assert result.returncode == 0, result.stderr

def test_rejects_secret():
  with tempfile.TemporaryDirectory() as td:
    p=Path(td)/"bad.md"; p.write_text("API_KEY = 'abcdefghijklmnopqrstuvwxyz123456'")
    result=subprocess.run([str(APP/"bin/oakb-secret-scan"), td], capture_output=True, text=True)
    assert result.returncode != 0
