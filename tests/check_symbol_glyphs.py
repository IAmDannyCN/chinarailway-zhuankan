"""A tall symbol-font span must never replace normal text on the next line."""
import sys
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from indexer import reading_media_regions


class OverlappingFontPage:
    rect = pymupdf.Rect(0, 0, 100, 100)
    rotation = 0

    def __init__(self):
        self.pdf = pymupdf.open()
        self.blank = self.pdf.new_page(width=100, height=100)

    def get_image_info(self):
        return []

    def get_bboxlog(self):
        return []

    def get_pixmap(self, **kwargs):
        return self.blank.get_pixmap(**kwargs)

    def get_text(self, kind, **kwargs):
        assert kind == 'rawdict'
        return {'blocks': [{'lines': [{'dir': [1, 0], 'bbox': [10, 10, 60, 50], 'spans': [
            {'font': 'E-BZ-Test', 'bbox': [10, 10, 20, 40],
             'chars': [{'c': '\ue010', 'bbox': [10, 10, 20, 40], 'origin': [10, 35]}]},
            {'font': 'SSJ-Test', 'bbox': [10, 30, 20, 50],
             'chars': [{'c': '线', 'bbox': [10, 30, 20, 50], 'origin': [10, 45]}]},
            {'font': 'E-HZ-Test', 'bbox': [40, 10, 50, 40],
             'chars': [{'c': '磗', 'bbox': [40, 10, 50, 40], 'origin': [40, 35]}]},
            {'font': 'SSJ-Test', 'bbox': [40, 30, 50, 50],
             'chars': [{'c': '磗', 'bbox': [40, 30, 50, 50], 'origin': [40, 45]}]},
        ]}]}]}


page = OverlappingFontPage()
text = '\ue010线磗磗'
boxes = [[10, 10, 10, 30], [10, 30, 10, 20], [40, 10, 10, 30], [40, 30, 10, 20]]
data = {'w': 100, 'h': 100, 't': text,
        'lines': [{'a': 0, 'b': 4, 'y': 10, 'bottom': 50, 'x': 10, 'right': 50}]}
source, regions = reading_media_regions(page, data, [], boxes, text)
assert not source
offsets = {i for r in regions if r['kind'] == 'symbol'
           for i in r.get('offsets', range(r['a'], r['b']))}
assert offsets == {0, 2}, regions
page.pdf.close()
print('通过：异常高符号边框不替代下一行普通汉字；相同汉字也严格核对逐字位置，真实特殊字形保留。')


class AdjoiningBitmapPage(OverlappingFontPage):
    def get_image_info(self):
        return [{'bbox': [20, 17, 30, 27]}]

    def get_text(self, kind, **kwargs):
        return {'blocks': [{'lines': [{'dir': [1, 0], 'bbox': [10, 10, 39, 30], 'spans': [
            {'font': 'SSJ-Test', 'bbox': [10, 10, 39, 30], 'chars': [
                {'c': '为', 'bbox': [10, 10, 30, 30], 'origin': [10, 27]},
                {'c': '；', 'bbox': [34, 10, 39, 30], 'origin': [34, 27]},
            ]}
        ]}]}]}

    def get_texttrace(self):
        return [{'dir': [1, 0], 'size': 20, 'chars': [
            (ord('为'), 0, (10, 27), [10, 10, 20, 30]),
            (ord('；'), 0, (34, 27), [34, 10, 39, 30]),
        ]}]


page = AdjoiningBitmapPage()
data = {'w': 100, 'h': 100, 't': '为；',
        'lines': [{'a': 0, 'b': 2, 'y': 10, 'bottom': 30, 'x': 10, 'right': 39}]}
source, regions = reading_media_regions(page, data, [], [[10, 10, 20, 20], [34, 10, 5, 20]], '为；')
assert regions == [{'kind': 'symbol', 'rect': [19.4, 16.4, 30.6, 27.6], 'a': 1, 'b': 1}], regions
page.pdf.close()
print('通过：改为后的位图只插入符号，不替代字体框过宽的为字。')


page = OverlappingFontPage()
data['t'] = '\ue5d0' * 6 + '记'
data['lines'][0].update(a=0, b=7)
boxes = [[10, 10, 10, 10]] * 6 + [[10, 15, 10, 10]]
_, regions = reading_media_regions(page, data, [], boxes, data['t'])
assert all(6 not in r.get('offsets', range(r['a'], r['b'])) for r in regions), regions
page.pdf.close()
print('通过：重复私用字形只关联原字符，虚线框不会误吞下方正文。')


class TinyBitmapPage(AdjoiningBitmapPage):
    def get_image_info(self):
        return [{'bbox': [14, 22, 17, 25]}]


page = TinyBitmapPage()
data = {'w': 100, 'h': 100, 't': '为；',
        'lines': [{'a': 0, 'b': 2, 'y': 10, 'bottom': 30, 'x': 10, 'right': 39}]}
_, regions = reading_media_regions(page, data, [], [[10, 10, 20, 20], [34, 10, 5, 20]], '为；')
assert all(r['a'] == r['b'] for r in regions), regions
page.pdf.close()
print('通过：文字中心附近的微小图像不能取代整个正常汉字。')


class CompositePage(OverlappingFontPage):
    def get_svg_image(self, **kwargs):
        return '''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
          <defs><path id="outline" d="M0 0L6 -14L12 0Z"/><path id="han" d="M0 0L5 0L2 -5Z"/></defs>
          <use data-text="△" xlink:href="#outline" transform="matrix(1,0,0,1,10,24)"/>
          <use data-text="危" xlink:href="#han" transform="matrix(1,0,0,1,14,21)"/>
        </svg>'''

    def get_text(self, kind, **kwargs):
        return {'blocks': [{'lines': [{'dir': [1, 0], 'bbox': [10, 10, 22, 26], 'spans': [
            {'font': 'FZSSK', 'bbox': [10, 10, 22, 26], 'chars': [
                {'c': '△', 'bbox': [10, 10, 22, 26], 'origin': [10, 24]},
                {'c': '危', 'bbox': [14, 16, 19, 22], 'origin': [14, 21]},
            ]}
        ]}]}]}

    def get_texttrace(self):
        return [{'dir': [1, 0], 'size': 16, 'chars': [
            (ord('△'), 0, (10, 24), [10, 10, 22, 26]),
            (ord('危'), 0, (14, 21), [14, 15, 19, 22]),
        ]}]


page = CompositePage()
data = {'w': 100, 'h': 100, 't': '△危',
        'lines': [{'a': 0, 'b': 2, 'y': 10, 'bottom': 26, 'x': 10, 'right': 22}]}
_, regions = reading_media_regions(page, data, [], [[10, 10, 12, 16], [14, 16, 5, 6]], '△危')
assert len(regions) == 1 and regions[0]['offsets'] == [0, 1], regions
assert regions[0]['rect'][1] < 10, '墨迹中心用于身份核对，不能当裁片上缘而裁掉三角顶'
assert regions[0]['svg'].count('<path ') == 2 and '<text' not in regions[0]['svg']
page.pdf.close()
print('通过：组合符号按真实原字框完整截取，trace与rawdict上缘不同也能匹配，不裁三角顶。')


class SharedPaintOperationPage(CompositePage):
    def get_bboxlog(self):
        return [('fill-text', [1, 1, 99, 99])]

    def get_texttrace(self):
        chars = super().get_texttrace()[0]['chars']
        return [{'dir': [1, 0], 'size': 16, 'seqno': 0, 'chars': [char]} for char in chars]


page = SharedPaintOperationPage()
_, regions = reading_media_regions(page, data, [], [[10, 10, 12, 16], [14, 16, 5, 6]], '△危')
x0, y0, x1, y1 = regions[0]['rect']
assert x1 - x0 < 20 and y1 - y0 < 20, '同一绘制操作含多段文字时，不能把整行范围当作单个符号范围'
page.pdf.close()
print('通过：字形画界只按对应矢量路径计算，共享绘制操作的大范围不会把符号缩成小点。')
