"""PDF text, layout and document boundaries for the offline railway catalogue."""
from pathlib import Path
import base64
import collections
import gzip
import hashlib
import json
import os
import re
import shutil
import unicodedata
import time
import html
from difflib import SequenceMatcher

import pymupdf
from PIL import Image

EXTRACT_VERSION = 8
SEGMENT_VERSION = 'library-5-html'
CATEGORIES = set('部令 各局处文件 货运 国际联运 客货运输 客、货运输 客运规章 货运规章 客货运管理 运营管理 客运管理 货运管理 货物运价 客货运运价 客货运价里程表 铁路专用线专用铁路名称表 法律文件 法规文件 法律法规 经济法规 价格管理 运输条件 客运运价 货运运价 其他 其它 客运 规章文件 运输组织 客货运输管理'.split())
CATEGORIES.update(['国务院文件', '其他文件', '铁路运输企业管理', '运输收入', '综合管理'])
# EU-BZ's embedded ToUnicode table substitutes these Han characters for digits and Latin glyphs.
# Applied only to that font, never to ordinary Chinese text (e.g. station names containing 园 or 源).
EU_GLYPHS = dict(zip('园员圆猿源缘远苑愿怨', '0123456789'))
EU_GLYPHS.update(dict(zip('粤月悦阅耘云郧匀陨允运蕴酝晕韵孕岳砸杂栽哉灾宰载再匝', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')))
EU_GLYPHS.update(dict(zip('葬遭糟凿藻枣早澡蚤躁噪造皂灶燥责择则泽贼怎增憎曾赠扎', 'abcdefghijklmnopqrstuvwxyz')))
EU_GLYPHS.update({'摇': '', '郾': '.', '援': '.', '辕': '/', '鄄': '-', '原': '-', '耀': '~',
                  '伊': '×', '越': '=', '垣': '+', '忆': '′', '翼': '№', '咬': 'ä', '俟': 'ü', '覿': 'ä', '觟': 'ö'})
ATTACHMENT = re.compile(r'^(?:附件|附表|附录)(?:第?[一二三四五六七八九十百\d]+(?:[.之][\d]+)*(?:号)?)?[:：]?$')
REFERENCE = re.compile(r'(?:[\u4e00-\u9fff]{0,16}[〔(\[]\d{2,4}[〕)\]][\u4e00-\u9fff]{0,12}(?:字第)?\d+号|[\u4e00-\u9fff]{2,16}字第\d+号|第[一二三四五六七八九十百\d]+号)')
STRUCTURAL_HEADING = re.compile(r'^第[一二三四五六七八九十百千万0-9]+[编篇章节条]')


def reference_line(text):
    text = re.sub(r'^\d{4}年\d{1,2}月\d{1,2}日', '', text)
    return bool(re.fullmatch(REFERENCE.pattern + r'(?:电|文|令)?', text)
                or re.fullmatch(r'[\u4e00-\u9fff\d〔〕()\[\]]{2,60}字第?\d+号(?:电|文|令)?', text))


def authority_heading(text):
    text = re.sub(r'\((?:电报|通知|文件|命令)\)$', '', text)
    if text == '中华人民共和国':
        return True
    if re.fullmatch(r'中华人民共和国(?:主席|国务院总理)[\u4e00-\u9fff]{0,6}', text):
        return True
    return (not re.search(r'关于|公布|印发|转发|发布|修改|制定|规定', text)
            and bool(re.fullmatch(r'.{2,35}(?:部|局|厅|公司|政府|委员会|人民法院|检察院)(?:联合)?(?:通知|电|函|令|命令|文件|公告)?', text)))


def title_key(text):
    text = heading_text(text)
    text = re.sub(r'^高法(?=关于)', '最高人民法院', text)
    text = re.sub(r'^高检(?=关于)', '最高人民检察院', text)
    return re.sub(r'[^\u4e00-\u9fff\da-z]', '', text)


def title_font(line):
    return bool(re.search(r'XBS|XiaoBiaoSong|小标宋', line['fonts'], re.I))


def bold_font(line):
    return title_font(line) or 'HT' in line['fonts'] or '黑体' in line['fonts']


SIGNOFF_DATE = re.compile(r'^[（(]?([一二三四五六七八九〇○零O0-9]{4})年([一二三四五六七八九十0-9]{1,3})月([一二三四五六七八九十0-9]{1,3})日[）)]?$')


def signoff_date(lines, width):
    for line in reversed(lines):
        match = SIGNOFF_DATE.fullmatch(line['t'])
        if not match:
            continue
        text = line['t'].strip('()（）')
        if line['x'] >= width * .44:
            return text
        if line is not lines[-1]:
            continue
        if len(lines) > 1 and authority_heading(lines[-2]['t']):
            return text
    return ''


def classify(title, category):
    if any(word in title for word in ['联运', '国境']):
        return '国际联运'
    if any(word in title for word in ['专用线', '专用铁路']):
        return '专用线'
    if any(word in title for word in ['里程表', '站名', '命名', '更名']):
        return '站线与里程'
    if any(word in title for word in ['货物', '货运', '集装箱']):
        return '货运'
    if any(word in title for word in ['旅客', '乘车', '客运']):
        return '客运'
    if '客运' in category:
        return '客运'
    if '货运' in category:
        return '货运'
    return '综合与运营'


def business_topics(title, category):
    """Business areas overlap: a freight mileage sheet belongs to both filters."""
    topics = []
    for topic, words in [
        ('国际联运', ['联运', '国境']),
        ('专用线', ['专用线', '专用铁路']),
        ('站线与里程', ['里程表', '站名', '命名', '更名', '开通运营']),
        ('货运', ['货物', '货运', '集装箱', '专用线', '专用铁路']),
        ('客运', ['旅客', '客运', '乘车', '客票', '行李', '包裹'])
    ]:
        if any(word in title for word in words):
            topics.append(topic)
    if not topics:
        topics = [classify(title, category)]
    return topics


def heading_text(text):
    return text.translate(str.maketrans({'«': '《', '»': '》', '枟': '《', '枠': '》'})).strip('暋摇\ufeff ')


def modification_title(text):
    text = heading_text(text)
    return bool(re.fullmatch(r'《[^》]{2,45}》(?:修改事项|订正表|勘误表|更正表)', text))


def section_title(page):
    lines = [heading_text(line['t']).strip('·()0123456789.') for line in page['lines']]
    if len(page['t']) >= 100:
        return ''
    combined = ''.join(lines)
    if combined in CATEGORIES or combined == '剪贴页':
        return combined
    return next((text for text in lines if text in CATEGORIES or text == '剪贴页'), '')


def metadata(filename):
    year_match = re.search(r'(?:19|20)\d{2}', filename)
    if not year_match:
        raise ValueError('文件名缺少四位年份，请补充年份后重试。')
    year = int(year_match[0])
    code = re.search(r'(?i)kh\d{4}\d(\d{4})', filename)
    if code:
        first, last = int(code[1][:2]), int(code[1][2:])
    else:
        suffix = filename[year_match.end():].removesuffix('.pdf').removesuffix('.PDF')
        numbers = re.findall(r'\d+', suffix)
        first, last = (int(numbers[0]), int(numbers[1]) if len(numbers) > 1 else 0) if numbers else (0, 0)
    if not 1 <= first <= 12 or (last and not first < last <= 12):
        raise ValueError('无法确认刊期，请使用“铁路客货运输2026-1.pdf”这样的文件名。')
    issue = f'{first}、{last}期合刊' if last else f'{first}期'
    return year, issue, first


def page_label(page):
    if page.get('rotated'):
        return page['label']
    # The header is already in reading order. Sorting individual glyphs by x can mix dates into it.
    clip_labels = [match[1] for line in clipping_headers(page)
                   if (match := re.search(r'》(?:[上下]册)?([0-9]+(?:[—~～、,-][0-9]+)*)(?:页|剪贴页)', line['t']))]
    if clip_labels:
        return '、'.join(dict.fromkeys(clip_labels))
    for line in page['lines']:
        if line['y'] < 75:
            header = re.sub(r'\([^)]*\)', '', line['t'])
            if '·' in header and re.fullmatch(r'[·\d—-]+', header):
                return header.replace('·', '')
            match = re.search(r'·(\d+(?:[—-]\d+)?)·', line['t'])
            if match:
                return match[1]
    return page['label']


def clipping_headers(page):
    headers = []
    for line in page['lines']:
        text = heading_text(line['t'])
        if ('剪贴页' not in text or len(text) > 130 or re.search(r'附剪贴页|见剪贴页|剪贴页[中内的上所。)）]', text)
                or '修改事项' in text or '通知' in text or 'BookMaker' in line['fonts']
                or re.search(r'[⋯…]{2,}|[.]{3,}', text)):
            continue
        match = re.match(r'^(?:《[^》]{2,45}》[^。:：]{0,65}?|[\u4e00-\u9fff]{4,40})剪贴页', text)
        if match:
            # Some PDFs merge the first character of the route heading into this line.
            title = match[0]
            trailing = text[match.end():]
            if re.fullmatch(r'[\d—~～、-]+', trailing):
                title += trailing
            headers.append(dict(line, t=title))
    return headers


def section_page(page):
    return bool(section_title(page))


def support_pages(pages):
    support = {}
    first_divider = next((i for i, page in enumerate(pages[:25]) if section_page(page)), None)
    front = any('图书在版编目' in p['t'] or 'isbn' in p['t'] for p in pages[:4])
    first_body = next((i for i, page in enumerate(pages[2:25], 2) if
                       any(title_font(line) and line['t'] in CATEGORIES for line in page['lines'])
                       and not any('BookMaker' in line['fonts'] for line in page['lines'])), first_divider)
    if front and first_body is not None:
        for i in range(first_body):
            support[i] = '封面与目录'
    annual = False
    for i, page in enumerate(pages):
        text = page['t']
        if any(re.fullmatch(r'(?:19|20)\d{2}年(?:(?:全年)?总目录|《铁路客货运输专刊》目录索引)', line['t']) for line in page['lines'][:6]):
            annual = True
        if annual and (clipping_headers(page) or section_page(page) or '仅供参考' in text[:110]
                       or any(line['y'] < 150 and modification_title(line['t']) for line in page['lines'])):
            annual = False
        if annual:
            support[i] = '全年总目录'
        elif front and i < 15 and ('目录' in text[:110] or i < 2 or any('BookMaker' in line['fonts'] for line in page['lines'])):
            support[i] = '封面与目录'
        if section_page(page):
            support[i] = '剪贴页分隔页' if '剪贴页' in text else '章节分隔页'
        if i >= len(pages) - 3 and (('出版者' in text and ('编辑者' in text or '印刷者' in text))
                                  or ('图书在版编目' in text and 'isbn' in text)):
            support[i] = '版权页'
    return support


def heading_groups(page, include_bold=False):
    groups = []
    for line in page['lines']:
        if not (bold_font(line) if include_bold else title_font(line)) or len(line['t']) < 2 or line['t'] in CATEGORIES:
            continue
        if include_bold and not title_font(line) and not re.search(r'HT|黑体', line['fonts']):
            continue
        gap = page['t'][groups[-1][-1]['b']:line['a']] if groups else ''
        if (groups and line['y'] - groups[-1][-1]['bottom'] < 18
                and not STRUCTURAL_HEADING.match(line['t'])
                and not re.match(r'^[一二三四五六七八九十]+、', line['t'])
                and (line['a'] == groups[-1][-1]['b'] or re.fullmatch(r'[\ue000-\uf8ff*＊※†‡]{1,3}', gap))):
            groups[-1].append(line)
        else:
            groups.append([line])
    # Filter whole wrapped headings, so their second line cannot become a new document.
    return [group for group in groups if not STRUCTURAL_HEADING.match(group[0]['t'])
            and not re.match(r'^[一二三四五六七八九十]+、', group[0]['t'])]


def attachment_title(pages, page_index, line_index):
    page = pages[page_index]
    marker = page['lines'][line_index]
    following = page['lines'][line_index + 1:line_index + 7]
    if not following and page_index + 1 < len(pages):
        following = [line for line in pages[page_index + 1]['lines'] if line['y'] > 45][:6]
    if not following:
        return None
    first = following[0]
    # Blank attachment fields in printed forms are followed by a signature/date.
    if authority_heading(first['t']) and not bold_font(first):
        return None
    # “锅炉附件” in a narrow commodity column is not an attachment heading.
    if (marker['x'] > page['w'] * .3 and first['x'] < marker['x'] - page['w'] * .06
            and not bold_font(marker) and not bold_font(first)
            and ('品类' in page['t'][:300] or '专用线名称' in page['t'][:300])):
        return None
    if ATTACHMENT.fullmatch(first['t']) or re.search(r'^[一二三四五六七八九〇○零\d]{2,}年', first['t']):
        return None
    # Reprinted orders have their own authority, reference and title inside the attachment.
    group = next((group for group in heading_groups(page) if marker['b'] <= group[0]['a']
                  and group[0]['y'] - marker['bottom'] < 135), None)
    if group:
        return ''.join(line['t'] for line in group)
    title = []
    for line in following[:3]:
        text = line['t']
        if len(text) > 65 or re.match(r'^(第[一二三四五六七八九十\d]+条|[一二三四五六七八九十]+、|单位[:：])', text):
            break
        if not title and (bold_font(line) or (len(text) <= 50 and line['x'] > page['w'] * .17)):
            title.append(text)
        elif title and bold_font(line) and line['y'] - first['bottom'] < 30 and not REFERENCE.search(text):
            title.append(text)
        else:
            break
    return ''.join(title) or None


def segment_document(layout, source, output):
    pages, ident = layout['pages'], layout['id']
    year, issue, issue_order = metadata(layout['file'])
    support = support_pages(pages)
    candidates, warnings = [], []
    if layout.get('fontWarnings'): warnings.append(dict(type='原件字体兼容',page=1,title=layout['fontWarnings'][:350]))
    category, clip, clip_header = '综合与运营', False, '剪贴页'
    for i, page in enumerate(pages):
        if i in support:
            if support[i] == '剪贴页分隔页':
                clip = True
            elif support[i] == '章节分隔页':
                clip = False
                category = section_title(page) or category
            continue
        lines, text = page['lines'], page['t']
        for line in lines:
            if line['t'] in CATEGORIES:
                category = line['t']
                clip = False
        groups = [group for group in heading_groups(page) if len(''.join(line['t'] for line in group)) >= 6
                  and not authority_heading(''.join(line['t'] for line in group))
                  and not re.match(r'^第[一二三四五六七八九十百0-9]+[章节]', group[0]['t'])
                  and not re.fullmatch(r'(?:\d{4}年)?(?:全年)?总?目录', ''.join(line['t'] for line in group))]
        for group in heading_groups(page, include_bold=True):
            title = ''.join(line['t'] for line in group)
            paired_appendix = any(parent[0]['a'] < group[0]['a'] and title in ''.join(line['t'] for line in parent)
                                  and re.search(r'批转|转发|印发|公布|发布', ''.join(line['t'] for line in parent))
                                  for parent in groups)
            if (not any(title_font(line) for line in group) and 6 <= len(title) < 100
                    and not re.search(r'[。:：]$', title)
                    and (re.match(r'^(?:关于|印发|转发|发布|公布|修订|(?:国务院)?批转)', title)
                         or (title.startswith(('中华人民共和国', '最高人民法院'))
                             and title.endswith(('法', '办法', '条例', '规定', '规则', '解释', '决定', '通知', '公告')))
                         or (re.search(r'关于|公布|印发|转发', title) and title.endswith(('通知', '公告', '批复', '决定')))
                         or (title.endswith(('办法', '规定', '条例', '规则'))
                             and (group[0]['y'] < 160 or paired_appendix)))
                    and not authority_heading(title)
                    and not title.endswith(('部', '局', '公司', '委员会', '令', '文件', '法院', '检察院'))):
                groups.append(group)
        headers = clipping_headers(page)
        strong_clip = any(line['y'] < page['h'] * .25 for line in headers)
        if strong_clip:
            clip = True
        elif groups and any(REFERENCE.search(text[max(0, group[0]['a'] - 150):group[0]['a']]) for group in groups):
            clip = False
        if any(line['y'] < 150 and modification_title(line['t']) for line in lines):
            clip = False
        # Early inserts can have a restarted plain page number and a route heading, without 剪贴页.
        route_heads = [line['t'] for line in lines if line['y'] < 105 and bold_font(line)
                       and re.fullmatch(r'[\u4e00-\u9fff]{2,18}线', line['t'])]
        bare_number = any(line['y'] < 45 and re.fullmatch(r'\d{1,4}', line['t']) for line in lines)
        if i > len(pages) * .7 and route_heads and bare_number and '站' in text[:250] and '里' in text[:250]:
            clip = True
            clip_header = '里程表剪贴页｜' + '、'.join(route_heads)
        if clip:
            if headers:
                clip_header = '；'.join(dict.fromkeys(line['t'].split(':')[0] for line in headers))
            names = [line['special'] for line in lines if 2 <= len(line['special']) <= 30
                     and not line['t'].startswith('注')]
            title = clip_header + ('' if headers else '（续页）')
            if names:
                title += '｜' + '、'.join(dict.fromkeys(names))
            candidates.append(dict(p=i, a=0, title=title, category=category, kind='剪贴页', confidence='页级分割'))
            continue
        attachments = []
        margin = min((line['x'] for nearby in pages[max(0, i - 1):i + 1]
                      if abs(nearby['w'] - page['w']) < 3
                      for line in nearby['lines'] if len(line['t']) >= 24
                      and line['right'] - line['x'] > page['w'] * .55), default=page['w'] * .21)
        for k, line in enumerate(lines):
            inline = re.fullmatch(r'(附件[0-9一二三四五六七八九十园员圆猿源缘远苑愿怨]{0,3})[:：](.{3,65})', line['t'])
            flush_left = line['x'] <= margin + max(3, line['size'] * .65)
            before_signoff = inline and any(SIGNOFF_DATE.fullmatch(other['t']) and other['x'] >= page['w'] * .44
                                            for other in lines[k + 1:k + 4])
            if inline and not before_signoff and (bold_font(line) or flush_left or (page['images'] and line['y'] < page['h'] * .25
                                              and inline[2].endswith(('图', '图样', '表')))):
                label = inline[1]
                if 'EU-' in line['fonts']:
                    label = ''.join(EU_GLYPHS.get(char, char) for char in label[2:])
                    label = '附件' + label
                attachments.append(dict(p=i, a=line['a'], title=inline[2], attachmentLabel=label,
                                        category=category, kind='附件', confidence='同行附件标题识别'))
                continue
            if ATTACHMENT.fullmatch(line['t']):
                title = attachment_title(pages, i, k)
                if title:
                    attachments.append(dict(p=i, a=line['a'], title=title, attachmentLabel=line['t'].rstrip(':：'),
                                            category=category, kind='附件', confidence='附件标题识别'))
            elif re.match(r'^附[:：].{3,45}$', line['t']) and bold_font(line):
                attachments.append(dict(p=i, a=line['a'], title=line['t'][2:], attachmentLabel='附',
                                        category=category, kind='附件', confidence='附件标题识别'))
        candidates += attachments
        for group in groups:
            title = ''.join(line['t'] for line in group)
            first, start = group[0], group[0]['a']
            attached = next((a for a in reversed(attachments) if a['a'] <= start and title in a['title']), None)
            if attached:
                continue
            preceding = [line for line in lines if line['b'] <= start]
            reference, issuer = [], []
            for line in reversed(preceding):
                if line['t'] in CATEGORIES:
                    start = min(start, line['a'])
                    break
                if not issuer and reference_line(line['t']) and len(line['t']) < 70:
                    reference.insert(0, line['t'])
                    start = min(start, line['a'])
                elif len(line['t']) < 45 and authority_heading(line['t']) and (
                        bold_font(line) or reference and line['size'] > first['size'] * 1.08):
                    issuer.insert(0, line['t'])
                    start = min(start, line['a'])
                elif re.fullmatch(r'\([^)]{1,30}\)', line['t']):
                    start = min(start, line['a'])
                else:
                    break
            prefix = text[:start]
            if title in prefix and re.search(r'现予公布|现公布|现予发布|予以公布|制定', prefix) and not any(c['p'] == i for c in candidates):
                start = 0
            candidates.append(dict(p=i, a=start, title=title, category=category, kind='文件', confidence='标题版式识别',
                                   reference='／'.join(reference), issuer='／'.join(issuer)))
        # Correction tables and modification lists use body or bold fonts in several eras.
        for line in lines:
            if not (line['y'] < 140 and len(line['t']) < 65):
                continue
            if re.search(r'(?:订正表|勘误表|更正表|》修改事项)$', heading_text(line['t'])):
                if not any(c['p'] == i and (line['t'] in c['title'] or c['title'] in line['t']) for c in candidates):
                    candidates.append(dict(p=i, a=line['a'], title=line['t'], category=category, kind='文件', confidence='表格标题识别'))
        # Law announcements can consist solely of an authority, ordinal and body text.
        for k, line in enumerate(lines):
            if line['t'] not in CATEGORIES and re.search(r'(?:主席令|部令|总局令|委员会令|国务院令|法院公告)$', line['t']) and bold_font(line):
                following = ''.join(item['t'] for item in lines[k + 1:k + 7])
                legal_title = re.search(r'《([^》]+)》', following)
                if not legal_title:
                    continue
                title = legal_title[1]
                existing = next((c for c in candidates if c['p'] == i and title_key(c['title']) == title_key(title)), None)
                if existing:
                    existing['a'] = min(existing['a'], line['a'])
                    existing['title'] = title
                else:
                    candidates.append(dict(p=i, a=line['a'], title=title, category=category, kind='文件', confidence='公布令识别'))
            # Some 1950s notices print the subject in the body font immediately after the reference.
            if (reference_line(line['t']) and len(line['t']) < 60 and k + 1 < len(lines)
                    and k > 0 and authority_heading(lines[k - 1]['t'])
                    and (bold_font(lines[k - 1]) or abs((lines[k - 1]['x'] + lines[k - 1]['right']) / 2 - page['w'] / 2) < page['w'] * .15)):
                following = lines[k + 1:k + 6]
                if re.match(r'^(?:公布|转发|关于|印发)', following[0]['t']) and not bold_font(following[0]):
                    title_lines = []
                    for part in following:
                        if (re.match(r'^(各|部内|抄|部属|局内|兹|根据|现将)', part['t'])
                                or part['size'] < following[0]['size'] * .85):
                            break
                        title_lines.append(part['t'])
                        if part['t'].endswith('。'):
                            break
                    title = ''.join(title_lines).rstrip('。')
                    if 6 <= len(title) <= 150 and not any(c['p'] == i and title in c['title'] for c in candidates):
                        start = lines[k - 1]['a']
                        candidates.append(dict(p=i, a=start, title=title, category=category, kind='文件', confidence='文号与正文标题识别'))
    # Bookmarks are hints: their destinations can be off by a page and their numbering is not a title.
    for level, raw_title, page_number in layout['toc']:
        title = norm(re.sub(r'^[一二三四五六七八九十百0-9]+[、.．]\s*', '', raw_title))
        if (len(title) < 6 or title in CATEGORIES or STRUCTURAL_HEADING.match(title) or authority_heading(title)
                or re.fullmatch(r'(?:\d{4}年)?(?:全年)?总?目录', title) or '剪贴' in title):
            continue
        if re.search(r'\.pdf$', title, re.I) or not re.search(r'[\u4e00-\u9fff]', title) or re.fullmatch(r'专刊\d+', title):
            continue
        if title in ['客货运价里程表铁路专用线专用铁路名称表', '客货运价里程铁路专用线专用铁路名称表']:
            continue
        if re.match(r'^《(?:(?:铁路)?客运运价里程表|货物运价里程表)》', title):
            continue
        matched = False
        for i in dict.fromkeys([page_number - 1, page_number - 2, page_number, page_number - 3, page_number + 1]):
            if i < 0 or i >= len(pages) or i in support:
                continue
            position = pages[i]['t'].find(title)
            if position < 0:
                continue
            if any(c['p'] == i and c['kind'] == '剪贴页' for c in candidates):
                matched = True
                break
            same = next((c for c in candidates if c['p'] == i and (title in c['title'] or c['title'] in title
                        or title_key(title) == title_key(c['title']))), None)
            if same:
                same['confidence'] = '书签与正文核对'
            else:
                line = next((line for line in pages[i]['lines'] if line['a'] <= position < line['b']), None)
                if not line:
                    continue
                if position != line['a'] and not bold_font(line):
                    prefix = pages[i]['t'][line['a']:position]
                    if not re.fullmatch(r'[一二三四五六七八九十百0-9、.附录资料转摘重登:：\ue010]{1,12}', prefix):
                        # A bookmark for a clause inside a notice is not a new independent document.
                        matched = True
                        break
                candidates.append(dict(p=i, a=position, title=title, category='综合与运营', kind='文件', confidence='书签与正文核对'))
            matched = True
            break
        if not matched:
            key = re.sub(r'[^\u4e00-\u9fff\da-z]', '', title)
            nearby = [c for c in candidates if abs(c['p'] - (page_number - 1)) <= 4]
            for candidate in nearby:
                other = re.sub(r'[^\u4e00-\u9fff\da-z]', '', candidate['title'])
                if (min(len(key), len(other)) >= 10 and (key in other or other in key)) or SequenceMatcher(None, key, other).ratio() >= .88:
                    candidate['confidence'] = '书签与正文标题核对'
                    matched = True
                    break
                if title in ['客运运价修改事项', '货运修改事项'] and '修改事项' in candidate['title'] and title[:2] in candidate['title']:
                    matched = True
                    break
        if not matched:
            warnings.append(dict(type='书签未核准', page=max(1, page_number), title=title))
    candidates.sort(key=lambda item: (item['p'], item['a'], item['kind'] != '附件'))
    candidates = [c for c in candidates if not (re.fullmatch(r'(?:最高)?人民法院公告', c['title']) and
                  any(other['p'] == c['p'] and other['title'] != c['title'] and '最高人民法院' in other['title'] for other in candidates))]
    cleaned = []
    first_offset_by_page = {}
    for candidate in candidates:
        # Repeated running table headings stay part of the existing table.
        if cleaned and candidate['kind'] == '文件' and candidate['title'] == cleaned[-1]['title'] and candidate['p'] <= cleaned[-1]['p'] + 1:
            continue
        prior = [line for line in pages[candidate['p']]['lines'] if line['b'] <= candidate['a']]
        first_offset = first_offset_by_page.setdefault(candidate['p'], candidate['a'])
        if candidate['a'] == first_offset and all(line['y'] < 60 or line['t'] in CATEGORIES for line in prior):
            candidate['a'] = 0
        if not cleaned and candidate['p'] == 0 and candidate['a'] < 220 and not re.search(r'[。:：]', pages[0]['t'][:candidate['a']]):
            candidate['a'] = 0
        if cleaned and (cleaned[-1]['p'], cleaned[-1]['a']) == (candidate['p'], candidate['a']):
            if candidate['kind'] == '附件':
                cleaned[-1] = candidate
            continue
        cleaned.append(candidate)
    entries = []
    parent = None
    for index, candidate in enumerate(cleaned):
        end = cleaned[index + 1] if index + 1 < len(cleaned) else dict(p=len(pages), a=0)
        parts = []
        for i in range(candidate['p'], min(end['p'] + 1, len(pages))):
            if i in support or (candidate['kind'] == '剪贴页' and i != candidate['p']):
                continue
            start = candidate['a'] if i == candidate['p'] else 0
            finish = end['a'] if i == end['p'] else len(pages[i]['t'])
            if finish > start:
                parts.append(dict(p=i, a=start, b=finish))
        if not parts:
            continue
        first_text = '\n'.join(line['t'] for line in pages[candidate['p']]['lines']
                               if candidate['a'] <= line['a'] < candidate['a'] + 180)
        number = REFERENCE.search(first_text)
        entry = dict(candidate, id=f'{ident}-{len(entries)}', parts=parts,
                     number=candidate.get('reference') or (number[0] if number else ''), topic=classify(candidate['title'], candidate['category']))
        entry['title'] = heading_text(entry['title'])
        # Some facing-page tables print their caption across the two halves.
        if (entry['kind'] == '附件' and entry['title'].endswith('直通') and len(parts) > 1
                and parts[1]['p'] == parts[0]['p'] + 1):
            continuation = next((line['t'] for line in pages[parts[1]['p']]['lines'][:5]
                                 if re.fullmatch(r'旅客列车[^。:：]{2,35}表', line['t'])), '')
            if continuation:
                entry['title'] += continuation
        if parent and any(support.get(p) in ['章节分隔页', '剪贴页分隔页', '全年总目录']
                          for p in range(parent['p'] + 1, candidate['p'])):
            parent = None
        if (entry['kind'] == '文件' and parent and entry['title'] != parent['title']
                and len(entry['title']) >= 6 and entry['title'] in parent['title']
                and re.search(r'批转|转发|印发|公布|发布', parent['title'])
                and not any(reference_line(line) for line in first_text.splitlines())):
            entry['kind'] = '附件'
            entry['attachmentLabel'] = '附件'
            entry['confidence'] = '文件与附文标题核对'
        if (entry['kind'] == '文件' and modification_title(entry['title'])
                and not entry['number']):
            entry['kind'] = '修改事项'
            entry['confidence'] = '独立修改事项'
        if (entry['kind'] == '文件' and parent and not entry['number'] and not entry.get('issuer')):
            previous = entries[-1]
            part = previous['parts'][-1]
            prior_page = pages[part['p']]
            tail = [line for line in prior_page['lines'] if part['a'] <= line['a'] < part['b']
                    and not line['t'].isdigit()][-6:]
            title = entry['title']
            referenced = any(re.search(r'附件.{0,16}' + re.escape(title),
                                       pages[p['p']]['t'][p['a']:p['b']]) for p in parent['parts'])
            if (part['p'] >= entry['p'] - 1 and signoff_date(tail, prior_page['w'])
                    and (referenced or re.match(r'^附[表录图]', title))):
                entry.update(kind='附件', attachmentLabel='附件', confidence='落款及附件标题识别')
        if entry['kind'] == '附件':
            attachment_parent = parent
            if not attachment_parent or attachment_parent['kind'] == '修改事项':
                # Occasionally an original PDF places a notice's last appendix among its inserts.
                # Recover its owner from the explicit appendix list, not just physical proximity.
                attachment_parent = next((prior for prior in reversed(entries) if prior['kind'] == '文件'
                    and any(entry['title'] in pages[part['p']]['t'][part['a']:part['b']]
                            and '附件' in pages[part['p']]['t'][part['a']:part['b']] for part in prior['parts'])), parent)
            if attachment_parent:
                entry['parentId'] = attachment_parent['id']
                entry['parentTitle'] = attachment_parent['title']
                attachment_parent.setdefault('attachments', []).append(entry['id'])
            else:
                warnings.append(dict(type='附件无前置文件', page=entry['p'] + 1, title=entry['title']))
        elif entry['kind'] in ['文件', '修改事项']:
            parent = entry
        elif entry['kind'] == '剪贴页':
            parent = None
        entry['topics'] = business_topics(entry['title'], entry['category'])
        if entry['kind'] == '附件' and attachment_parent and entry['topics'] == ['综合与运营']:
            entry['topics'] = attachment_parent.get('topics', [attachment_parent['topic']])
        entry['topic'] = entry['topics'][0]
        entries.append(entry)
    # Preserve every character; uncertain prefixes and whole pages remain explicitly searchable.
    occupied = collections.defaultdict(list)
    for entry in entries:
        for part in entry['parts']:
            occupied[part['p']].append((part['a'], part['b']))
    for i, page in enumerate(pages):
        if not page['t']:
            continue
        if i in support:
            entries.append(dict(id=f'{ident}-s{i}', p=i, a=0, title=support[i] + f' · PDF第{i + 1}页',
                                category='目录', topic='目录', kind='目录', confidence='辅助页', number='',
                                parts=[dict(p=i, a=0, b=len(page['t']))]))
            continue
        last = 0
        for start, finish in sorted(occupied[i]) + [(len(page['t']), len(page['t']))]:
            if start > last:
                fragment = page['t'][last:start]
                # Tiny page headers attach to the following item, not a separate search result.
                next_entry = next((entry for entry in entries if entry['p'] == i and entry['a'] == start), None)
                if next_entry and last == 0 and start <= 35:
                    next_entry['a'] = 0
                    next_entry['parts'][0]['a'] = 0
                else:
                    entries.append(dict(id=f'{ident}-u{i}-{last}', p=i, a=last,
                        title=f'原刊第{i + 1}页', category='综合与运营', topic='综合与运营', kind='待核对',
                        confidence='保留未识别内容', number='', parts=[dict(p=i, a=last, b=start)]))
                    if len(fragment) > 80:
                        warnings.append(dict(type='未识别边界', page=i + 1, title=fragment[:70]))
            last = max(last, finish)
    for entry in entries:
        if entry['kind'] == '文件':
            for part in reversed(entry['parts']):
                original = pages[part['p']]
                lines = [line for line in original['lines'] if part['a'] <= line['a'] < part['b']
                         and not line['t'].isdigit()]
                date = signoff_date(lines[-12:], original['w'])
                if date:
                    entry['date'] = date
                    break
        if entry['kind'] in ['文件', '修改事项', '附件'] and len(entry['parts']) > 40:
            warnings.append(dict(type='长文件', page=entry['p'] + 1, title=entry['title'], pages=len(entry['parts'])))
    for i, page in enumerate(pages):
        if len(page['t']) < 20 and page['images'] and i not in support:
            warnings.append(dict(type='图像页文字较少', page=i + 1, title=page['t'][:50]))
    return dict(id=ident, file=layout['file'], digest=layout['digest'], source='../' + Path(source).relative_to(Path(output).parent).as_posix(),
                year=year, issue=issue, issueOrder=issue_order, pages=len(pages),
                sizes=[[page['w'], page['h']] for page in pages], texts=[page['t'] for page in pages],
                labels=[page_label(page) for page in pages], entries=entries, warnings=warnings)


def norm(text):
    text = unicodedata.normalize('NFKC', text).replace('枟', '《').replace('枠', '》')
    text = ''.join('□' if ord(c) > 0xffff else c for c in text)
    return re.sub(r'\s+', '', text).replace('\x00', '').lower()


def fontname(text):
    try:
        return text.encode('latin1').decode('utf8')
    except (UnicodeError, ValueError):
        return text


def atomic_text(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(text, encoding='utf8', newline='\n')
    temporary.replace(path)


def writejs(path, prefix, data):
    atomic_text(path, prefix + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')


def storage_identity(source, output, digest):
    """The same filename and bytes have the same identity, with or without cache history."""
    base = hashlib.sha1(source.name.encode()).hexdigest()[:10]
    ident = base + '-' + digest[:12]
    folder = output / 'data' / ident
    legacy = output / 'data' / base
    folder.mkdir(parents=True, exist_ok=True)
    # Migrate generated caches without changing the still-published old index or images.
    if not (folder / 'layout.json.gz').exists() and (legacy / 'layout.json.gz').exists():
        with gzip.open(legacy / 'layout.json.gz', 'rt', encoding='utf8') as stream:
            prior = json.load(stream)
        if prior.get('digest') == digest:
            for path in sorted(legacy.iterdir()):
                target = folder / path.name
                if re.fullmatch(r'\d+\.webp', path.name) and not target.exists():
                    try:
                        os.link(path, target)
                    except OSError:
                        shutil.copyfile(path, target)
                elif re.fullmatch(r'\d+\.coords\.js', path.name):
                    text = path.read_text(encoding='utf8').replace(f'["{prior["id"]}:', f'["{ident}:', 1)
                    atomic_text(target, text)
            if (legacy / 'previews.json').exists():
                atomic_text(folder / 'previews.json', (legacy / 'previews.json').read_text(encoding='utf8'))
            prior['id'] = ident
            write_layout(folder / 'layout.json.gz', prior)
    atomic_text(folder / 'source.json', json.dumps(dict(digest=digest)))
    return ident, folder


def write_layout(path, layout):
    # Fixed gzip header: caches also remain byte-stable when rebuilt in the same environment.
    temporary = path.with_suffix('.tmp')
    encoded = json.dumps(layout, ensure_ascii=False, separators=(',', ':')).encode('utf8')
    with temporary.open('wb') as stream:
        with gzip.GzipFile(filename='', mode='wb', fileobj=stream, mtime=0) as compressed:
            compressed.write(encoded)
    temporary.replace(path)


def readpage(page, ignore_image_blocks=False):
    lines = []
    rotation = page.rotation_matrix if page.rotation else None
    flags = pymupdf.TEXTFLAGS_RAWDICT | pymupdf.TEXT_COLLECT_STYLES
    uncertain = bool(rotation)
    if ignore_image_blocks:
        flags &= ~pymupdf.TEXT_PRESERVE_IMAGES
    for block in page.get_text('rawdict', flags=flags)['blocks']:
        for line in block.get('lines', []):
            chars, fonts, sizes, special = [], [], [], ''
            uncertain |= abs(line['dir'][1]) > .02 or line['dir'][0] < .99
            for span in line['spans']:
                font = fontname(span['font'])
                fonts.append(font)
                sizes.append(span['size'])
                style = (int(bool(span['flags'] & 16 or bold_font({'fonts': font})))
                         | 2 * int(bool(span.get('char_flags', 0) & 2)))
                if 'KT' in font or '楷' in font:
                    special += ''.join(norm(c['c']) for c in span['chars'])
                for char in span['chars']:
                    box = char['bbox']
                    x0, y0, x1, y1 = pymupdf.Rect(box) * rotation if rotation else box
                    if x0 < 0 or x0 > page.rect.width or y0 < 0 or y0 > page.rect.height:
                        continue
                    value = char['c']
                    if 'Symbol' in font:
                        value = value.replace('畅', '.')
                    if 'EU-BZ' in font:
                        value = EU_GLYPHS.get(value, value)
                    if font.startswith(('E-BZ', 'E-HZ')) and value == '暋':
                        value = ''
                    for character in norm(value):
                        display_value=unicodedata.normalize('NFKC', value)
                        display_character=display_value if len(display_value)==1 and display_value.lower()==character else character
                        chars.append([character, round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2),
                                      display_character, style, round(span['size'], 2)])
            if chars:
                lines.append(dict(t=''.join(c[0] for c in chars), chars=chars,
                    y=min(c[2] for c in chars), bottom=max(c[4] for c in chars),
                    x=min(c[1] for c in chars), right=max(c[3] for c in chars),
                    baseline=(pymupdf.Point(line['spans'][0]['origin']) * rotation).y if rotation else line['spans'][0]['origin'][1], special=special,
                    size=round(max(sizes), 2), fonts=' '.join(dict.fromkeys(fonts))))
    lines.sort(key=lambda line: (round(line['baseline'] / 2) * 2, line['x']))
    merged = []
    for line in lines:
        if merged and abs(merged[-1]['baseline'] - line['baseline']) < 2 and line['x'] >= merged[-1]['x']:
            previous = merged[-1]
            previous['chars'] += line['chars']
            previous['t'] += line['t']
            previous['special'] += line['special']
            previous['fonts'] += ' ' + line['fonts']
            previous['bottom'] = max(previous['bottom'], line['bottom'])
            previous['right'] = max(previous['right'], line['right'])
            previous['size'] = max(previous['size'], line['size'])
        else:
            merged.append(line)
    chars = []
    styles = []
    for line in merged:
        if rotation:
            line['chars'].sort(key=lambda character: character[1])
            line['t'] = ''.join(character[0] for character in line['chars'])
        line['a'] = len(chars)
        chars += line.pop('chars')
        line['b'] = len(chars)
        for offset in range(line['a'], line['b']):
            style, size = chars[offset][6:]
            if not styles or styles[-1][1:] != [style, size]:
                styles.append([offset, style, size])
        line.pop('baseline')
    text = ''.join(c[0] for c in chars)
    top = ''.join(c[0] for c in sorted([c for c in chars if c[2] < 60], key=lambda c: c[1]))
    found = re.search(r'·([0-9]+(?:[—-][0-9]+)?)·', top)
    label = found[1] if found else ''
    if rotation:
        label = ''
        for line in merged:
            header = re.sub(r'\([^)]*\)', '', line['t'])
            number = re.fullmatch(r'·+(\d{1,4})·+', header)
            if number and line['y'] < page.rect.height * .13:
                label = number[1]
                break
    if not label and not rotation:
        label = next((line['t'] for line in reversed(merged) if line['y'] > page.rect.height * .91
                      and re.fullmatch(r'\d+(?:[—-]\d+)?', line['t'])), '')
    clip_label = re.search(r'》([0-9]+(?:[—-][0-9]+)?)页剪贴页', text[:240])
    if clip_label:
        label = clip_label[1]
    boxes = [[round(c[1] / page.rect.width * 100, 3), round(c[2] / page.rect.height * 100, 3),
              round((c[3] - c[1]) / page.rect.width * 100, 3), round((c[4] - c[2]) / page.rect.height * 100, 3)] for c in chars]
    return dict(w=round(page.rect.width, 2), h=round(page.rect.height, 2), t=text,
                lines=merged, label=label, rotated=bool(rotation), images=len(page.get_images()), display=''.join(c[5] for c in chars),
                styles=styles, uncertain=uncertain), boxes


def restore_gbk_cmaps(pdf):
    repaired = set()
    checked = set()
    for number in range(len(pdf)):
        for xref, _, _, _, _, encoding, *_ in pdf.get_page_fonts(number):
            if encoding != 'GBK-EUC-H' or xref in checked:
                continue
            checked.add(xref)
            kind, ref = pdf.xref_get_key(xref, 'ToUnicode')
            if kind != 'xref':
                continue
            cmap = pdf.xref_stream(int(ref.split()[0])) or b''
            # A map containing only a dummy mapping for code zero cannot decode GBK text.
            if (len(re.findall(rb'beginbf(?:char|range)', cmap)) == 1 and
                    re.search(rb'1\s+beginbfrange\s*<0+>\s*<0+>\s*<[0-9a-fA-F]+>\s*endbfrange', cmap)):
                pdf.xref_set_key(xref, 'ToUnicode', 'null')
                repaired.add(xref)
    return repaired


def extract_document(source, output):
    source, output = Path(source), Path(output)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    ident, folder = storage_identity(source, output, digest)
    cache = folder / 'layout.json.gz'
    if cache.exists():
        with gzip.open(cache, 'rt', encoding='utf8') as stream:
            saved = json.load(stream)
        if (saved.get('digest') == digest and saved.get('extract_version') == EXTRACT_VERSION
                and all((folder / f'{i + 1}.coords.js').exists() or (folder / f'{i + 1}.page.js').exists()
                        for i in range(len(saved['pages'])))):
            return saved
    pages = []
    pymupdf.TOOLS.mupdf_display_errors(False)
    pymupdf.TOOLS.mupdf_display_warnings(False)
    pymupdf.TOOLS.mupdf_warnings()
    with pymupdf.open(source) as pdf:
        repaired = restore_gbk_cmaps(pdf)
        changed_geometry = bool(repaired) or any(page.rotation for page in pdf)
        toc = [[level, title.encode('utf-16','surrogatepass').decode('utf-16','replace'), number] for level,title,number in pdf.get_toc()]
        for number, page in enumerate(pdf):
            layout, boxes = readpage(page, ignore_image_blocks=changed_geometry)
            pages.append(layout)
            writejs(folder / f'{number + 1}.coords.js',
                    f'window.PAGE_COORDS["{ident}:{number}"]=', boxes)
    result = dict(id=ident, file=source.name, digest=digest, extract_version=EXTRACT_VERSION,
                  toc=toc, pages=pages, fontWarnings=pymupdf.TOOLS.mupdf_warnings().encode('utf8','replace').decode('utf8'))
    write_layout(cache, result)
    return result


FORM_CAPTION = re.compile(
    r'客票样式$|^(?:客运记录|代用票|行李票|包裹票|(?:行李|包裹)交接单|列车编组顺序|'
    r'直通旅客列车编组顺序单|车辆使用费计算表|(?:机车)?车辆破损赔偿、代修理费用清算单|'
    r'代收款通知书|查询和要求订正书|直通旅客票退票月报(?:\(电子版\))?|'
    r'请求发车通知书|同意接车通知书|许可证)(?:第|附表|$)'
)
FIGURE_CAPTION = re.compile(r'^附图[一二三四五六七八九十0-9]+[:：]')


def visible_image_boxes(page):
    boxes = []
    for image in page.get_image_info():
        rect = pymupdf.Rect(image['bbox'])
        if page.rotation:
            rect = rect * page.rotation_matrix
        rect &= page.rect
        if min(rect.width, rect.height) < 2 or any(rect in box for box in boxes):
            continue
        boxes = [box for box in boxes if box not in rect]
        boxes.append(rect)
    # A diagram can be encoded as dozens of abutting strips rather than one image.
    for vertical in (True, False):
        def axes(rect):
            return (rect.x0, rect.x1, rect.y0, rect.y1) if vertical else (rect.y0, rect.y1, rect.x0, rect.x1)
        merged = []
        for rect in sorted(boxes, key=lambda box: (round(axes(box)[0]), round(axes(box)[1]), axes(box)[2])):
            if merged:
                left, right, _, end = axes(merged[-1])
                new_left, new_right, start, new_end = axes(rect)
                if (abs(left - new_left) < .8 and abs(right - new_right) < .8
                        and abs(start - end) < .8
                        and min(new_end - start, end - axes(merged[-1])[2]) * 4 < right - left):
                    merged[-1] |= rect
                    continue
            merged.append(rect)
        boxes = merged
    return boxes


def page_media(page, data, drawings, parts):
    """Embed each figure once and retain the layout where text depends on graphics."""
    regions = []
    ordered_parts = sorted(parts, key=lambda part: part['a']) or [dict(a=0, b=0)]
    all_lines = data['lines']
    figures = visible_image_boxes(page)
    symbol_lines = {}
    for rect in figures:
        if max(rect.width, rect.height) > 26:
            continue
        middle = (rect.y0 + rect.y1) / 2
        line = min(all_lines, key=lambda line: abs((line['y'] + line['bottom']) / 2 - middle), default=None)
        if line and line['y'] - 2 <= middle <= line['bottom'] + 2:
            symbol_lines.setdefault(line['a'], []).append(rect)

    def crop(lines, start, end, bounds=page.rect):
        if not lines:
            return bounds
        top = min(line['y'] for line in lines)
        bottom = max(line['bottom'] for line in lines)
        before = max((line['bottom'] for line in all_lines if line['b'] <= start), default=top - 5)
        after = min((line['y'] for line in all_lines if line['a'] >= end), default=bottom + 5)
        return pymupdf.Rect(bounds.x0, min(top, before), bounds.x1, max(bottom, after)) & bounds

    def add_layout(owner, start, end, rect):
        if not rect.is_empty:
            regions.append(('layout', owner, start, end, rect))

    for part in ordered_parts:
        start, end = part['a'], part['b']
        lines = [line for line in all_lines if line['b'] > start and line['a'] < end]
        caption = any(FORM_CAPTION.search(line['t']) for line in lines[:10])
        heading = ''.join(line['t'] for line in lines[:10])
        dense_fares = all(label in heading for label in ('全价', '代理费', '九广'))
        figure = next((line for line in lines if FIGURE_CAPTION.match(line['t'])), None)
        has_symbols = any(line['a'] in symbol_lines for line in lines)
        if page.rotation or (len(drawings) >= 3 and (caption or dense_fares or has_symbols)):
            add_layout(start, start, end, page.rect if len(ordered_parts) == 1 else crop(lines, start, end))
        elif figure and len(drawings) >= 3:
            lower = [line for line in lines if line['a'] >= figure['a']]
            add_layout(start, figure['a'], end, crop(lower, figure['a'], end))
        elif has_symbols:
            groups = []
            for i, line in enumerate(lines):
                if line['a'] in symbol_lines:
                    if groups and i == groups[-1][-1] + 1:
                        groups[-1].append(i)
                    else:
                        groups.append([i])
            for group in groups:
                selected = [lines[i] for i in group]
                a, b = max(start, selected[0]['a']), min(end, selected[-1]['b'])
                clip = crop(selected, a, b)
                for line in selected:
                    for rect in symbol_lines[line['a']]:
                        clip |= rect
                add_layout(start, a, b, clip & page.rect)

    for rect in figures:
        if any(rect in clip for _, _, _, _, clip in regions):
            continue
        if rect.get_area() >= page.rect.get_area() * .6 and not regions:
            for part in ordered_parts:
                lines = [line for line in all_lines if line['b'] > part['a'] and line['a'] < part['b']]
                clip = rect if len(ordered_parts) == 1 else crop(lines, part['a'], part['b'], rect)
                add_layout(part['a'], part['a'], part['b'], clip)
            continue
        before = next((line for line in reversed(all_lines) if line['y'] <= rect.y0 + 1), None)
        following = next((line['a'] for line in all_lines if line['y'] >= rect.y1), len(data['t']))
        owner_offset = before['a'] if before else following
        owner = next((part for part in ordered_parts if part['a'] <= owner_offset < part['b']), ordered_parts[-1])
        anchor = max(owner['a'], min(following, owner['b']))
        regions.append(('image', owner['a'], anchor, anchor, rect))
    markup = []
    for kind, owner, start, end, rect in sorted(regions, key=lambda region: (region[2], region[4].y0, region[4].x0)):
        scale = min(3, 1600 / max(rect.width, rect.height))
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=rect, alpha=False)
        if not pixmap.width or not pixmap.height:
            continue
        payload = base64.b64encode(pixmap.tobytes('png')).decode('ascii')
        markup.append(f'<img data-kind="{kind}" data-owner="{owner}" data-a="{start}" data-b="{end}" '
                      f'width="{pixmap.width}" height="{pixmap.height}" src="data:image/png;base64,{payload}">')
    return ''.join(markup)


def read_page_asset(path, key):
    """Return the raw coordinate JSON and page HTML from either generation."""
    raw = path.read_text(encoding='utf8')
    packed = f'window.PAGE_PACKED[{json.dumps(key)}]='
    if raw.startswith(packed):
        data = gzip.decompress(base64.b64decode(json.loads(raw[len(packed):].strip().removesuffix(';'))))
        coords, markup = data.decode('utf8').split('\n', 1)
        return coords, markup
    coords, markup = raw.split(';\n', 1)
    coords_prefix = f'window.PAGE_COORDS[{json.dumps(key)}]='
    html_prefix = f'window.PAGE_HTML[{json.dumps(key)}]='
    if not coords.startswith(coords_prefix) or not markup.startswith(html_prefix):
        raise ValueError(f'{path.name} 定位数据编号不符')
    return coords[len(coords_prefix):], json.loads(markup[len(html_prefix):].strip().removesuffix(';'))


def write_page_asset(path, key, coords, markup):
    data = (coords + '\n' + markup).encode('utf8')
    packed = base64.b64encode(gzip.compress(data, compresslevel=6, mtime=0)).decode('ascii')
    writejs(path, f'window.PAGE_PACKED[{json.dumps(key)}]=', packed)


def write_original_page(page, path):
    if not path.is_file():
        temporary = path.with_suffix('.webp.tmp')
        zoom = 1350 / max(page.rect.width, page.rect.height)
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        image = Image.frombytes('RGB', (pixmap.width, pixmap.height), pixmap.samples)
        image.save(temporary, 'WEBP', lossless=True, method=1)
        temporary.replace(path)


def render_document(source, output, layout=None):
    """Build selectable text, rules, coordinates and original-page images."""
    source, output = Path(source), Path(output)
    if layout is None:
        layout = extract_document(source, output)
    folder = output / 'data' / layout['id']
    spec = dict(digest=layout['digest'], format='html-text-7', pages=len(layout['pages']))
    manifest = folder / 'html.json'
    saved = json.loads(manifest.read_text()) if manifest.exists() else {}
    same_render = all(saved.get(key) == value for key, value in spec.items())
    reusable = same_render and saved.get('encoding') == 'gzip'
    spec['encoding'] = 'gzip'
    media_pages = set(saved.get('mediaPages', [])) if same_render else set()
    paths = [folder / f'{i+1}.page.js' for i in range(spec['pages'])]
    originals = [folder / f'{i+1}.original.webp' for i in range(spec['pages'])]
    complete = all(path.is_file() and original.is_file() for path, original in zip(paths, originals))
    if reusable and complete:
        return source.name, 0, 0
    started = time.monotonic()
    if same_render and complete:
        # A lossless migration can reuse every existing page without opening the PDF.
        for i, path in enumerate(paths):
            key = f'{layout["id"]}:{i}'
            coords, markup = read_page_asset(path, key)
            write_page_asset(path, key, coords, markup)
        atomic_text(manifest, json.dumps(dict(spec, mediaPages=sorted(media_pages))))
        return source.name, len(paths), round(time.monotonic() - started, 1)
    rendered=0
    with pymupdf.open(source) as pdf:
        for i, page in enumerate(pdf):
            write_original_page(page, originals[i])
            path = paths[i]
            key = f'{layout["id"]}:{i}'
            if same_render and path.is_file():
                if not reusable:
                    coords, markup = read_page_asset(path, key)
                    write_page_asset(path, key, coords, markup)
                continue
            rendered+=1
            data = layout['pages'][i]
            display=data.get('display')
            if display is None:
                display = readpage(page)[0]['display']
            if display.lower() != data['t']:
                display = data['t']
            coordfile=folder/f'{i+1}.coords.js'
            if coordfile.exists():
                coordinate_json = coordfile.read_text(encoding='utf8').split(';\n', 1)[0].split('=', 1)[1]
            else:
                coordinate_json, _ = read_page_asset(path, key)
            boxes = json.loads(coordinate_json)
            elements = []
            drawings = page.get_drawings() if not page.rotation else []
            source_only = (data['uncertain'] or not data['t'] or bool(page.get_image_info())
                           or bool(re.search(r'[\ue000-\uf8ff\ufffd]', display))
                           or any(kind == 'fill-shade' for kind, _ in page.get_bboxlog()))
            for drawing in drawings:
                commands = []
                for item in drawing['items']:
                    if item[0] == 'l':
                        a,b = item[1:3]
                        source_only |= min(abs(a.x - b.x), abs(a.y - b.y)) > .6
                        commands.append(f'M{a.x:.2f},{a.y:.2f}L{b.x:.2f},{b.y:.2f}')
                    elif item[0] == 're':
                        r=item[1]; commands.append(f'M{r.x0:.2f},{r.y0:.2f}h{r.width:.2f}v{r.height:.2f}h{-r.width:.2f}Z')
                    else:
                        source_only = True
                if commands:
                    elements.append('<path d="'+''.join(commands)+'" fill="none" stroke="#555" stroke-width="'+str(max(.2,drawing.get('width') or .3))+'"/>')
            styles = iter(data['styles'])
            next_style = next(styles, None)
            style, size = 0, 10
            for line in data['lines']:
                coords=boxes[line['a']:line['b']]
                runs=[]
                for position,box in enumerate(coords):
                    changed_style = next_style is not None and next_style[0] == line['a'] + position
                    if changed_style:
                        _, style, size = next_style
                        next_style = next(styles, None)
                    if runs:
                        previous=coords[runs[-1][2][-1]]
                        gap=(box[0]-previous[0]-previous[2])*data['w']/100
                        same_row=abs(box[1]-previous[1])*data['h']/100 < line['size']*.55
                    if not runs or changed_style or gap>line['size']*.35 or gap < -line['size']*.4 or not same_row:
                        runs.append((style, size, []))
                    runs[-1][2].append(position)
                for style, size, run in runs:
                    first,last=coords[run[0]],coords[run[-1]]
                    x=round(first[0]*data['w']/100,2)
                    y=round((first[1]+first[3]*.82)*data['h']/100,2)
                    width=round((last[0]+last[2]-first[0])*data['w']/100,2)
                    value=display[line['a']+run[0]:line['a']+run[-1]+1]
                    weight = 'bold' if style & 1 else 'normal'
                    underline = ' text-decoration="underline"' if style & 2 else ''
                    elements.append(f'<text x="{x}" y="{y}" data-line="{line["a"]}" textLength="{max(.1,width)}" font-size="{size}" font-weight="{weight}"{underline}>'+html.escape(value)+'</text>\n')
            fallback = ' data-source="true"' if source_only else ''
            svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {data["w"]} {data["h"]}" class="text-page"{fallback}>'+''.join(elements)+'</svg>'
            if source_only:
                media_pages.add(i)
            else:
                media_pages.discard(i)
            write_page_asset(path, key, coordinate_json, svg)
    atomic_text(manifest, json.dumps(dict(spec, mediaPages=sorted(media_pages))))
    return source.name, rendered, round(time.monotonic()-started,1)
