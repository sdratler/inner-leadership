"""Isolated source-only dispatch. Invoked by fishing-facebook-local.mjs only."""
import hashlib
import importlib.abc
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys


def read_only_status():
    """Status cannot create a ledger, write SQL, launch a process or use a socket."""
    connect = sqlite3.connect

    def readonly(database, *args, **kwargs):
        value = str(database)
        if value.startswith("file:"):
            value = value.replace("mode=rw", "mode=ro")
            if "mode=ro" not in value:
                raise RuntimeError("Status requires read-only ledger access")
        else:
            existing = Path(value)
            if not existing.is_file():
                raise RuntimeError("Status requires an existing ledger URI or file")
            value = existing.resolve().as_uri() + "?mode=ro"
            kwargs["uri"] = True
        db = connect(value, *args, **kwargs)
        db.execute("PRAGMA query_only=ON")
        return db

    sqlite3.connect = readonly

    def audit(event, args):
        if event.startswith(("socket.", "subprocess.", "os.spawn", "os.exec")) or event in {
            "os.system", "os.startfile", "os.remove", "os.rename", "os.rmdir", "os.mkdir",
            "os.link", "os.symlink", "os.truncate", "os.chmod", "os.utime",
        }:
            raise RuntimeError("Status cannot use network, processes or filesystem mutations")
        if event == "open":
            _, mode, flags = args
            if (mode and any(c in mode for c in "wax+")) or flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND):
                raise RuntimeError("Status cannot write files")

    sys.addaudithook(audit)


class PinnedSources(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def __init__(self, root, pins, status):
        self.root, self.pins, self.status = root, pins, status

    def find_spec(self, fullname, path=None, target=None):
        if self.status and fullname.split(".")[0] in {"florida_browser", "playwright", "selenium"}:
            raise ImportError("Status cannot load a browser adapter")
        if fullname in self.pins:
            return importlib.util.spec_from_file_location(fullname, self.root / (fullname + ".py"), loader=self)
        if (self.root / (fullname.split(".")[0] + ".py")).exists():
            raise ImportError("Unreviewed poster module: " + fullname)
        return None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        name = module.__spec__.name
        source = (self.root / (name + ".py")).read_bytes()
        if hashlib.sha256(source).hexdigest() != self.pins[name]:
            raise ImportError("Poster source fingerprint changed: " + name)
        # Compile the checked bytes; never consume an existing __pycache__ entry.
        exec(compile(source, module.__spec__.origin, "exec"), module.__dict__)


def main():
    if len(sys.argv) != 4 or sys.argv[2] not in {"status", "run-due"}:
        raise RuntimeError("Use the Fishing local operator entry point")
    root, action, pins = Path(sys.argv[1]).resolve(), sys.argv[2], json.loads(sys.argv[3])
    if action == "run-due":
        if os.name != "nt" or any(k.startswith(("NODE_TEST_", "VITEST", "PYTEST_")) for k in os.environ):
            raise RuntimeError("Tests cannot run the live browser worker")
        # A service/session-zero process cannot operate the owner's visible desktop.
        import ctypes
        session = ctypes.c_uint()
        if not ctypes.windll.kernel32.ProcessIdToSessionId(os.getpid(), ctypes.byref(session)) or session.value == 0:
            raise RuntimeError("The owner's logged-in Windows desktop is required")
    else:
        read_only_status()
    # -I -S excludes cwd, PYTHONPATH, user-site, .pth and sitecustomize startup.
    # Only installed third-party packages are added; project imports use checked source.
    sys.path.append(str(root / ".venv" / "Lib" / "site-packages"))
    sys.meta_path.insert(0, PinnedSources(root, pins, action == "status"))
    module = __import__("florida_campaign" if action == "status" else "florida_browser")
    sys.argv = [module.__file__, action]
    module.main()


if __name__ == "__main__":
    main()
