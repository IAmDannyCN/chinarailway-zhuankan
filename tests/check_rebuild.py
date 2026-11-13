"""Re-extract every original PDF in a temporary directory and compare the published catalogue."""
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
import argparse
import json
import os
import shutil
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from PIL import Image, ImageChops
from indexer import extract_document, read_page_asset, segment_document, render_document
from update import discover_sources, make_catalog, validate_document


def check_original(rebuilt, published, label):
    if rebuilt.read_bytes() == published.read_bytes():
        return
    with Image.open(rebuilt) as first, Image.open(published) as second:
        assert first.size == second.size, label
        difference = ImageChops.difference(first.convert('RGB'), second.convert('RGB')).histogram()
        # Font rasterization can vary with the PDF renderer's font cache.
        mean_error = sum((value % 256) * count for value, count in enumerate(difference)) / (first.width * first.height * 3)
        assert mean_error <= 2.55, label


def check_one(source, temporary_root, expected):
    source, temporary_root = Path(source), Path(temporary_root)
    copied = temporary_root / source.relative_to(ROOT)
    copied.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, copied)
    except OSError:
        shutil.copyfile(source, copied)
    output = temporary_root / 'offline'
    layout = extract_document(copied, output)
    document = segment_document(layout, copied, output)
    document['toc'] = layout['toc']
    render_document(copied, output, layout)
    document['originalPages'] = True
    validate_document(document, output)
    folder = output / 'data' / document['id']
    document['mediaPages'] = json.loads((folder / 'html.json').read_text())['mediaPages']
    assert document == expected, f'{source.name} 的重新分割结果与已发布索引不同'
    published = ROOT / 'offline/data' / document['id']
    for number in range(document['pages']):
        name = f'{number + 1}.page.js'
        key = f'{document["id"]}:{number}'
        rebuilt_page = '\n'.join(read_page_asset(folder / name, key)).encode('utf8')
        published_page = '\n'.join(read_page_asset(published / name, key)).encode('utf8')
        label = f'{source.name} 第 {number + 1} 页阅读资源不一致'
        assert rebuilt_page == published_page, label
        original = f'{number + 1}.original.webp'
        check_original(folder / original, published / original, label)
    return document


def main():
    parser = argparse.ArgumentParser(description='从全部原始 PDF 独立重建，检查可重复性；临时数据结束后自动删除。')
    parser.add_argument('--jobs', type=int, default=6)
    args = parser.parse_args()
    if not 1 <= args.jobs <= 16:
        parser.error('--jobs 需为 1—16')
    raw = (ROOT / 'offline/data/index.js').read_text(encoding='utf8')
    published = json.loads(raw.removeprefix('window.CATALOG=').strip().removesuffix(';'))
    expected = {doc['file']: doc for doc in published['docs']}
    sources = discover_sources()
    assert {p.name for p in sources} == set(expected), '原始 PDF 与已发布目录不一致，请先运行 update.py'
    documents = []
    with tempfile.TemporaryDirectory(prefix='railway-rebuild-') as directory:
        with ProcessPoolExecutor(max_workers=args.jobs) as pool:
            jobs = [pool.submit(check_one, path, directory, expected[path.name]) for path in sources]
            for number, job in enumerate(as_completed(jobs), 1):
                documents.append(job.result())
                if number % 25 == 0 or number == len(jobs):
                    print(f'从原件核对 {number}/{len(jobs)}', flush=True)
        rebuilt = make_catalog(documents, published)
        assert rebuilt == published, '完整索引不一致'
    print(f'通过：{len(documents)} 份原件、{sum(d["pages"] for d in documents):,} 页；条目、分类、关联、文字、页码和定位全部一致。')
    print('通过：全部文字、矢量线条、定位与图件尺寸一致，图像核对通过。')
    print('内容指纹：' + rebuilt['contentHash'])


if __name__ == '__main__':
    main()
