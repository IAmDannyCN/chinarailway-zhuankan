"""Table captions must not absorb a separately printed station range."""
import argparse
import collections
import gzip
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from indexer import attachment_caption_title, segment_document, source_reference


def fixture(caption, scope, *, bold_change=True, separate_row=True, right_note=True):
    text = caption + scope
    split = len(caption)
    styles = [[0, int(bold_change), 10], [split, 0, 9 if bold_change else 10]]
    boxes = [[25 + i * 2, 10, 2, 4] for i in range(split)]
    boxes += [[(70 if right_note else 25 + split * 2) + i * 2,
               14 if separate_row else 10, 2, 3.5] for i in range(len(scope))]
    return {'t': text, 'styles': styles}, boxes


def check_rules():
    caption, scope = '甲乙线客运运价里程表', '北京南—天津(国铁)'
    for options in [{}, {'bold_change': False}, {'separate_row': False}]:
        page, coords = fixture(caption, scope, **options)
        original = json.dumps(page, ensure_ascii=False)
        assert attachment_caption_title(page, caption + scope, coords) == caption
        assert json.dumps(page, ensure_ascii=False) == original
    page, coords = fixture(caption, scope, bold_change=False, separate_row=False, right_note=False)
    assert attachment_caption_title(page, caption + scope, coords) == caption + scope
    for title in ['跨月订单签订情况报表(ddb—1)', '月份订单执行情况统计分析报表(ddb—2)',
                  '《铁路危险货物品名表》(tb/t30006—2022)特殊规定78、79、72',
                  '客运运价里程表2015—2016', '甲线客运运价里程表']:
        assert attachment_caption_title({'t': title, 'styles': []}, title) == title
    assert source_reference(ROOT / 'pdf/example.pdf', ROOT / 'offline') == '../pdf/example.pdf'
    external = ROOT.parent / '独立专刊目录' / '专刊 #1.pdf'
    assert source_reference(external, ROOT / 'offline') == external.resolve().as_uri()
    print('通过：线路范围按版式与正式表题分开；同一行的正式标题、表号、标准号及年份范围保留；源文字不变。')


def check_corpus():
    catalogue = json.loads((ROOT / 'offline/data/index.js').read_text().strip()[15:-1])
    changed = []
    total = 0
    for old in catalogue['docs']:
        folder = ROOT / 'offline/data' / old['id']
        layout = json.load(gzip.open(folder / 'layout.json.gz', 'rt'))
        new = segment_document(layout, ROOT / 'pdf' / old['file'], ROOT / 'offline')
        total += len(new['entries'])
        assert new['texts'] == old['texts'], old['file']
        assert len(new['entries']) == len(old['entries']), old['file']
        for before, after in zip(old['entries'], new['entries']):
            assert before['id'] == after['id'], (old['file'], before['id'], after['id'])
            assert before['parts'] == after['parts'], (old['file'], before['title'])
            assert (before['p'], before['a'], before['kind']) == (after['p'], after['a'], after['kind'])
            if before['title'] != after['title']:
                assert before['kind'] == '附件' and before['title'].startswith(after['title'])
                changed.append({'file': old['file'], 'year': old['year'], 'page': after['p'] + 1,
                                'before': before['title'], 'after': after['title']})
    years = dict(sorted(collections.Counter(row['year'] for row in changed).items()))
    print(json.dumps({'issues': len(catalogue['docs']), 'entries': total,
                      'changedCaptions': len(changed), 'changedIssues': len({row['file'] for row in changed}),
                      'years': years, 'sourceTextAndBoundariesChanged': 0}, ensure_ascii=False))
    return changed


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--corpus', action='store_true', help='Read all existing caches without rewriting generated data.')
    args = parser.parse_args()
    check_rules()
    if args.corpus:
        check_corpus()
