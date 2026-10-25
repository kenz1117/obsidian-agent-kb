import os
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]

def load_gateway_env(*, override: bool = False) -> None:
    path = APP_ROOT / "config" / "gateway.env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if override or key not in os.environ:
            os.environ[key] = value
