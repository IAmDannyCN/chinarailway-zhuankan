"""Axis-aligned PDF quad outlines are rules, rather than unstructured pictures."""
import json
import sys
import tempfile
from pathlib import Path

import pymupdf

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from indexer import axis_aligned_quad, reading_media_regions, readpage, render_document, read_page_asset

normal = pymupdf.Quad((10, 20), (80, 20), (10, 60), (80, 60))
turned = pymupdf.Quad((10, 20), (10, 60), (80, 20), (80, 60))
rotated = pymupdf.Quad((10, 30), (70, 10), (20, 60), (80, 40))
assert tuple(axis_aligned_quad(('qu', normal))) == (10, 20, 80, 60)
assert tuple(axis_aligned_quad(('qu', turned))) == (10, 20, 80, 60)
assert axis_aligned_quad(('qu', rotated)) is None
assert axis_aligned_quad(('l', pymupdf.Point(10, 20), pymupdf.Point(80, 20))) is None
print('通过：两种轴对齐Quad方向均识别成矩形；倾斜Quad继续保留原形。')

source = ROOT / 'pdf/kh2007106000.pdf'
if source.is_file():
    with pymupdf.open(source) as pdf, tempfile.TemporaryDirectory(prefix='crkh-quad-regression-') as temp:
        page = pdf[121]
        data, boxes = readpage(page)
        drawings = page.get_drawings()
        quads = [axis_aligned_quad(item) for drawing in drawings for item in drawing['items']
                 if item[0] == 'qu']
        assert len(quads) == 2 and all(rect is not None for rect in quads)
        source_only, regions = reading_media_regions(page, data, drawings, boxes, data['display'])
        assert not source_only
        assert not any(r['kind'] != 'symbol' for r in regions), regions
        assert 'df11' in data['t'] and '机车两车钩间距离' in data['t']
        one_page = pymupdf.open()
        one_page.insert_pdf(pdf, from_page=121, to_page=121)
        target = Path(temp) / 'sample.pdf'
        one_page.save(target)
        output = Path(temp) / 'offline'
        folder = output / 'data/quad'
        folder.mkdir(parents=True)
        (folder / '1.coords.js').write_text('window.PAGE_COORDS["quad:0"]=' + json.dumps(boxes) + ';\n')
        layout = {'id': 'quad', 'digest': 'quad-regression', 'pages': [data]}
        render_document(target, output, layout)
        _, markup = read_page_asset(folder / '1.page.js', 'quad:0')
        assert 'M30.39,367.37h268.35v116.70h-268.35Z' in markup
        assert 'data-source="true"' not in markup
    print('通过：2007年第6期PDF122两处矩形外框输出为SVG规则；参数正文不再被当作图片吞掉。')
