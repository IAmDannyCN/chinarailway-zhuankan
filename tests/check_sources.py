"""External PDF folders remain external, survive reruns, and preserve the old index on errors."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

import pymupdf

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from update import discover_sources, save_pdf_directory, saved_pdf_directory


def make_pdf(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        page.insert_text((60, 90), 'Railway conversion test: external source folder.', fontsize=14)
        page.insert_text((60, 120), 'This synthetic notice verifies indexing, links and incremental reuse.', fontsize=11)
        pdf.save(path)


def catalog(project):
    return json.loads((project / 'offline/data/index.js').read_text(encoding='utf8')
                      .removeprefix('window.CATALOG=').strip().removesuffix(';'))


def run(project, *args, success=True):
    result = subprocess.run([sys.executable, str(project / 'update.py'), '--jobs', '1', *args],
                            text=True, capture_output=True, env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
    assert (result.returncode == 0) == success, result.stdout + result.stderr
    return result.stdout + result.stderr


with tempfile.TemporaryDirectory(prefix='crkh-sources-') as folder:
    base = Path(folder).resolve()
    project = base / 'program'
    project.mkdir()
    (project / 'offline').mkdir()
    for name in ['update.py', 'indexer.py', 'requirements.txt']:
        shutil.copy2(ROOT / name, project / name)
    external = base / '资料库 中文 # 目录' / '子目录'
    source = external / '铁路客货运输2026-1.pdf'
    make_pdf(source)
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    assert discover_sources(project, external.parent) == [source]
    run(project, '--pdf-dir', str(external.parent))
    assert saved_pdf_directory(project) == external.parent
    entry = catalog(project)['docs'][0]
    assert entry['source'] == source.as_uri(), entry['source']
    assert not list((project / 'pdf').rglob('*.pdf'))
    assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash
    before = (project / 'offline/data/index.js').read_bytes()
    settings = (project / 'offline/更新设置.json').read_bytes()
    assert '资料和程序均未变化' in run(project)
    assert (project / 'offline/data/index.js').read_bytes() == before
    empty = base / 'empty'
    empty.mkdir()
    run(project, '--pdf-dir', str(empty), success=False)
    assert (project / 'offline/data/index.js').read_bytes() == before
    assert (project / 'offline/更新设置.json').read_bytes() == settings
    duplicate = external / 'nested' / source.name
    duplicate.parent.mkdir()
    shutil.copyfile(source, duplicate)
    run(project, success=False)
    duplicate.unlink()
    assert (project / 'offline/data/index.js').read_bytes() == before
    default = project / 'pdf' / '铁路客货运输2026-2.pdf'
    make_pdf(default)
    run(project, '--reset-pdf-dir')
    assert saved_pdf_directory(project) is None
    assert catalog(project)['docs'][0]['source'] == '../pdf/' + default.name
    save_pdf_directory(project / 'pdf', project)
    assert json.loads((project / 'offline/更新设置.json').read_text())['pdfDirectory'] == 'pdf'
    assert saved_pdf_directory(project) == project / 'pdf'
    (project / 'offline/更新设置.json').write_text('broken', encoding='utf8')
    run(project, '--pdf-dir', str(external.parent))
    assert saved_pdf_directory(project) == external.parent

print('通过：外部中文/空格/#目录、递归扫描、原件URI、不复制PDF、目录记忆、增量复用、错误保留原库、重复文件检测与恢复默认目录。')
