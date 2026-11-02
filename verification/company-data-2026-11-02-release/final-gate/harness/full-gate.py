"""Run the unchanged full verifier after explicit source freeze; preserve historical artifacts."""
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlsplit
import argparse
import fcntl
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import xml.etree.ElementTree as ET

import psycopg

ROOT = None
TARGET = None
ENVIRONMENT_FILE = Path('/tmp/signalbrief-nov2-isolated-selector-fix-environment.json')
LOG_NAMES = ['checks.json', 'pytest.xml', 'python_compile.log', 'backend_tests.log',
             'openapi_export.log', 'backend_lint.log', 'frontend_lint.log',
             'frontend_typecheck.log', 'frontend_unit_tests.log', 'frontend_build.log']
GENERATED = ['packages/shared/openapi.json', 'apps/web/next-env.d.ts']
PROTECTED = ['verification/' + name for name in LOG_NAMES] + GENERATED
EXPECTED = {
    'SB_TEST_POSTGRES_URL': (55458, 'signalbrief_test'),
    'SB_TEST_HOSTED_POSTGRES_URL': (55459, 'hosted_test'),
    'SB_TEST_WORKSPACE_POSTGRES_URL': (55460, 'workspace_test'),
    'SB_TEST_CALENDAR_POSTGRES_URL': (55461, 'calendar_test'),
}


def utcnow():
    return datetime.now(timezone.utc).isoformat()


def preflight():
    settings = json.loads(ENVIRONMENT_FILE.read_text())
    env = dict(os.environ)
    env.update(settings['environment'])
    env['SB_CAREER_POSTGRES_URL'] = env['SB_TEST_POSTGRES_URL']
    findings = {}
    for key, (port, database) in EXPECTED.items():
        url = env[key].replace('postgresql+psycopg://', 'postgresql://', 1)
        parsed = urlsplit(url)
        assert parsed.hostname == '127.0.0.1' and parsed.port == port
        assert parsed.path == '/' + database and database.endswith('_test')
        with psycopg.connect(url, connect_timeout=5, application_name='signalbrief-final-preflight') as conn:
            conn.execute('SET TRANSACTION READ ONLY')
            row = conn.execute("""SELECT current_database(), host(inet_server_addr()),
                current_setting('port'), current_setting('data_directory'),
                to_regclass('public.users'),
                (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()
                 AND pid<>pg_backend_pid() AND backend_type='client backend')""").fetchone()
            assert row[0] == database and row[1] == '127.0.0.1' and row[2] == str(port)
            assert row[4] is None, f'{key} is populated; no automatic reset is permitted'
            assert row[5] == 0, f'{key} has another client; wait for its owner to release it'
            if key == 'SB_TEST_HOSTED_POSTGRES_URL':
                assert row[3] == settings['clusters'][key]['data_directory']
                assert conn.execute("SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated')").fetchone()[0] == 0
            findings[key] = {'port': port, 'database': database, 'data_directory': row[3],
                             'public_users': row[4], 'other_clients': row[5]}
    return env, findings


def no_concurrent_next_dev():
    conflicts = []
    for process in Path('/proc').iterdir():
        if not process.name.isdigit() or int(process.name) == os.getpid():
            continue
        try:
            cwd = (process / 'cwd').resolve()
            if cwd != ROOT / 'apps/web':
                continue
            args = (process / 'cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace')
            if ('next' in args and ' dev' in args) or 'npm run dev' in args:
                conflicts.append(int(process.name))
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
    assert not conflicts, f'Local Next dev shares the build directory; stop PIDs {conflicts} first'


def main():
    global ROOT, TARGET
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['preflight', 'run'])
    parser.add_argument('source', type=Path)
    args = parser.parse_args()
    ROOT = args.source.resolve()
    assert ROOT.parent == Path('/tmp') and ROOT.name.startswith('signalbrief-nov2-final-source-')
    assert (ROOT / 'scripts/verify.py').is_file()
    snapshot_file = ROOT.with_suffix('.json')
    assert snapshot_file.is_file(), 'Immutable snapshot identity record is required'
    snapshot = json.loads(snapshot_file.read_text())
    assert snapshot['source_directory'] == str(ROOT) and snapshot['verified_tree']
    for entry in snapshot['blobs']:
        path = ROOT / entry['path']
        content = os.readlink(path).encode() if entry['mode'] == '120000' else path.read_bytes()
        digest = hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
        assert digest == entry['sha'], f"Immutable snapshot changed before verification: {entry['path']}"
    TARGET = Path('/tmp/signalbrief-nov2-selector-fix-gate-artifacts') / snapshot['tree']
    env, databases = preflight()
    no_concurrent_next_dev()
    if args.action == 'preflight':
        print(json.dumps({'preflight': 'PASS', 'databases': databases,
                          'output': str(TARGET), 'full_verifier_started': False}, indent=2))
        return 0
    assert not TARGET.exists() or not any(TARGET.iterdir()), 'Refusing to overwrite prior final combined evidence'
    lock = Path('/tmp/signalbrief-local-full-gate.lock').open('a+')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    started = utcnow()
    backup = Path('/tmp') / ('signalbrief-nov2-selector-fix-backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + str(os.getpid()))
    backup.mkdir()
    snapshots = {}
    for rel in PROTECTED:
        path = ROOT / rel
        snapshots[rel] = path.read_bytes() if path.exists() else None
        if path.exists():
            destination = backup / rel
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)
    (backup / 'manifest.json').write_text(json.dumps({rel: None if data is None else hashlib.sha256(data).hexdigest() for rel, data in snapshots.items()}, indent=2) + '\n')
    TARGET.mkdir(parents=True, exist_ok=True)
    returncode = 1
    child = None
    interrupted = None
    print(json.dumps({'started_at': started, 'command': [sys.executable, 'scripts/verify.py', '--full'],
                      'backup': str(backup), 'output': str(TARGET)}), flush=True)
    try:
        for name in LOG_NAMES:
            (ROOT / 'verification' / name).unlink(missing_ok=True)
        with (TARGET / 'verifier-console.log').open('w') as console:
            child = subprocess.Popen([sys.executable, 'scripts/verify.py', '--full'], cwd=ROOT,
                                     env=env, stdout=console, stderr=subprocess.STDOUT, start_new_session=True)
            returncode = child.wait()
    except BaseException as error:
        interrupted = type(error).__name__ + ': ' + str(error)
        if child is not None and child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
    finally:
        for name in LOG_NAMES:
            source = ROOT / 'verification' / name
            if source.exists():
                shutil.copy2(source, TARGET / name)
        for rel in GENERATED:
            source = ROOT / rel
            if source.exists():
                destination = TARGET / 'generated' / rel
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
        for rel, data in snapshots.items():
            path = ROOT / rel
            if data is None:
                path.unlink(missing_ok=True)
            else:
                shutil.copy2(backup / rel, path)
        restored = all((ROOT / rel).read_bytes() == data if data is not None else not (ROOT / rel).exists()
                       for rel, data in snapshots.items())
    report_path = TARGET / 'checks.json'
    report = json.loads(report_path.read_text()) if report_path.exists() else None
    if report is not None:
        shutil.copy2(report_path, TARGET / 'checks.raw.json')
        for result in report.get('results', []):
            if result.get('log'):
                result['log'] = str(TARGET / Path(result['log']).name)
        report['capture'] = {'original_report': str(TARGET / 'checks.raw.json'),
                             'historical_outputs_restored': restored}
        report_path.write_text(json.dumps(report, indent=2) + '\n')
    junit = TARGET / 'pytest.xml'
    backend = None
    if junit.exists():
        suites = ET.parse(junit).getroot().findall('testsuite')
        backend = {key: sum(int(s.get(key, '0')) for s in suites) for key in ('tests', 'failures', 'errors', 'skipped')}
    success = (returncode == 0 and restored and backend is not None and backend['skipped'] == 0
               and report is not None and len(report.get('results', [])) == 8
               and all(r['status'] == 'PASS' for r in report['results']))
    capture = {'started_at': started, 'finished_at': utcnow(), 'returncode': returncode,
               'status': 'PASS' if success else 'FAIL', 'interrupted': interrupted,
               'databases': databases, 'backend_junit': backend, 'historical_outputs_restored': restored,
               'protected_paths': PROTECTED, 'backup_directory': str(backup),
               'source_snapshot': {key: value for key, value in snapshot.items() if key != 'blobs'},
               'shared_source_mutations': False, 'production_access': False}
    (TARGET / 'capture.json').write_text(json.dumps(capture, indent=2) + '\n')
    print(json.dumps(capture, indent=2), flush=True)
    return 0 if success else 1


if __name__ == '__main__':
    def stop(_signum, _frame):
        raise KeyboardInterrupt('Termination requested')
    signal.signal(signal.SIGTERM, stop)
    sys.exit(main())
