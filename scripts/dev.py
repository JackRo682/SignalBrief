"""Start only this repository's demo API, worker and web processes. Ctrl+C stops their process trees."""

import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    os.chdir(ROOT)
    if not (ROOT / ".env").exists():
        shutil.copyfile(ROOT / ".env.example", ROOT / ".env")
    if not (ROOT / "apps/web/.env.local").exists():
        shutil.copyfile(ROOT / "apps/web/.env.local.example", ROOT / "apps/web/.env.local")
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm or not (ROOT / "apps/web/node_modules/next").exists():
        raise SystemExit("First run: python -m pip install -e '.[dev]' ; cd apps/web ; npm install")
    environment = {**os.environ, "PYTHONPATH": str(ROOT / "apps/api")}
    subprocess.run([sys.executable, "-m", "signalbrief.cli", "init-db"], env=environment, check=True)
    commands = [
        (
            [sys.executable, "-m", "uvicorn", "signalbrief.app:app", "--host", "127.0.0.1", "--port", "8000"],
            ROOT,
        ),
        ([sys.executable, "-m", "signalbrief.cli", "worker"], ROOT),
        ([npm, "run", "dev", "--", "--hostname", "127.0.0.1"], ROOT / "apps/web"),
    ]
    processes = []
    try:
        for command, cwd in commands:
            options = (
                {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
                if os.name == "nt"
                else {"start_new_session": True}
            )
            processes.append(
                subprocess.Popen(
                    command,
                    cwd=cwd,
                    env=environment,
                    shell=os.name == "nt" and cwd == ROOT / "apps/web",
                    **options,
                )
            )
        print("SignalBrief local demo: http://localhost:3000  |  API: http://localhost:8000")
        while all(process.poll() is None for process in processes):
            time.sleep(0.5)
        return next((process.returncode for process in processes if process.poll() not in (None, 0)), 1)
    except KeyboardInterrupt:
        return 0
    finally:
        for process in processes:
            if process.poll() is not None:
                continue
            try:
                if os.name == "nt":
                    subprocess.run(
                        ["taskkill", "/PID", str(process.pid), "/T", "/F"], check=False, capture_output=True
                    )
                else:
                    os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        for process in processes:
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                if os.name == "nt":
                    process.kill()
                else:
                    os.killpg(process.pid, signal.SIGKILL)


if __name__ == "__main__":
    raise SystemExit(main())
