"""Bounded real HTTP smoke with portable graceful subprocess shutdown."""

import argparse
import json
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

import uvicorn


def child(service: str) -> None:
    from services.api.main import app as api
    from services.worker.main import app as worker

    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        server = uvicorn.Server(
            uvicorn.Config(api if service == "api" else worker, log_level="error")
        )
        thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]})
        thread.start()
        deadline = time.monotonic() + 10
        while not server.started:
            if not thread.is_alive() or time.monotonic() >= deadline:
                raise RuntimeError("server startup failed")
            time.sleep(0.05)
        print(listener.getsockname()[1], flush=True)
        try:
            sys.stdin.readline()
        finally:
            server.should_exit = True
            thread.join(timeout=5)
            if thread.is_alive():
                raise RuntimeError("server did not shut down gracefully")


def smoke(service: str) -> None:
    process = subprocess.Popen(
        [sys.executable, "-m", "scripts.health_smoke", "--child", service],
        cwd=Path(__file__).resolve().parents[1],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert process.stdout is not None
        output = process.stdout
        # A separate reader bounds even a child that never reports startup.
        result: list[str] = []
        reader = threading.Thread(target=lambda: result.append(output.readline()), daemon=True)
        reader.start()
        reader.join(timeout=15)
        if reader.is_alive() or not result or not result[0].strip().isdigit():
            raise RuntimeError(f"{service} startup timed out or failed")
        base = f"http://127.0.0.1:{int(result[0])}"
        with urlopen(base + "/health/live", timeout=3) as response:
            assert response.status == 200
            assert response.headers["Cache-Control"] == "no-store"
            assert json.load(response) == {"status": "alive", "service": service}
        try:
            urlopen(base + "/health/ready", timeout=3)
        except HTTPError as error:
            assert error.code == 503
            assert json.load(error) == {"status": "not_ready", "reason": "foundation_only"}
        else:
            raise AssertionError("foundation must not claim dependency readiness")
        _, errors = process.communicate("stop\n", timeout=8)
        assert process.returncode == 0, errors
        try:
            urlopen(base + "/health/live", timeout=1)
        except URLError:
            pass
        else:
            raise AssertionError("port still serving after shutdown")
        print(f"{service}: HTTP live 200 / ready 503 / graceful shutdown passed")
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate(timeout=5)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--child", choices=["api", "worker"])
    args = parser.parse_args()
    if args.child:
        child(args.child)
    else:
        for service in ("api", "worker"):
            smoke(service)


if __name__ == "__main__":
    main()
