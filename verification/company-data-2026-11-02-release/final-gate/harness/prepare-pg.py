"""Fresh independent loopback test clusters; fixed fixture roles must not share a cluster."""
from pathlib import Path
from datetime import datetime, timezone
import json
import os
import pwd
import socket
import subprocess
import sys

import psycopg

ROOT = Path('/tmp/sb-pg-tests/isolated-selector-fix-20261102')
BINARY = Path('/usr/lib/postgresql/16/bin')
CLUSTERS = [
    ('base', 55458, 'signalbrief_test', 'SB_TEST_POSTGRES_URL'),
    ('hosted', 55459, 'hosted_test', 'SB_TEST_HOSTED_POSTGRES_URL'),
    ('workspace', 55460, 'workspace_test', 'SB_TEST_WORKSPACE_POSTGRES_URL'),
    ('calendar', 55461, 'calendar_test', 'SB_TEST_CALENDAR_POSTGRES_URL'),
]

resume = sys.argv[1:] == ['--resume-created']
assert not ROOT.exists() or resume, f'Refusing to reuse existing test cluster root: {ROOT}'
for name, port, _, _ in CLUSTERS:
    if resume and (ROOT / name / 'data/PG_VERSION').is_file():
        continue
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', port))
ROOT.mkdir(mode=0o755, exist_ok=resume)
account = pwd.getpwnam('postgres')
prefix = ['runuser', '-u', 'postgres', '--']
proof = {'prepared_at': datetime.now(timezone.utc).isoformat(), 'clusters': {}, 'environment': {},
         'existing_clusters_modified': False, 'production_access': False}
for name, port, database, variable in CLUSTERS:
    directory = ROOT / name
    directory.mkdir(mode=0o700, exist_ok=resume)
    os.chown(directory, account.pw_uid, account.pw_gid)
    data = directory / 'data'
    if not (data / 'PG_VERSION').is_file():
        subprocess.run(prefix + [str(BINARY / 'initdb'), '-D', str(data), '-A', 'trust',
                                '--no-locale', '-E', 'UTF8'], check=True, stdout=subprocess.DEVNULL)
        subprocess.run(prefix + [str(BINARY / 'pg_ctl'), '-D', str(data),
                                '-l', str(directory / 'server.log'), '-o',
                                f'-p {port} -h 127.0.0.1 -k {directory} -c max_connections=100 -c shared_buffers=128MB -c timezone=Asia/Tokyo -c log_timezone=Asia/Tokyo',
                                '-w', 'start'], check=True, stdout=subprocess.DEVNULL)
    with psycopg.connect(host='127.0.0.1', port=port, dbname='postgres', user='postgres',
                         autocommit=True, connect_timeout=5) as conn:
        assert Path(conn.execute("SELECT current_setting('data_directory')").fetchone()[0]).resolve() == data.resolve()
        if not conn.execute('SELECT 1 FROM pg_database WHERE datname=%s', (database,)).fetchone():
            conn.execute(psycopg.sql.SQL('CREATE DATABASE {}').format(psycopg.sql.Identifier(database)))
    with psycopg.connect(host='127.0.0.1', port=port, dbname=database, user='postgres', connect_timeout=5) as conn:
        conn.execute('SET TRANSACTION READ ONLY')
        row = conn.execute("""SELECT current_database(), host(inet_server_addr()),
            current_setting('port'), current_setting('listen_addresses'),
            current_setting('data_directory'), current_setting('server_version'),
            to_regclass('public.users'),
            (SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema'))""").fetchone()
        assert row[0] == database and row[1] == '127.0.0.1' and row[2] == str(port)
        assert row[3] == '127.0.0.1' and Path(row[4]).resolve() == data.resolve()
        assert row[6] is None and row[7] == 0
        assert conn.execute("SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated')").fetchone()[0] == 0
    proof['clusters'][variable] = {'port': port, 'database': database, 'data_directory': str(data),
                                  'listen_addresses': row[3], 'server_version': row[5], 'user_tables': row[7]}
    scheme = 'postgresql' if name == 'calendar' else 'postgresql+psycopg'
    proof['environment'][variable] = f'{scheme}://postgres@127.0.0.1:{port}/{database}'
    print(f'Prepared fresh loopback {name} cluster on {port} ({database})', flush=True)
baseline_path = Path('/tmp/signalbrief-nov2-search-timeout-settings-comparison.json')
baseline = json.loads(baseline_path.read_text())['environments']['prior_passed']['settings']
identity_settings = {'application_name','config_file','data_directory','hba_file','ident_file','port','unix_socket_directories'}
settings_proof = {}
for name, port, database, variable in CLUSTERS:
    with psycopg.connect(host='127.0.0.1', port=port, dbname=database, user='postgres', connect_timeout=5,
                         application_name='signalbrief-settings-comparison') as conn:
        conn.execute('SET TRANSACTION READ ONLY')
        current = {row[0]: {'setting': row[1], 'unit': row[2], 'source': row[3]}
                   for row in conn.execute('select name,setting,unit,source from pg_settings order by name')}
        differences = [{'name': key, 'expected': baseline[key]['setting'], 'actual': current.get(key,{}).get('setting')}
                       for key in baseline if key not in identity_settings
                       and (current.get(key,{}).get('setting') != baseline[key]['setting']
                            or current.get(key,{}).get('unit') != baseline[key]['unit'])]
        assert not differences, f'{variable} differs from prior accepted settings: {differences}'
        locale = conn.execute('select datcollate,datctype,encoding from pg_database where datname=current_database()').fetchone()
        assert locale == ('C','C',6), locale
        settings_proof[variable] = {'matching_nonidentity_settings': len(baseline)-len(identity_settings),
            'differences': differences, 'shared_buffers': '128MB', 'max_connections': 100,
            'timezone': 'Asia/Tokyo', 'locale': locale, 'all_settings': current}
proof['prior_passed_settings_reference'] = str(baseline_path)
proof['settings_comparison'] = settings_proof
proof['unused_ports_checked_before_initialization'] = [item[1] for item in CLUSTERS]
proof['full_tests_started'] = False

Path('/tmp/signalbrief-nov2-isolated-selector-fix-environment.json').write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps(proof, indent=2))
