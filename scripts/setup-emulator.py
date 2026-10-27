"""Install Google's official Cloud SDK Firestore emulator, with SHA-256 verification.

This distribution uses dl.google.com rather than the Firebase CLI's separate
storage.googleapis.com download. The hash is from Google's components-2.json.
Python 3.12+ and a JRE 21+ are required. This script never changes CA/proxy trust.
"""
import hashlib
import os
from pathlib import Path
import tarfile
import urllib.request

VERSION = "1.22.0"
URL = "https://dl.google.com/dl/cloudsdk/channels/rapid/components/google-cloud-sdk-cloud-firestore-emulator-20260717053915.tar.gz"
SHA256 = "e962450b637827664094959571fd92c3680de863936bd481bd0a050f76ca91ba"
root = Path(os.environ.get("ARTICULATION_EMULATOR_DIR", ".cache/emulators")).resolve()
root.mkdir(parents=True, exist_ok=True)
archive = root / "firestore.tar.gz"
if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
    print(f"Downloading official Firestore emulator {VERSION}…", flush=True)
    with urllib.request.urlopen(URL, timeout=120) as response, archive.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
    archive.unlink()
    raise RuntimeError("SHA-256 verification failed; the artifact was rejected.")
with tarfile.open(archive) as package:
    package.extractall(root, filter="data")
print(f"Verified Firestore emulator {VERSION}: {root}")
