"""Regression checks for real railway documents and incremental updates."""
from pathlib import Path
import argparse
import json
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from indexer import extract_document, render_document
from update import discover_sources, update_lock


def check_boundaries(documents):
    by_name = {document['file']: document for document in documents}

    def document(name):
        return by_name[name]

    def find(name, text, kind=None):
        matches = [entry for entry in document(name)['entries'] if text in entry['title']
                   and (entry['kind'] == kind if kind else entry['kind'] != '目录')]
        assert matches, (name, text, kind)
        return matches[0]

    first = find('kh1951601000.pdf', '公布中苏铁路联运文件')
    second = find('kh1951601000.pdf', '指示开办中苏铁路联运')
    assert first['p'] == second['p'] == 0 and first['a'] < second['a']
    assert first['parts'][-1]['b'] <= second['parts'][0]['a']
    assert second['parts'][-1]['p'] == 2
    assert find('kh1951601000.pdf', '制定鲜鱼介特价')['p'] == 78
    assert find('kh1951601000.pdf', '中苏铁路联运规章订正表')['p'] == 89

    early_clip = find('kh1964401020.pdf', '松沪线', '剪贴页')
    assert early_clip['p'] == 48
    attached = find('kh1964401020.pdf', '冷藏车按一张运单运送易腐货物条件', '附件')
    assert attached['p'] == 28 and attached.get('parentId')

    parent = find('kh1986105000.pdf', '印发《关于发展联合运输若干问题的暂行规定》', '文件')
    child = find('kh1986105000.pdf', '关于发展联合运输若干问题的暂行规定', '附件')
    assert child['parentId'] == parent['id'] and len(child['parts']) >= 4
    postal = find('kh1989105000.pdf', '行李、包裹托运单上填写', '文件')
    assert postal['p'] == 29 and postal['parts'][-1]['p'] == 30
    assert not any(entry['kind'] == '剪贴页' and entry['p'] == 29 for entry in document('kh1989105000.pdf')['entries'])

    same_page = find('kh1992301000.pdf', '关于修改《关于加强乘车证管理', '文件')
    assert same_page['p'] == 0 and same_page['a'] > 0
    assert len(same_page['parts']) == 2
    assert '第104号' in document('kh2008105000.pdf')['texts'][0]
    assert '2008年5月1日' in document('kh2008105000.pdf')['texts'][0]
    assert document('kh2008105000.pdf')['labels'][0] == '1'

    main = find('kh2013106000.pdf', '关于公布麻醉药品和精神药品品种目录的通知', '文件')
    appendix = find('kh2013106000.pdf', '麻醉药品品种目录(2013年版)', '附件')
    assert main['p'] == 67 and appendix['parentId'] == main['id']
    assert document('kh2013106000.pdf')['labels'][268] == '261'
    assert any(entry['kind'] == '文件' for entry in document('kh2011106000.pdf')['entries'])

    first_table = find('KH2015101000.pdf', '青烟直通线客运运价里程表', '附件')
    second_table = find('KH2015101000.pdf', '烟荣联络线客运运价里程表', '附件')
    assert first_table['p'] == second_table['p'] == 25
    assert first_table['parentId'] == second_table['parentId']
    assert first_table['parts'][-1]['b'] <= second_table['parts'][0]['a']

    newest = '铁路客货运输2025-6.pdf'
    assert find(newest, '盘兴高铁开通运营', '文件')['parts'] == [{'p': 9, 'a': 0, 'b': len(document(newest)['texts'][9])}]
    assert find(newest, '306—1页剪贴页', '剪贴页')['p'] == 150
    assert document(newest)['labels'][150] == '306—1'
    assert document(newest)['labels'][19] == '12'
    assert find(newest, '《铁路客运运价里程表》修改事项', '修改事项')['p'] == 90
    assert document('KH2017102030.pdf')['issue'] == '2、3期合刊'
    assert not any(entry['kind'] == '待核对' for entry in document('KH2016106000.pdf')['entries'])
    print('通过：同页多令、独立剪贴页、附件关联、跨页续表、目录隔离、旧字体数字、原刊页码。')

    def page_entries(name, number):
        return [entry for entry in document(name)['entries']
                if any(part['p'] == number - 1 for part in entry['parts'])]

    # Literal page checks catch layout variants across eras, not just one station or issue.
    for name, number in [('kh2007101000.pdf', 325), ('kh2012101000.pdf', 123),
                         ('KH2019101000.pdf', 158), ('KH2020103000.pdf', 187),
                         ('KH2020103000.pdf', 218), (newest, 151)]:
        assert {entry['kind'] for entry in page_entries(name, number)} == {'剪贴页'}, (name, number)
    assert {entry['kind'] for entry in page_entries('kh2007101000.pdf', 387)} == {'目录'}
    assert '黄土坡' in document('kh2007101000.pdf')['texts'][324]
    assert '京沪线' in document('kh2007101000.pdf')['texts'][324]
    assert '暋' not in ''.join(document('kh2007101000.pdf')['texts'])
    for entry in page_entries('KH2019101000.pdf', 158):
        assert {'货运', '站线与里程'} <= set(entry['topics'])
    assert {'客运', '站线与里程'} <= set(find(newest, '306—1页剪贴页')['topics'])
    assert not any(entry['kind'] == '附件' and entry['title'] == '煤,焦炭,金'
                   for entry in document('kh2008102000.pdf')['entries'])
    assert find('kh1962410120.pdf', '中朝铁路国境站车辆交接技术条件', '附件').get('parentId')
    # Select the appendix printed out of order, after the independent modification pages.
    misplaced = next(entry for entry in page_entries('铁路客货运输2021-3.pdf', 135)
                     if entry['title'] == '专用线危险货物办理限制修改事项')
    assert '2021009' in misplaced['parentTitle']
    assert all(entry['kind'] == '附件' for entry in page_entries('铁路客货运输2021-3.pdf', 135))
    print('通过：异体书名号、剪贴页续页、版权页排除、空格乱码、修改事项、交叉业务筛选和错页附件关联。')

    # More original-page checks: each decade includes same-page boundaries, continuations and inserts.
    for name, number in [('kh1957511000.pdf', 54), ('kh1964411120.pdf', 38),
                         ('kh1979103000.pdf', 62), ('kh1989105000.pdf', 43),
                         ('kh1992205000.pdf', 78), ('kh2009105000.pdf', 110),
                         ('KH2016104000.pdf', 170), ('铁路客货运输2021-3.pdf', 174)]:
        entries = page_entries(name, number)
        assert len(entries) == 1 and entries[0]['kind'] == '剪贴页', (name, number)
    for name, number, count in [('kh1958503000.pdf', 16, 3), ('kh1994302000.pdf', 57, 2),
                                ('KH2019102030.pdf', 173, 4), ('铁路客货运输2025-1.pdf', 38, 4)]:
        entries = page_entries(name, number)
        assert len(entries) == count and all(e['kind'] == '附件' for e in entries), (name, number, entries)
        assert len({e['parentId'] for e in entries}) == 1, (name, number)
    assert len(page_entries('kh1968411120.pdf', 5)) == 1
    assert len(page_entries('kh1971103000.pdf', 2)) == 1
    assert len(page_entries('kh1987106000.pdf', 55)) == 2
    assert {e['kind'] for e in page_entries('kh1999106000.pdf', 29)} == {'附件'}
    table = page_entries('kh2006103000.pdf', 344)
    assert len(table) == 1 and table[0]['kind'] == '附件'
    assert table[0]['p'] == 330 and table[0]['parts'][-1]['p'] == 355
    for name, number in [('kh1959509000.pdf', 4), ('kh1968409100.pdf', 15),
                         ('kh1979104000.pdf', 2), ('kh1989106000.pdf', 7),
                         ('kh2009106000.pdf', 16), ('kh2014106000.pdf', 26), (newest, 40)]:
        entries = page_entries(name, number)
        assert len(entries) == 2, (name, number, entries)
        assert entries[0]['p'] < number - 1 and entries[1]['p'] == number - 1
        assert entries[0]['parts'][-1]['b'] == entries[1]['parts'][0]['a']
    assert find('kh2003103000.pdf', '关于萨拉齐站使用集装箱装煤问题的通报')['title'].endswith('通报')
    forwarded = find('kh1971104000.pdf', '国务院批转煤炭工业部、铁道部', '文件')
    coal = find('kh1971104000.pdf', '煤炭送货办法', '附件')
    assert forwarded['p'] == coal['p'] == 10 and coal['parentId'] == forwarded['id']
    assert page_entries('kh1971104000.pdf', 15)[0]['id'] == coal['id']
    for name, title, number in [('kh1952601000.pdf', '货主自备货车用具使用及回送暂行办法', 30),
                                ('kh1955508000.pdf', '货物快运试行办法', 3),
                                ('KH2020101000.pdf', '铁路货运价格公告实施办法', 14)]:
        appendix = find(name, title, '附件')
        assert appendix['p'] == number - 1 and appendix.get('parentId'), (name, title)
    title = '关于重新公布各货运营业站最大起重能力的通知'
    assert find('kh1988102000.pdf', title)['p'] == 25
    for name, numbers, title in [
        ('kh1996201000.pdf', [9], '中华人民共和国固体废物污染环境防治法'),
        ('kh1997206000.pdf', [18], '中华人民共和国烟草专卖法实施条例'),
        ('kh2007103000.pdf', [7, 18, 25], '中华人民共和国物权法'),
        ('kh2012106000.pdf', [47, 67], '中华人民共和国民事诉讼法')]:
        for number in numbers:
            entries = page_entries(name, number)
            assert len(entries) == 1 and title in entries[0]['title'], (name, number, entries)
    print('通过：八个年代的同页多附件、跨页续文、表内引用、表单样式、换行章标题和注号隔断。')


def check_incremental():
    small = ['kh1958505000.pdf', 'kh1967404000.pdf']
    with tempfile.TemporaryDirectory(prefix='railway-update-check-') as temporary:
        root = Path(temporary)
        (root / 'pdf').mkdir()
        output = root / 'offline'
        source = root / 'pdf/铁路客货运输2026-1.pdf'
        shutil.copyfile(ROOT / 'pdf' / small[0], source)
        first = extract_document(source, output)
        assert render_document(source, output)[1] == len(first['pages'])
        images = sorted((output / 'data' / first['id']).glob('*.page.js'))
        timestamps = [image.stat().st_mtime_ns for image in images]
        assert extract_document(source, output)['id'] == first['id']
        assert render_document(source, output)[1] == 0
        assert timestamps == [image.stat().st_mtime_ns for image in images]
        images[0].unlink()
        assert render_document(source, output)[1] == 1
        assert timestamps[1:] == [image.stat().st_mtime_ns for image in images[1:]]
        original_coordinate = (output / 'data' / first['id'] / '1.coords.js').read_bytes()
        shutil.copyfile(ROOT / 'pdf' / small[1], source)
        changed = extract_document(source, output)
        assert changed['id'] != first['id']
        # Identity must depend on current content, never whether a prior PDF occupied the filename.
        clean = extract_document(source, root / 'clean')
        assert clean == changed
        assert (root / 'clean/data' / clean['id'] / 'layout.json.gz').read_bytes() == (output / 'data' / changed['id'] / 'layout.json.gz').read_bytes()
        assert (output / 'data' / first['id'] / '1.coords.js').read_bytes() == original_coordinate
        assert all(image.exists() for image in images)
        assert len(discover_sources(root)) == 1
        shutil.copyfile(source, root / '新增专刊' / source.name)
        try:
            discover_sources(root)
            raise AssertionError('重复文件名未拦截')
        except ValueError:
            pass
    print('通过：增量缓存、缺页补建、替换 PDF 后旧数据保留、同名文件拦截。')


def check_lock():
    with tempfile.TemporaryDirectory(prefix='railway-lock-check-') as temporary:
        path = Path(temporary) / '更新.lock'
        command = [sys.executable, '-B', '-c',
                   'import sys; from update import update_lock; '
                   'manager=update_lock(sys.argv[1]); manager.__enter__(); manager.__exit__(None,None,None)', str(path)]
        with update_lock(path):
            blocked = subprocess.run(command, cwd=ROOT, capture_output=True)
            assert blocked.returncode != 0, '并发更新未拦截'
        released = subprocess.run(command, cwd=ROOT, capture_output=True)
        assert released.returncode == 0, released.stderr.decode('utf8', errors='replace')
    print('通过：更新互斥与退出后重新运行。')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--incremental', action='store_true')
    args = parser.parse_args()
    raw = (ROOT / 'offline/data/index.js').read_text(encoding='utf8')
    documents = json.loads(raw.removeprefix('window.CATALOG=').strip().removesuffix(';'))['docs']
    assert {path.name for path in discover_sources()} == {document['file'] for document in documents}
    check_boundaries(documents)
    if args.incremental:
        check_incremental()
        check_lock()


if __name__ == '__main__':
    main()
