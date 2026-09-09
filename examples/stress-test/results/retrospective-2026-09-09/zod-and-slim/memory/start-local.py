#!/usr/bin/env python3
"""Start an existing Convex backend binary with local-only heap diagnostics.

The supplied admin key must match the backend's instance credentials. With no
instance options, the binary uses its built-in development instance (if supported).
This script does not fetch binaries, create account credentials, or change apps.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pty
import signal
import socket
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--binary', required=True, type=Path)
parser.add_argument('--directory', required=True, type=Path)
parser.add_argument('--admin-key', required=True, type=Path,
                    help='Existing credential file; copied privately into directory')
parser.add_argument('--port', type=int, default=38910)
parser.add_argument('--site-port', type=int, default=38911)
parser.add_argument('--instance-name')
parser.add_argument('--instance-secret-file', type=Path)
parser.add_argument('--source-revision', help='Optional known backend source revision')
args = parser.parse_args()
if bool(args.instance_name) != bool(args.instance_secret_file):
    parser.error('--instance-name and --instance-secret-file must be provided together')
if args.port == args.site_port or not all(1024 <= p <= 65535 for p in (args.port, args.site_port)):
    parser.error('Choose distinct ports between 1024 and 65535')
binary = args.binary.resolve(strict=True)
key = args.admin_key.read_text().strip()
if not key:
    parser.error('The admin key file is empty')
directory = args.directory.resolve()
directory.mkdir(parents=True, exist_ok=True, mode=0o700)
if (directory / 'pid').exists():
    try:
        os.kill(int((directory / 'pid').read_text()), 0)
    except (ProcessLookupError, ValueError):
        pass
    else:
        parser.error('The directory records a process that is still running')
for port in (args.port, args.site_port):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', port))
key_path = directory / 'admin-key'
fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as out:
    out.write(key + '\n')
key_path.chmod(0o600)
checksum = hashlib.sha256()
with binary.open('rb') as source:
    for chunk in iter(lambda: source.read(1024 * 1024), b''):
        checksum.update(chunk)
command = [str(binary), '--interface', '127.0.0.1', '--port', str(args.port),
           '--site-proxy-port', str(args.site_port), '--disable-beacon']
if args.instance_name:
    command += ['--instance-name', args.instance_name, '--instance-secret',
                args.instance_secret_file.read_text().strip()]
environment = dict(os.environ, REUSE_ISOLATES='false',
                   ISOLATE_V8_FLAGS='--expose-gc --trace-gc-nvp', DISABLE_BEACON='true')
for name in ('CONVEX_DEPLOY_KEY', 'CONVEX_SELF_HOSTED_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY'):
    environment.pop(name, None)
master, slave = pty.openpty()
process = subprocess.Popen(command, cwd=directory, env=environment,
                           stdout=slave, stderr=slave, start_new_session=True)
os.close(slave)
for event in (signal.SIGINT, signal.SIGTERM):
    signal.signal(event, lambda signum, frame: process.send_signal(signum)
                  if process.poll() is None else None)
metadata = {'binary': str(binary), 'sha256': checksum.hexdigest(),
            'sourceRevision': args.source_revision, 'pid': process.pid,
            'launcherPid': os.getpid(), 'url': f'http://127.0.0.1:{args.port}',
            'flags': environment['ISOLATE_V8_FLAGS'], 'reuseIsolates': False}
(directory / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
(directory / 'pid').write_text(str(process.pid))
print(json.dumps({'directory': str(directory), 'url': metadata['url'],
                  'pid': process.pid}), flush=True)
# A PTY makes native V8 printf output line buffered. A regular pipe/file may
# otherwise hold the final GC event until another request or process shutdown.
try:
    with (directory / 'backend-pty.log').open('wb', buffering=0) as log:
        while True:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            log.write(data)
finally:
    os.close(master)
    if process.poll() is None:
        process.terminate()
    status = process.wait()
raise SystemExit(status if status >= 0 else 128 - status)
