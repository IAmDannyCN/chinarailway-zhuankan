#!/usr/bin/env python3
"""Update all railway periodicals. Run without arguments for the complete local collection."""
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
from contextlib import contextmanager
from datetime import datetime
import argparse
import collections
import csv
import gzip
import hashlib
import html
import io
import json
import os
import re
import sys
import shutil
from importlib.metadata import version as package_version
from urllib.parse import quote

sys.dont_write_bytecode = True
from indexer import EXTRACT_VERSION, SEGMENT_VERSION, atomic_text, extract_document, read_page_asset, render_document, segment_document, writejs

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'offline'


def make_catalog(documents, previous=None):
    documents = sorted(documents, key=lambda d: (d['year'], d['issueOrder'], d['file']))
    payload = dict(version=SEGMENT_VERSION, extractVersion=EXTRACT_VERSION, sample=False,
                   runtime={name: package_version(name) for name in ['pymupdf']}, docs=documents)
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf8')
    fingerprint = hashlib.sha256(encoded).hexdigest()
    prior = previous or {}
    # An unchanged run leaves index and report bytes unchanged, including their displayed date.
    built = prior.get('built') if prior.get('contentHash') == fingerprint else None
    return dict(payload, contentHash=fingerprint, built=built or datetime.now().strftime('%Y-%m-%d %H:%M'))


def prune_migrated_caches(documents, output):
    """Remove only verified old-format generated caches after their replacements are published."""
    for document in documents:
        base = hashlib.sha1(document['file'].encode()).hexdigest()[:10]
        old = Path(output) / 'data' / base
        new = Path(output) / 'data' / document['id']
        if old == new or not old.is_dir() or old.is_symlink() or not new.is_dir():
            continue
        manifest = old / 'source.json'
        if not manifest.exists() or json.loads(manifest.read_text(encoding='utf8')).get('digest') != document['digest']:
            continue
        allowed = lambda p: p.is_file() and (p.name in ['source.json', 'previews.json', 'layout.json.gz', 'coords.js', 'cache.json']
                                            or re.fullmatch(r'\d+\.(?:webp|coords\.js)', p.name))
        if all(allowed(path) for path in old.iterdir()):
            shutil.rmtree(old)


@contextmanager
def update_lock(path):
    """Keep concurrent updates out on macOS, Linux and Windows."""
    if os.name == 'nt':
        import msvcrt
    else:
        import fcntl
    with Path(path).open('a+b') as lock:
        if lock.seek(0, os.SEEK_END) == 0:
            lock.write(b'0')
            lock.flush()
        lock.seek(0)
        try:
            if os.name == 'nt':
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise SystemExit('已有更新任务正在运行，或无法锁定更新文件。') from error
        try:
            yield
        finally:
            if os.name == 'nt':
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock, fcntl.LOCK_UN)


def discover_sources(root=ROOT):
    extra = root / '新增专刊'
    extra.mkdir(exist_ok=True)
    paths = sorted(path for folder in [root / 'pdf', extra] if folder.exists()
                   for path in folder.rglob('*') if path.is_file() and path.suffix.lower() == '.pdf')
    if not paths:
        raise ValueError('pdf 和“新增专刊”文件夹中没有 PDF。')
    names = collections.Counter(path.name.casefold() for path in paths)
    duplicates = [name for name, count in names.items() if count > 1]
    if duplicates:
        raise ValueError('存在同名文件，请先改名：' + '、'.join(duplicates))
    return paths


def prepare(path, output, layout=None):
    if layout is None:
        layout = extract_document(path, output)
    cache=Path(output)/'data'/layout['id']/'segments.json.gz'
    stamp=hashlib.sha256((ROOT/'indexer.py').read_bytes()).hexdigest()
    if cache.exists():
        with gzip.open(cache,'rt',encoding='utf8') as stream: saved=json.load(stream)
        if saved.get('stamp')==stamp and saved['document']['source']=='../'+Path(path).relative_to(Path(output).parent).as_posix():
            return dict(saved['document'], toc=layout['toc'])
    if sum(len(page['t']) for page in layout['pages']) < 50:
        raise ValueError('未提取到足够文字，可能是扫描件；请先完成 OCR。')
    document=segment_document(layout,path,output)
    with gzip.open(cache,'wt',encoding='utf8') as stream: json.dump(dict(stamp=stamp,document=document),stream,ensure_ascii=False,separators=(',',':'))
    return dict(document, toc=layout['toc'])


def validate_document(document, output, previews=True, coordinates=True, layout=None):
    """Check exact character coverage, non-overlap, links, geometry and file completeness."""
    pages = document['pages']
    assert pages == len(document['texts']) == len(document['sizes']) == len(document['labels']), '页数不一致'
    entries = document['entries']
    ids = {entry['id'] for entry in entries}
    assert len(ids) == len(entries), '条目编号重复'
    spans = collections.defaultdict(list)
    for entry in entries:
        if entry.get('parentId'):
            assert entry['parentId'] in ids, '附件所属文件不存在'
        for child in entry.get('attachments', []):
            assert child in ids, '附件不存在'
            assert next(item for item in entries if item['id'] == child).get('parentId') == entry['id'], '附件关联不一致'
        if entry['kind'] == '剪贴页':
            assert {part['p'] for part in entry['parts']} == {entry['p']}, '剪贴页跨入其他原页'
        for part in entry['parts']:
            number, start, end = part['p'], part['a'], part['b']
            assert 0 <= number < pages and 0 <= start < end <= len(document['texts'][number]), '条目边界越界'
            spans[number].append((start, end))
    folder = Path(output) / 'data' / document['id']
    for number, text in enumerate(document['texts']):
        position = 0
        for start, end in sorted(spans[number]):
            assert start == position, f'PDF第{number + 1}页文字遗漏或重复：{position}→{start}'
            position = end
        assert position == len(text), f'PDF第{number + 1}页未完整入库'
        assert all(ord(character) <= 65535 for character in text), '文字与浏览器索引长度不一致'
        if coordinates:
            coordinate=folder/f'{number+1}.page.js'
            if coordinate.exists():
                coords, _ = read_page_asset(coordinate, f'{document["id"]}:{number}')
            else:
                expected = f'window.PAGE_COORDS["{document["id"]}:{number}"]='
                raw = (folder / f'{number+1}.coords.js').read_text(encoding='utf8').strip()
                assert raw.startswith(expected), '定位数据编号不符'
                coords = raw[len(expected):].removesuffix(';')
            boxes = json.loads(coords)
            assert len(boxes) == len(text), f'PDF第{number + 1}页文字与坐标数量不一致'
            assert all(len(box) == 4 and all(isinstance(n, (int, float)) for n in box) and box[2] >= 0 and box[3] >= 0 for box in boxes), '无效坐标'
        if previews:
            image = folder / f'{number + 1}.page.js'
            assert image.is_file() and image.stat().st_size > 100, f'PDF第{number + 1}页缺少预览'
    # Independently check explicit original-page captions, beyond character coverage.
    if layout is None:
        with gzip.open(folder / 'layout.json.gz', 'rt', encoding='utf8') as stream:
            layout = json.load(stream)
    kinds_by_page = collections.defaultdict(set)
    for entry in entries:
        for part in entry['parts']:
            kinds_by_page[part['p']].add(entry['kind'])
    for number, page_layout in enumerate(layout['pages']):
        if '图书在版编目' in page_layout['t'] and 'isbn' in page_layout['t']:
            assert '剪贴页' not in kinds_by_page[number], f'PDF第{number + 1}页版权资料误归剪贴页'
        for line in page_layout['lines']:
            caption = line['t'].replace('«', '《').replace('»', '》').lstrip('暋摇')
            if (line['y'] < page_layout['h'] * .25 and 'BookMaker' not in line['fonts']
                    and re.match(r'^《[^》]{2,45}》(?:[上下]册)?[\d—、~-]+页.{0,25}剪贴页', caption)
                    and not any(word in caption for word in ['附剪贴页', '剪贴页中', '⋯', '……'])):
                assert kinds_by_page[number] == {'剪贴页'}, f'PDF第{number + 1}页已标明剪贴页却未正确归类'
    return document['file']


def process_document(path, output, digest):
    layout = extract_document(path, output)
    if layout['digest'] != digest:
        raise ValueError('PDF 在更新期间发生变化，请再次运行更新。')
    document = prepare(path, output, layout)
    _, page_count, _ = render_document(path, output, document['entries'], layout)
    manifest = Path(output) / 'data' / document['id'] / 'html.json'
    document['mediaPages'] = json.loads(manifest.read_text())['mediaPages']
    validate_document(document, output, layout=layout)
    return document, page_count


def has_reading_files(document, output):
    folder = Path(output) / 'data' / document['id']
    try:
        with os.scandir(folder) as entries:
            names = {entry.name for entry in entries if entry.is_file()}
    except FileNotFoundError:
        return False
    return {'html.json', 'layout.json.gz'} <= names and all(
        f'{number+1}.page.js' in names for number in range(document['pages'])
    )


NOTE_HANDLING = {
    '书签未核准': '按正文版式分篇，原书签仍可在整期目录中使用。需要确认篇名或起止位置时，可对照原页。',
    '图像页文字较少': '保留原页和已提取的文字。需要检索或复制图内文字时，可先为原 PDF 添加 OCR 文字层，再更新。',
    '原件字体兼容': '采用已提取文字入库。如遇错字或异常符号，可对照原页。',
    '长文件': '保持整篇连续收录，跨页正文和续表照常阅读。',
    '附件无前置文件': '附件独立收录，保留原页出处。需要确认归属时，可查看前后页。',
    '未识别边界': '按原页保留文字，可直接查询。需要精确引用时，可核对篇名与分界。',
}


def remove_legacy_review_list(output, previous):
    """Remove only the untouched CSV generated from the previous index."""
    path = Path(output) / '待核对清单.csv'
    if not previous or not path.is_file() or path.is_symlink():
        return
    stream = io.StringIO(newline='')
    writer = csv.writer(stream)
    writer.writerow(['文件名', 'PDF页码', '检查项', '标题或内容'])
    for document in previous['docs']:
        for warning in document['warnings']:
            writer.writerow([document['file'], warning['page'], warning['type'], warning['title']])
    if path.read_bytes() == ('\ufeff' + stream.getvalue()).encode('utf8'):
        path.unlink()


def print_result(documents):
    print(f'已入库，可查询：{len(documents)} 份，{sum(d["pages"] for d in documents):,} 页，'
          f'{sum(len(d["entries"]) for d in documents):,} 个条目。', flush=True)
    print('打开 offline/index.html。入库结果：offline/入库检查报告.html。', flush=True)


def write_reports(documents, output, built):
    output = Path(output)
    warnings = [dict(file=document['file'], source=document['source'], **warning)
                for document in documents for warning in document['warnings']]
    note_counts = collections.Counter(warning['type'] for warning in warnings)
    totals = sum((collections.Counter(entry['kind'] for entry in document['entries']) for document in documents), collections.Counter())
    rows = []
    for decade in range(min(document['year'] for document in documents) // 10 * 10,
                        max(document['year'] for document in documents) // 10 * 10 + 1, 10):
        group = [document for document in documents if decade <= document['year'] < decade + 10]
        kinds = sum((collections.Counter(entry['kind'] for entry in document['entries']) for document in group), collections.Counter())
        rows.append(f'<tr><th>{decade}—{decade + 9}</th><td>{len(group)}</td><td>{sum(d["pages"] for d in group):,}</td>'
                    + ''.join(f'<td>{kinds[kind]:,}</td>' for kind in ['文件', '附件', '修改事项', '剪贴页', '目录', '待核对']) + '</tr>')
    warning_rows = []
    for warning in warnings:
        link = quote(warning['source'], safe='/') + '#page=' + str(warning['page'])
        warning_rows.append(f'<tr><td>{html.escape(warning["type"])}</td><td><a href="{link}" target="_blank">{html.escape(warning["file"])}</a></td>'
                            f'<td>{warning["page"]}</td><td>{html.escape(warning["title"])}</td></tr>')
    content = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>专刊入库结果</title><style>body{max-width:1200px;margin:36px auto;padding:0 24px;color:#28372f;font:15px/1.7 system-ui,sans-serif}h1{font-size:25px}h2{font-size:19px;margin-top:32px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:9px 12px;border-bottom:1px solid #dde5de;text-align:left;vertical-align:top}th{background:#f3f6f3}td:nth-child(2){overflow-wrap:anywhere}a{color:#285d47}small{color:#65776a}summary{cursor:pointer;font-weight:600}.stats{font-size:19px}li{margin:5px 0}</style><body>
<h1>已入库，可查询</h1>'''
    content += f'<small>更新于 {built}</small><p class="stats">{len(documents)} 份 PDF · {sum(d["pages"] for d in documents):,} 页 · {sum(totals.values()):,} 个条目</p>'
    content += '<p>文字覆盖、篇目边界、附件关联与原页定位已通过自动检查。更新到此完成，所有已收录内容可直接查询。</p>'
    content += '<p><a href="index.html">打开查询</a></p>'
    content += '<h2>分年代统计</h2><table><thead><tr><th>年代</th><th>PDF</th><th>页数</th><th>文件</th><th>附件</th><th>修改事项</th><th>剪贴页</th><th>目录／版权页</th><th>按页收录</th></tr></thead><tbody>' + ''.join(rows) + '</tbody></table>'
    if warnings:
        summary_rows = ''.join(
            f'<tr><td>{html.escape(kind)}</td><td>{count:,}</td>'
            f'<td>{html.escape(NOTE_HANDLING.get(kind, "已保留原页出处，可按需查看。"))}</td></tr>'
            for kind, count in note_counts.most_common()
        )
        content += f'<h2>入库提示（{len(warnings):,} 条）</h2><p>以下为处理记录，日常查询可以直接开始。需要对照时，展开明细并点击文件名打开对应原页。</p>'
        content += '<table><thead><tr><th>提示</th><th>数量</th><th>默认处理与查看方式</th></tr></thead><tbody>' + summary_rows + '</tbody></table>'
        content += '<details><summary>展开提示明细</summary><table><thead><tr><th>提示</th><th>文件</th><th>PDF 页码</th><th>标题或内容</th></tr></thead><tbody>' + ''.join(warning_rows) + '</tbody></table></details>'
    content += '</body></html>'
    atomic_text(output / '入库检查报告.html', content)
    atomic_text(output / '入库统计.json', json.dumps(dict(built=built, files=len(documents), pages=sum(d['pages'] for d in documents),
                                                      entries=dict(totals), status='已入库', notes=dict(note_counts), reviewItems=len(warnings)), ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description='更新 pdf 和“新增专刊”文件夹中的全部 PDF。')
    parser.add_argument('--all', action='store_true', help='兼容旧命令；现在默认处理全部文件')
    parser.add_argument('--jobs', type=int, default=min(6, max(1, (os.cpu_count() or 2) - 2)), help='同时处理的文件数，默认最多 6 个')
    parser.add_argument('--check-only', action='store_true', help='检查当前已发布索引，不改动索引')
    args = parser.parse_args()
    if not 1 <= args.jobs <= 16:
        parser.error('--jobs 需为 1—16')
    OUT.mkdir(exist_ok=True)
    with update_lock(ROOT / '.更新专刊.lock'):
        if args.check_only:
            raw = (OUT / 'data/index.js').read_text(encoding='utf8')
            data = json.loads(raw.removeprefix('window.CATALOG=').strip().removesuffix(';'))
            for document in data['docs']:
                validate_document(document, OUT)
            print(f'检查通过：{len(data["docs"])} 份，{sum(d["pages"] for d in data["docs"])} 页。')
            return
        try:
            paths = discover_sources()
        except ValueError as error:
            raise SystemExit(str(error)) from error
        sources = {path.relative_to(ROOT).as_posix(): (path, hashlib.sha256(path.read_bytes()).hexdigest())
                   for path in paths}
        pipeline = hashlib.sha256(
            b''.join((ROOT / name).read_bytes() for name in ['indexer.py', 'update.py', 'requirements.txt'])
            + package_version('pymupdf').encode()
        ).hexdigest()
        signature = hashlib.sha256((pipeline + json.dumps(
            [(name, digest) for name, (_, digest) in sources.items()]
        )).encode()).hexdigest()
        receipt = OUT / '更新状态.json'
        status = json.loads(receipt.read_text()) if receipt.exists() else {}
        index_path = OUT / 'data/index.js'
        previous = None
        if index_path.exists():
            raw = index_path.read_text(encoding='utf8')
            previous = json.loads(raw.removeprefix('window.CATALOG=').strip().removesuffix(';'))
        reusable = {}
        if previous and status.get('pipeline') == pipeline and status.get('contentHash') == previous.get('contentHash'):
            for document in previous['docs']:
                source = document['source'].removeprefix('../')
                if source in sources and sources[source][1] == document['digest'] and has_reading_files(document, OUT):
                    reusable[source] = document
        pending = [values for name, values in sources.items() if name not in reusable]
        documents = list(reusable.values())
        if not pending and status.get('signature') == signature and all(
                (OUT / name).is_file() for name in ['入库检查报告.html', '入库统计.json', '生成记录.json']):
            print('资料和程序均未变化，沿用现有结果。', flush=True)
            print_result(documents)
            return
        errors, processed = [], []
        print(f'沿用 {len(reusable)} 份，处理 {len(pending)} 份。', flush=True)
        if pending:
            with ProcessPoolExecutor(max_workers=min(args.jobs, len(pending))) as pool:
                futures = {pool.submit(process_document, path, OUT, digest): path for path, digest in pending}
                for number, future in enumerate(as_completed(futures), 1):
                    path = futures[future]
                    try:
                        document, page_count = future.result()
                        processed.append(document)
                        documents.append(document)
                        print(f'处理 {number}/{len(pending)}：{path.name}（写入 {page_count} 页）', flush=True)
                    except Exception as error:
                        errors.append(dict(file=path.name, stage='入库', error=str(error)))
        if errors:
            atomic_text(OUT / '更新错误.json', json.dumps(errors, ensure_ascii=False, indent=2))
            for error in errors:
                print(f'未完成：{error["file"]} · {error["error"]}', file=sys.stderr)
            raise SystemExit('更新未发布，原有检索索引保留。详见 offline/更新错误.json。')
        data = make_catalog(documents, previous)
        documents = data['docs']
        write_reports(documents, OUT, data['built'])
        writejs(OUT / 'data/index.js', 'window.CATALOG=', data)
        atomic_text(OUT / '生成记录.json', json.dumps(dict(contentHash=data['contentHash'], version=SEGMENT_VERSION,
            extractVersion=EXTRACT_VERSION, runtime=data['runtime'], sources=[dict(file=d['file'], digest=d['digest']) for d in documents]),
            ensure_ascii=False, indent=2))
        prune_migrated_caches(processed, OUT)
        # Only remove obsolete generated rasters after the replacement catalogue is validated.
        for document in processed:
            folder=OUT/'data'/document['id']
            for pattern in ['*.webp','*.coords.js']:
                for obsolete in folder.glob(pattern): obsolete.unlink()
            for name in ['previews.json','cache.json','coords.js']:
                (folder/name).unlink(missing_ok=True)
        active = {document['id'] for document in documents}
        for folder in (OUT/'data').iterdir():
            if (not folder.is_dir() or folder.is_symlink() or folder.name in active
                    or not re.fullmatch(r'[a-f0-9]{10}(?:-[a-f0-9]{12})?', folder.name)
                    or not (folder/'source.json').is_file()):
                continue
            generated = {'source.json','layout.json.gz','segments.json.gz','html.json','previews.json','cache.json','coords.js'}
            if all(p.is_file() and not p.is_symlink() and (p.name in generated or re.fullmatch(r'\d+\.(?:webp|coords\.js|page\.js)',p.name)) for p in folder.iterdir()):
                shutil.rmtree(folder)
        remove_legacy_review_list(OUT, previous)
        atomic_text(receipt, json.dumps(dict(signature=signature, pipeline=pipeline, contentHash=data['contentHash'])))
        if (OUT / '更新错误.json').exists():
            (OUT / '更新错误.json').unlink()
        print_result(documents)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit('已中断；现有索引保留。再次运行会继续处理。')
