"""Locate an existing OpenSSL signer; never download tools or log key material."""
from __future__ import annotations
import os
from pathlib import Path
import shutil
import subprocess


def find_openssl() -> str:
    candidates: list[str] = []
    override = os.environ.get("LS_OPENSSL_PATH")
    if override:
        path = Path(override)
        if not path.is_absolute() or not path.is_file():
            raise ValueError("SIGNER_OVERRIDE_INVALID")
        candidates.append(str(path))
    found = shutil.which("openssl")
    if found:
        candidates.append(found)
    if os.name == "nt":
        for root in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")):
            if root:
                for rel in ("Git/usr/bin/openssl.exe", "OpenSSL-Win64/bin/openssl.exe", "OpenSSL-Win32/bin/openssl.exe"):
                    candidates.append(str(Path(root) / rel))
    for candidate in dict.fromkeys(candidates):
        if not Path(candidate).is_file():
            continue
        try:
            result = subprocess.run([candidate, "version"], capture_output=True, timeout=5, check=True)
            if result.stdout.startswith(b"OpenSSL "):
                return str(Path(candidate).resolve())
        except (OSError, subprocess.SubprocessError):
            continue
    raise ValueError("SIGNER_UNAVAILABLE")
