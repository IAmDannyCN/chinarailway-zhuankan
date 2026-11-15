"""A sparse encoded table glyph must not force the entire table to a picture."""
import sys
from pathlib import Path

import pymupdf

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from indexer import isolated_bookmaker_fonts, reading_media_regions, readpage


def raw_span(font, text, x=10, y=10):
    return {'font': font, 'size': 8, 'chars': [
        {'c': c, 'bbox': [x + i * 8, y, x + i * 8 + 8, y + 8],
         'origin': [x + i * 8, y + 6]} for i, c in enumerate(text)]}


def raw_dict(*spans):
    return {'blocks': [{'lines': [{'dir': [1, 0], 'spans': list(spans)}]}]}


font = 'FzBookMaker0DlFont-test'
normal = raw_span('FZSSK-normal', '普通字体中的正文与表格文字可以可靠读取并用于全文检索')
assert isolated_bookmaker_fonts(raw_dict(normal, raw_span(font, '!'), raw_span(font, '!'))) == {font}
assert not isolated_bookmaker_fonts(raw_dict(normal, raw_span(font, '!#$%&\'()*+9:;<=>?')))
assert not isolated_bookmaker_fonts(raw_dict(raw_span(font, '!'), raw_span(font, '!')))
print('通过：少量孤立坏字体符号与整段伪编码分别处理，不按字符感叹号全局替换。')

source = ROOT / 'pdf/KH2015105000.pdf'
if source.is_file():
    with pymupdf.open(source) as pdf:
        for number, expected in [(16, 2), (17, 1)]:
            page = pdf[number]
            data, boxes = readpage(page)
            original_text = data['t']
            source_only, regions = reading_media_regions(page, data, page.get_drawings(), boxes, data['display'])
            offsets = {i for r in regions if r['kind'] == 'symbol'
                       for i in r.get('offsets', range(r['a'], r['b'])) if data['t'][i] == '!'}
            assert not source_only
            assert len(offsets) == expected, (number + 1, offsets, regions)
            assert not any(r['kind'] == 'layout' for r in regions), (number + 1, regions)
            assert all(r.get('svg') for r in regions if r['kind'] == 'symbol' and r['a'] in offsets)
            assert data['t'] == original_text
    print('通过：2015年第5期PDF17/18三处编码为!的原始破折号均独立保留SVG，表格不回退，原文偏移不变。')

source = ROOT / 'pdf/kh2012101000.pdf'
if source.is_file():
    with pymupdf.open(source) as pdf:
        page = pdf[86]
        data, boxes = readpage(page)
        offsets = [i for i, (char, box) in enumerate(zip(data['t'], boxes)) if char == '!' and box[2] == 0]
        assert offsets, 'fixture must include a visible glyph with a zero-width font metric'
        _, regions = reading_media_regions(page, data, page.get_drawings(), boxes, data['display'])
        assert all(any(r['kind'] == 'symbol' and r['a'] == offset and r.get('svg') for r in regions)
                   for offset in offsets), regions
    print('通过：字体报告零宽度时仍按显式文字位置提取SVG真实轮廓，不丢失孤立符号。')

source = ROOT / 'pdf/kh2010103000.pdf'
if source.is_file():
    with pymupdf.open(source) as pdf:
        for number in [21, 22, 27, 35]:
            page = pdf[number]
            raw = page.get_text('rawdict', flags=pymupdf.TEXTFLAGS_RAWDICT & ~pymupdf.TEXT_PRESERVE_IMAGES)
            assert not isolated_bookmaker_fonts(raw), number + 1
            data, boxes = readpage(page)
            _, regions = reading_media_regions(page, data, page.get_drawings(), boxes, data['display'])
            assert any(r['kind'] == 'layout' and r.get('textReliable') is False for r in regions), number + 1
    print('通过：2010年第3期PDF22/23/28/36整段伪编码继续保留原版面，不冒充可解析文字。')
