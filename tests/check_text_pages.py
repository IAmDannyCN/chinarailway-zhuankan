"""Check text coverage, original-page assets and previously reported reading errors."""
from pathlib import Path
import base64
import gzip
import json
import xml.etree.ElementTree as ET

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
raw = (ROOT / 'offline/data/index.js').read_text(encoding='utf8')
documents = json.loads(raw.removeprefix('window.CATALOG=').strip().removesuffix(';'))['docs']
count = 0
for document in documents:
    assert document['originalPages']
    source_pages = []
    if document['file'] == 'kh2007106000.pdf':
        main = next(entry for entry in document['entries'] if entry['title'] == '北京西/上海—红磡直通旅客列车办法')
        appendix = next(entry for entry in document['entries'] if entry['p'] == 131 and '清算报表格式说明' in entry['title'])
        assert appendix.get('parentId') == main['id']
    if document['file'] == 'kh2010101000.pdf':
        same_page = [entry for entry in document['entries'] if entry['p'] == 21]
        assert any(entry['kind'] == '附件' and '武汉枢纽' in entry['title'] for entry in same_page)
        assert any(entry['kind'] == '文件' and '徐兰高速线' in entry['title'] for entry in same_page)
    folder = ROOT / 'offline/data' / document['id']
    for number, text in enumerate(document['texts'], 1):
        raw = (folder / f'{number}.page.js').read_text(encoding='utf8')
        packed = json.loads(raw.split('=', 1)[1].strip().removesuffix(';'))
        coordinates, markup = gzip.decompress(base64.b64decode(packed)).decode('utf8').split('\n', 1)
        root = ET.fromstring(markup)
        copied = ''.join(node.text or '' for node in root.findall('{http://www.w3.org/2000/svg}text'))
        assert copied.lower() == text and len(json.loads(coordinates)) == len(text), (document['file'], number)
        with Image.open(folder / f'{number}.original.webp') as original:
            assert original.format == 'WEBP' and max(original.size) <= 1351
            width, height = document['sizes'][number - 1]
            assert abs(original.width / original.height - width / height) < .005
        source_only = root.get('data-source') == 'true'
        regions = json.loads(root.get('data-regions', '[]'))
        page_width, page_height = document['sizes'][number - 1]
        for region in regions:
            x0, y0, x1, y1 = region['rect']
            assert 0 <= x0 < x1 <= page_width + .1 and 0 <= y0 < y1 <= page_height + .1, (document['file'], number, region)
            assert 0 <= region['a'] <= region['b'] <= len(text), (document['file'], number, region)
            assert all(region['a'] <= offset < region['b'] for offset in region.get('offsets', [])), (document['file'], number, region)
            if region.get('svg'):
                vector = ET.fromstring(region['svg'])
                assert vector.tag == '{http://www.w3.org/2000/svg}svg' and len(vector), (document['file'], number, region)
                assert all(node.tag in ['{http://www.w3.org/2000/svg}svg', '{http://www.w3.org/2000/svg}path']
                           for node in vector.iter()), (document['file'], number, region)
        ordinary_glyphs = {
            ('KH2018105060.pdf', 12): [273, 302, 368, 409],
            ('kh2012104000.pdf', 8): [232, 239, 249, 260, 275, 301],
            ('kh2012104000.pdf', 9): [15],
            ('kh2013104050.pdf', 298): [397],
        }.get((document['file'], number), [])
        replaced = {i for region in regions if region['kind'] == 'symbol'
                    for i in region.get('offsets', range(region['a'], region['b']))}
        assert not replaced.intersection(ordinary_glyphs), (document['file'], number, replaced.intersection(ordinary_glyphs))
        if source_only:
            source_pages.append(number - 1)
        if document['file'] == 'kh2007106000.pdf' and number == 124:
            assert '客车技术标准' in copied and '高级软卧车' in copied and source_only
            assert document['labels'][number - 1] == '124'
        if document['file'] == 'kh2010101000.pdf' and number == 22:
            assert source_only or any(region['kind'] in ['figure', 'layout'] for region in regions)
        count += 1
    assert source_pages == document['mediaPages'], document['file']
print(f'通过：{count:,} 页的可复制文字与索引、坐标完全对应，原版面齐全，原页方向及宽高比一致。')
