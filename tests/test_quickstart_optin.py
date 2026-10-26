"""Exercise real quickstart and CLI without downloads or hosted transmission."""
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize('flag', [None, '0', '1', 'true'])
def test_quickstart_transmits_only_after_explicit_opt_in(tmp_path, flag):
    for name in ('verdigraph', 'examples'):
        shutil.copytree(ROOT / name, tmp_path / name, ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copy2(ROOT / 'quickstart.sh', tmp_path / 'quickstart.sh')
    bin_dir = tmp_path / '.venv' / 'bin'
    bin_dir.mkdir(parents=True)
    # Skip installer network only; brain builds still execute the real CLI.
    (bin_dir / 'activate').write_text(
        'pip() { :; }\n'
        f'python() {{ {shlex.quote(sys.executable)} "$@"; }}\n'
        f'python3() {{ {shlex.quote(sys.executable)} "$@"; }}\n'
        f'export PATH={shlex.quote(str(bin_dir))}:"$PATH"\n'
    )
    curl = bin_dir / 'curl'
    curl.write_text(f'#!{sys.executable}\n' + '''import json, os, pathlib, sys
pathlib.Path(os.environ['CURL_CAPTURE']).write_text(json.dumps(sys.argv[1:]))
print(json.dumps({'preview': {'brain_id': os.environ['EXPECTED_ID']}}))
''')
    curl.chmod(0o755)
    env = dict(os.environ)
    env.pop('VERDIGRAPH_VERIFY_HOSTED', None)
    if flag is not None:
        env['VERDIGRAPH_VERIFY_HOSTED'] = flag
    capture = tmp_path / 'curl.json'
    genome = 'examples/hypothetical_research_agent.genome.json'
    summary = json.loads(subprocess.check_output(
        [sys.executable, '-m', 'verdigraph', 'build', '--file', genome,
         '--format', 'verdigraph_genome', '--summary'], cwd=tmp_path, env=env))
    env.update(CURL_CAPTURE=str(capture), EXPECTED_ID=summary['brain_id'])
    run = subprocess.run(['bash', 'quickstart.sh'], cwd=tmp_path, env=env,
                         text=True, capture_output=True, check=True)
    assert capture.exists() is (flag == '1')
    if flag == '1':
        args = json.loads(capture.read_text())
        assert 'https://verdigraph.dev/app/import' in args
        assert args[args.index('-d') + 1], run.stderr
        payload = json.loads(args[args.index('-d') + 1])
        assert payload == {'format': 'verdigraph_genome',
                           'content': (tmp_path / genome).read_text()}
        assert 'local brain_id matches hosted Worker' in run.stdout


def test_cli_build_output_can_be_verified(tmp_path):
    built = subprocess.check_output(
        [sys.executable, '-m', 'verdigraph', 'build', '--file',
         'examples/hypothetical_research_agent.genome.json', '--pretty'], cwd=ROOT)
    result = json.loads(built)
    for name, content in [('build.json', result), ('brain.json', result['brain'])]:
        artifact = tmp_path / name
        artifact.write_text(json.dumps(content))
        checked = subprocess.run([sys.executable, '-m', 'verdigraph', 'verify', str(artifact)],
                                 cwd=ROOT, capture_output=True, text=True)
        assert checked.returncode == 0, checked.stderr
        assert json.loads(checked.stdout)['passed'] is True
