#!/usr/bin/env python3
"""Prepare ignored Switch configuration; never start services or print secrets."""
from pathlib import Path
import os
import shutil
import secrets
import subprocess

ROOT = Path(__file__).resolve().parents[2]
UPSTREAM = ROOT / ".local/upstream-switch"
PIN = "0d2a57ce643a57a56cd955f6a80324327558f0dd"


def main():
    actual = subprocess.run(
        ["git", "-C", str(UPSTREAM), "rev-parse", "HEAD"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    if actual != PIN:
        raise SystemExit("Upstream source revision differs from the reviewed Phase 0 pin")
    subprocess.run(
        ["git", "-C", str(UPSTREAM), "diff", "--quiet", "HEAD"], check=True
    )
    env_path = UPSTREAM / ".env"
    if env_path.exists():
        raise SystemExit("Existing Switch .env preserved; refusing to rotate or overwrite secrets")
    if not shutil.which("openssl"):
        raise SystemExit("The official generator requires openssl; nothing was installed")
    os.umask(0o077)
    with env_path.open("x", encoding="utf-8") as output:
        output.write((UPSTREAM / ".env.example").read_text(encoding="utf-8"))
    try:
        result = subprocess.run(
            ["bash", str(UPSTREAM / "deploy/local/generate-env-secrets.sh"),
             str(env_path), "creavate-phase0"],
            cwd=UPSTREAM, capture_output=True, text=True,
        )
        if result.returncode:
            raise RuntimeError("Official secret generator failed; output withheld to protect credentials")
        overrides = {
            "SWITCH_VERSION": "phase0-" + PIN[:12],
            "SWITCH_BIND_ADDR": "127.0.0.1",
            "API_HOST_PORT": "18000",
            "GATEWAY_HOST_PORT": "13000",
            "POSTGRES_HOST_PORT": "15432",
            "FRONTEND_BASE_URL": "http://127.0.0.1:13000",
            "TELEMETRY_ENABLED": "false",
            "FEATURE_FLAGS_ENABLED": "agent_management",
            "CONTROLLER_TOKEN_SECRET": secrets.token_hex(32),
            "GATEWAY_PUBLIC_URL": "http://127.0.0.1:18000",
        }
        lines = []
        found = set()
        for line in env_path.read_text(encoding="utf-8").splitlines():
            name = line.partition("=")[0]
            if name in overrides:
                lines.append(name + "=" + overrides[name])
                found.add(name)
            else:
                lines.append(line)
        lines.extend(name + "=" + value for name, value in overrides.items() if name not in found)
        env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        env_path.chmod(0o600)
    except Exception:
        # Preserve generated configuration for inspection, never regenerate silently.
        env_path.chmod(0o600)
        raise
    print("Prepared ignored Switch .env with the official secret generator.")
    print("Source pin: " + PIN)
    print("Planned loopback ports: API 18000, Gateway 13000, PostgreSQL 15432.")
    print("No containers started; no endpoint or Slack behavior has been verified.")


if __name__ == "__main__":
    main()
