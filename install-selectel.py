#!/usr/bin/env python3
"""Pinned, additive Evotor ingress for the existing PIVNIK Selectel VM.

No provider credentials, .env reads, database access, APK updates or VK restarts.
The entry source is a separately reviewed branch, not main. See release notes.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

VERSION = 'selectel-evotor-20261016-r1'
SOURCE = 'd396226d8876e46b50c8fb217e79287be833a337'
RAW = 'https://raw.githubusercontent.com/GrafTrahula666/pivnik-bonus-app/' + SOURCE
MAIN = 'https://pivnik-bonus-app-production-df60.up.railway.app'
SITE = 'https://139.100.238.159.nip.io'
ORIGIN = 'https://prod-app54694987-check.pages-ac.vk-apps.ru'
ROOT = Path('/opt/pivnik-vk-gateway/vk-api-gateway')
CADDY = 'vk-api-gateway-caddy-1'
VK = 'vk-api-gateway-gateway-1'
ENTRY = 'pivnik-evotor-entry'
RELEASE_PARENT = Path('/opt')
PREFIX = 'pivnik-evotor-release-'
EXPECTED = {
    'Caddyfile': '70f89466a92fab3e2e7b33e9ea9cdd9c34d76dfcfce4826a678e4fe792ba33ef',
    'docker-compose.yml': 'f6a8c83c21ac4c16d13de9233c96a6f78571da75f671b68398396a002d18ef5a',
    'server.mjs': '5bbb11259b3b016b9cbc80f9d315859c35d5446d31ee0407dceff5cfe1e6d127',
}
SOURCE_HASHES = {
    '.dockerignore': '7b6e9fd2d55ad54c588f0504238512679e30f947f87a301e6ed46fbc1ffafe6c',
    'Dockerfile': '76b7202ac5ccc58b13b75243862419b36918c873229fe8b0cd79276f682e40ec',
    'package.json': '9259798ea8ac1d3da080f8c9a305a9a146be6a4a454f2c4fa303b28ee2faf442',
    'server.mjs': 'edb5565ff9e81c6f8ddc574a098b357f76aeef9302ad1da88fc5d5e7c1fa4871',
}
CANDIDATE = b'''{$GATEWAY_DOMAIN} {
  encode zstd gzip

  handle_path /evotor/* {
    reverse_proxy evotor-entry:8080
  }

  @gateway path /api /api/* /healthz /readyz
  handle @gateway {
    reverse_proxy gateway:8080
  }

  handle {
    root * /srv/pivnik-vk
    try_files {path} /index.html
    file_server
  }

  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "no-referrer"
    Cache-Control "no-store"
    -Server
  }
}
'''
LABEL = 'io.pivnik.evotor-install'


class InstallError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise InstallError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def run(args, *, timeout=25, data=None, visible=False):
    """Never dump docker inspect output or environment values on failures."""
    try:
        result = subprocess.run(args, input=data, stdout=None if visible else subprocess.PIPE,
                                stderr=None if visible else subprocess.PIPE, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise InstallError('Command timed out: ' + ' '.join(args[:3])) from None
    require(result.returncode == 0, 'Command failed: ' + ' '.join(args[:3]))
    return result.stdout or b''


def inspect(name):
    return json.loads(run(['docker', 'inspect', name]))[0]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(url, *, method='GET', body=None, headers=None, limit=1024 * 1024):
    require(url.startswith('https://'), 'HTTPS required')
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={'User-Agent': 'PIVNIK-Entry-Installer/1', **(headers or {})})
    try:
        response = urllib.request.build_opener(NoRedirect).open(req, timeout=12)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        payload = response.read(limit + 1)
        require(len(payload) <= limit, 'HTTP response too large')
        return response.status, {k.lower(): v for k, v in response.headers.items()}, payload


def healthy_main(status, body):
    require(status == 200, 'Main backend did not return HTTP 200')
    data = json.loads(body)
    require(data.get('ok') is True and data.get('database') == 'ok'
            and data.get('environment') == 'production', 'Unexpected main backend identity')
    fingerprint = data.get('databaseFingerprint')
    require(isinstance(fingerprint, str) and bool(fingerprint), 'Missing main database fingerprint')
    return fingerprint


def require_pos_refusal(status, body, path):
    data = json.loads(body)
    # The current public gateway can emit the exact localized error without
    # code; an arbitrary proxy's HTTP 401 is never sufficient.
    require(status == 401 and (data.get('code') == 'unauthorized_pos'
                              or data.get('error') == 'Требуется ключ кассы.'),
            'Expected main POS authorization boundary missing: ' + path)


def baseline():
    status, _, body = request(SITE + '/healthz')
    require(status == 200 and json.loads(body).get('gateway') == 'vk-native-hosting', 'VK liveness failed')
    status, _, body = request(SITE + '/readyz')
    data = json.loads(body)
    require(status == 200 and data.get('ok') is True and data.get('upstream', {}).get('vk') is True,
            'VK upstream readiness failed')
    status, _, static = request(SITE + '/')
    require(status == 200 and len(static) > 0, 'VK static page failed')
    status, headers, _ = request(SITE + '/api/me', method='OPTIONS', headers={
        'Origin': ORIGIN, 'Access-Control-Request-Method': 'GET'})
    require(status == 204 and headers.get('access-control-allow-origin') == ORIGIN, 'VK CORS failed')
    status, _, _ = request(SITE + '/api/me')
    require(status == 403, 'VK origin guard changed')
    return digest(static)


def write_in_place(path, data, inode):
    """Retain the inode used by an existing read-only Docker file bind mount."""
    fd = os.open(path, os.O_WRONLY | os.O_NOFOLLOW)
    try:
        stat = os.fstat(fd)
        require([stat.st_dev, stat.st_ino] == inode, 'Caddyfile inode changed; stopped')
        os.ftruncate(fd, 0)
        with os.fdopen(fd, 'wb', closefd=False) as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        os.close(fd)


class Deployment:
    def __init__(self, release):
        self.release = Path(release)
        self.state_path = self.release / 'state.json'
        self.state = {}

    def save(self):
        temporary = self.state_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.state, indent=2) + '\n')
        os.replace(temporary, self.state_path)

    def validate(self, content):
        run(['docker', 'exec', '-i', CADDY, 'caddy', 'validate', '--config', '/dev/stdin',
             '--adapter', 'caddyfile'], data=content)

    def reload(self):
        run(['docker', 'exec', CADDY, 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile',
             '--adapter', 'caddyfile'])

    def remove_entry(self):
        entry_id = self.state.get('entryId')
        if not entry_id:
            # Recover a create-success/save-interrupted window using this release's
            # unique ownership label, never a similarly named unrelated container.
            entry_id = run(['docker', 'ps', '-aq', '--filter', 'name=^/' + ENTRY + '$',
                            '--filter', 'label=' + LABEL + '=' + str(self.release)]).strip().decode()
        if entry_id:
            current = inspect(entry_id)
            require(current['Config']['Labels'].get(LABEL) == str(self.release),
                    'Sidecar ownership mismatch; not removed')
            run(['docker', 'rm', '-f', entry_id])
            self.state['entryId'] = None
            self.save()

    def rollback(self, *, interrupted_write=False):
        self.state = json.loads(self.state_path.read_text())
        require(self.state.get('version') == VERSION, 'Unknown rollback state')
        original = (self.release / 'Caddyfile.original').read_bytes()
        require(digest(original) == EXPECTED['Caddyfile'], 'Backup checksum mismatch')
        current = (ROOT / 'Caddyfile').read_bytes()
        if self.state.get('caddyTouched'):
            require(interrupted_write or digest(current) in (digest(original), digest(CANDIDATE)),
                    'Caddyfile changed by another operation; automatic rollback stopped')
            current_caddy = inspect(CADDY)
            require(current_caddy['Id'] == self.state['caddyId'], 'Caddy container changed; rollback stopped')
            self.validate(original)
            write_in_place(ROOT / 'Caddyfile', original, self.state['inode'])
            self.reload()
            self.state['caddyTouched'] = False
            self.save()
        self.remove_entry()
        self.state['status'] = 'rolled_back'
        self.save()
        print('ROLLBACK OK: original Caddy configuration restored; VK containers not restarted.', flush=True)

    def install(self, metadata, network, static_hash, fingerprint):
        original = (ROOT / 'Caddyfile').read_bytes()
        stat = (ROOT / 'Caddyfile').stat()
        self.state = {'version': VERSION, 'status': 'preparing', 'source': SOURCE,
                      'caddyId': metadata[0]['Id'], 'vkId': metadata[1]['Id'],
                      'caddyStarted': metadata[0]['State']['StartedAt'],
                      'vkStarted': metadata[1]['State']['StartedAt'],
                      'inode': [stat.st_dev, stat.st_ino], 'caddyTouched': False, 'entryId': None}
        (self.release / 'Caddyfile.original').write_bytes(original)
        shutil.copyfile(ROOT / 'docker-compose.yml', self.release / 'docker-compose.original.yml')
        shutil.copyfile(__file__, self.release / 'manage.py')
        self.save()
        (self.release / 'ROLLBACK.txt').write_text('python3 ' + str(self.release / 'manage.py')
                                                + ' --rollback ' + str(self.release) + '\n')
        try:
            print('Downloading pinned entry source and verifying SHA-256...', flush=True)
            source = self.release / 'source'
            source.mkdir()
            for name, expected in SOURCE_HASHES.items():
                status, _, body = request(RAW + '/' + name)
                require(status == 200 and digest(body) == expected, 'Source checksum failed: ' + name)
                (source / name).write_bytes(body)
            print('Building isolated entry (first run can take several minutes)...', flush=True)
            image = 'pivnik-evotor-entry:' + SOURCE[:12]
            run(['docker', 'build', '--label', LABEL + '=' + str(self.release), '-t', image, str(source)],
                timeout=600, visible=True)
            image_id = json.loads(run(['docker', 'image', 'inspect', image]))[0]['Id']
            self.state['imageId'] = image_id
            self.state['status'] = 'starting_entry'
            self.save()
            run(['docker', 'create', '--name', ENTRY, '--label', LABEL + '=' + str(self.release),
                 '--network', network, '--network-alias', 'evotor-entry', '--restart', 'unless-stopped',
                 '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
                 '--pids-limit', '64', '--memory', '128m', '--cpus', '0.5',
                 '--log-driver', 'local', '--log-opt', 'max-size=5m', '--log-opt', 'max-file=2', image_id])
            self.state['entryId'] = inspect(ENTRY)['Id']
            self.save()
            run(['docker', 'start', self.state['entryId']])
            print('Checking main backend from the actual entry container...', flush=True)
            script = '''
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ready = false;
for (let attempt = 0; attempt < 20; attempt++) {
  try { const r = await fetch('http://127.0.0.1:8080/ready', {signal: AbortSignal.timeout(1000)});
    if (r.ok) { ready = true; break; } } catch {}
  await sleep(250);
}
if (!ready) process.exit(2);
const r = await fetch('http://127.0.0.1:8080/api/health', {signal: AbortSignal.timeout(9000)});
const data = await r.json();
if (r.status !== 200 || data.ok !== true || data.database !== 'ok' || data.environment !== 'production') process.exit(3);
console.log(JSON.stringify({fingerprint: data.databaseFingerprint}));
'''
            result = json.loads(run(['docker', 'exec', ENTRY, 'node', '--input-type=module', '-e', script]))
            require(result.get('fingerprint') == fingerprint, 'Entry connects to a different backend')
            self.validate(CANDIDATE)
            for name, expected in EXPECTED.items():
                require(digest((ROOT / name).read_bytes()) == expected, 'Configuration changed during install: ' + name)
            self.state['caddyTouched'] = True
            self.state['status'] = 'writing_caddy'
            self.save()
            write_in_place(ROOT / 'Caddyfile', CANDIDATE, self.state['inode'])
            self.state['status'] = 'reloading_caddy'
            self.save()
            require(digest(run(['docker', 'exec', CADDY, 'cat', '/etc/caddy/Caddyfile'])) == digest(CANDIDATE),
                    'Running Caddy does not see the candidate bind mount')
            self.reload()
            print('Checking public Evotor route and existing VK service...', flush=True)
            status, headers, body = request(SITE + '/evotor/api/health')
            require(headers.get('x-pivnik-entry') == '1' and healthy_main(status, body) == fingerprint,
                    'Public entry health or backend identity mismatch')
            for path in ('qr/resolve', 'receipts/bind'):
                status, _, body = request(SITE + '/evotor/api/device/pos/' + path, method='POST',
                                          body=b'{}', headers={'Content-Type': 'application/json'})
                require_pos_refusal(status, body, path)
            require(request(SITE + '/evotor/api/admin/users')[0] == 404, 'Entry route scope changed')
            require(baseline() == static_hash, 'VK static content changed')
            for name, index, key in ((CADDY, 0, 'caddyStarted'), (VK, 1, 'vkStarted')):
                current = inspect(name)
                require(current['Id'] == metadata[index]['Id'] and current['State']['Running']
                        and current['State']['StartedAt'] == self.state[key], 'Existing VK service restarted or changed')
            self.state['status'] = 'installed'
            self.save()
        except BaseException:
            print('Installation did not pass; restoring the prior route...', flush=True)
            try:
                self.rollback(interrupted_write=self.state.get('status') == 'writing_caddy')
            except Exception as error:
                print('ROLLBACK NEEDS ATTENTION: ' + type(error).__name__, flush=True)
                print('Rollback command: python3 ' + str(self.release / 'manage.py')
                      + ' --rollback ' + str(self.release), flush=True)
            raise
        print('\nEVOTOR ROUTE READY: ' + SITE + '/evotor', flush=True)
        print('Health HTTP 200; keyless resolve/bind HTTP 401; VK checks passed.', flush=True)
        print('This verifies the server route only. The physical Evotor is not yet verified.', flush=True)
        print('Backup and rollback command: ' + str(self.release / 'ROLLBACK.txt'), flush=True)


def preflight():
    require(os.geteuid() == 0, 'Run in the existing root console')
    require(socket.gethostname().split('.')[0] == 'pivnik-vk-gateway', 'This installer is only for pivnik-vk-gateway')
    require(os.environ.get('DOCKER_HOST', '') in ('', 'unix:///var/run/docker.sock')
            and os.environ.get('DOCKER_CONTEXT', '') in ('', 'default'), 'Remote Docker context is not allowed')
    require(run(['docker', 'context', 'show']).strip() == b'default', 'Use the local Docker context')
    for name, expected in EXPECTED.items():
        path = ROOT / name
        require(path.is_file() and not path.is_symlink() and digest(path.read_bytes()) == expected,
                'Unexpected installed file; stopped before changes: ' + name)
    metadata = [inspect(CADDY), inspect(VK)]
    for item, service in zip(metadata, ('caddy', 'gateway')):
        labels = item['Config'].get('Labels') or {}
        require(item['State']['Running'] and labels.get('com.docker.compose.project') == 'vk-api-gateway'
                and labels.get('com.docker.compose.service') == service, 'Unexpected existing Compose container')
    mounts = [m for m in metadata[0]['Mounts'] if m['Destination'] == '/etc/caddy/Caddyfile']
    require(len(mounts) == 1 and mounts[0]['Type'] == 'bind'
            and Path(mounts[0]['Source']).resolve() == (ROOT / 'Caddyfile').resolve(), 'Unexpected Caddy bind mount')
    domain = [v.split('=', 1)[1] for v in metadata[0]['Config']['Env'] if v.startswith('GATEWAY_DOMAIN=')]
    require(domain == ['139.100.238.159.nip.io'], 'Unexpected configured HTTPS hostname')
    networks = set(metadata[0]['NetworkSettings']['Networks']) & set(metadata[1]['NetworkSettings']['Networks'])
    require(len(networks) == 1, 'Cannot uniquely identify the existing Docker network')
    network = networks.pop()
    require(not json.loads(run(['docker', 'network', 'inspect', network]))[0]['Internal'], 'Network lacks outbound routing')
    existing = run(['docker', 'ps', '-aq', '--filter', 'name=^/' + ENTRY + '$']).strip()
    require(not existing, 'An Evotor entry already exists; do not reinstall blindly. Send the displayed result.')
    connected = json.loads(run(['docker', 'network', 'inspect', network]))[0].get('Containers', {})
    for container_id in connected:
        aliases = inspect(container_id)['NetworkSettings']['Networks'][network].get('Aliases') or []
        require('evotor-entry' not in aliases, 'The evotor-entry network alias is already in use')
    require(shutil.disk_usage(RELEASE_PARENT).free >= 700 * 1024 * 1024, 'At least 700 MiB of free disk required')
    available = next(int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines()
                     if line.startswith('MemAvailable:'))
    require(available >= 256 * 1024, 'At least 256 MiB of available memory required')
    status, _, body = request(MAIN + '/api/health')
    fingerprint = healthy_main(status, body)
    for path in ('qr/resolve', 'receipts/bind'):
        status, _, body = request(MAIN + '/api/device/pos/' + path, method='POST',
                                  body=b'{}', headers={'Content-Type': 'application/json'})
        require_pos_refusal(status, body, path)
    static_hash = baseline()
    return metadata, network, static_hash, fingerprint


def main():
    os.umask(0o077)
    require(os.geteuid() == 0, 'Run as root')
    require(len(sys.argv) == 1 or (len(sys.argv) == 3 and sys.argv[1] == '--rollback'), 'Unknown arguments')
    with open('/run/lock/pivnik-evotor-entry.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if len(sys.argv) == 3:
            folder = Path(sys.argv[2]).resolve()
            require(folder.parent == RELEASE_PARENT and folder.name.startswith(PREFIX), 'Unexpected rollback directory')
            Deployment(folder).rollback()
            return
        print('Checking installed configuration and both backend paths...', flush=True)
        args = preflight()
        folder = Path(tempfile.mkdtemp(prefix=PREFIX, dir=RELEASE_PARENT))
        print('Backup directory: ' + str(folder), flush=True)
        Deployment(folder).install(*args)


if __name__ == '__main__':
    def interrupted(signum, frame):
        raise InstallError('Interrupted; rollback requested')
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, interrupted)
    try:
        main()
    except Exception as error:
        # Network errors may contain fixed public URLs, never credentials.
        message = str(error) if isinstance(error, InstallError) else type(error).__name__
        print('STOP: ' + message, file=sys.stderr, flush=True)
        sys.exit(1)
