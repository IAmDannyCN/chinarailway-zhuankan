'use strict';

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));
const normalize = text => text.normalize('NFKC')
  .replace(/\s+/g, '')
  .replace(/[［【〔]/g, '[')
  .replace(/[］】〕]/g, ']')
  .replace(/（/g, '(')
  .replace(/）/g, ')')
  .toLowerCase();

window.PAGE_COORDS = {};
window.PAGE_HTML = {};
window.PAGE_PACKED = {};
const catalog = window.CATALOG || {docs: []};
const coordinateRequests = {};
const entries = catalog.docs.flatMap(document => document.entries.map(entry => ({
  ...entry,
  document,
  searchTitle: normalize(entry.title + (entry.parentTitle || '') + (entry.number || '')),
  searchParts: entry.parts.map(part => ({
    ...part,
    text: normalize(document.texts[part.p].slice(part.a, part.b))
  }))
})));

let terms = [];
let results = [];
let visibleLimit = 80;
let selected = null;
let page = 0;
let hits = [];
let hitIndex = -1;
let renderSerial = 0;
let zoomMode = 'fit';
let zoomScale = 1;
let toastTimer;
let readerDocument = null;
let scrollFrame;
const coordinateOrder = [];

const years = [...new Set(catalog.docs.map(document => document.year))].sort((a, b) => a - b);
for (const id of ['yearFrom', 'yearTo']) {
  for (const year of years) $(id).add(new Option(`${year} 年`, year));
}
for (const topic of [...new Set(entries.flatMap(entry => entry.topics || [entry.topic]))].sort()) {
  if (topic !== '目录') $('topic').add(new Option(topic, topic));
}
for (const document of [...catalog.docs].reverse()) {
  const duplicates = catalog.docs.filter(other => other.year === document.year && other.issue === document.issue).length > 1;
  $('volume').add(new Option(`${document.year} 年 · ${document.issue}${duplicates ? ' · ' + document.file : ''}`, document.id));
}
$('volumeCount').textContent = catalog.docs.length;
$('reportLink').hidden = !catalog.docs.length;
$('scopeList').innerHTML = [...catalog.docs].reverse().map(document => `
  <div class="scope-row">
    <span>${document.year} 年 · ${escapeHtml(document.issue)}<small>${escapeHtml(document.file)}</small></span>
    <span class="scope-actions"><button class="plain-button" data-issue="${escapeHtml(document.id)}">查看本期</button>
      <a class="plain-button" href="${escapeHtml(originalURL(document))}" target="_blank" rel="noopener">打开原件</a></span>
  </div>`).join('') || '<div class="empty">尚未导入专刊</div>';
$('collectionStats').textContent = `${years.length ? years[0] + '—' + years.at(-1) + ' 年 · ' : ''}${catalog.docs.length} 份专刊 · ${catalog.docs.reduce((total, document) => total + document.pages, 0)} 页`;

function highlighted(text) {
  if (!terms.length) return escapeHtml(text);
  // Normalization can expand punctuation, so retain each character's source range.
  let normalized = '';
  let sourceOffset = 0;
  const sourceRanges = [];
  for (const character of text) {
    const value = normalize(character);
    normalized += value;
    for (let index = 0; index < value.length; index++) {
      sourceRanges.push([sourceOffset, sourceOffset + character.length]);
    }
    sourceOffset += character.length;
  }
  const intervals = [];
  for (const term of terms) {
    let position = 0;
    while ((position = normalized.indexOf(term, position)) >= 0) {
      intervals.push([sourceRanges[position][0], sourceRanges[position + term.length - 1][1]]);
      position += term.length;
    }
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of intervals) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  let output = '';
  let previousEnd = 0;
  for (const [start, end] of merged) {
    output += escapeHtml(text.slice(previousEnd, start));
    output += `<mark>${escapeHtml(text.slice(start, end))}</mark>`;
    previousEnd = end;
  }
  return output + escapeHtml(text.slice(previousEnd));
}

function search(route = {}) {
  terms = [...new Set($('query').value.trim().split(/\s+/).map(normalize).filter(Boolean))];
  visibleLimit = route.visibleLimit || 80;
  results = [];
  const sourceMode = $('searchMode').value === 'pdf';
  const candidates = sourceMode ? pdfSearchPages() : entries;
  for (const entry of candidates) {
    if ($('yearFrom').value && entry.document.year < Number($('yearFrom').value)) continue;
    if ($('yearTo').value && entry.document.year > Number($('yearTo').value)) continue;
    if ($('volume').value && entry.document.id !== $('volume').value) continue;
    if (!sourceMode && $('topic').value && !(entry.topics || [entry.topic]).includes($('topic').value)) continue;
    if (!sourceMode && ($('kind').value ? entry.kind !== $('kind').value : entry.kind === '目录')) continue;
    if (!terms.every(term => entry.searchTitle.includes(term) || entry.searchParts.some(part => part.text.includes(term)))) continue;
    const matchedParts = entry.searchParts.filter(part => terms.some(term => part.text.includes(term)));
    let count = 0;
    for (const part of matchedParts) {
      for (const term of terms) count += part.text.split(term).length - 1;
    }
    const score = terms.reduce((total, term) => total + (entry.searchTitle.includes(term) ? 20 : 0), 0)
      + Math.min(count, 10);
    results.push({ entry, matchedParts, count, score });
  }
  const order = $('sort').value;
  results.sort((a, b) => (order === 'relevance' ? b.score - a.score : 0)
    || (order === 'old' ? a.entry.document.year - b.entry.document.year : b.entry.document.year - a.entry.document.year)
    || (b.entry.document.issueOrder || 0) - (a.entry.document.issueOrder || 0)
    || a.entry.p - b.entry.p || a.entry.a - b.entry.a);
  $('count').textContent = results.length;
  updateFilterCount();
  renderResults();
  $('results').scrollTop = route.resultScroll || 0;
  const entry = route.entry && (sourceMode ? results.find(item => item.entry.id === route.entry)?.entry
    : entries.find(item => item.id === route.entry));
  if (entry || results.length) selectEntry(entry?.id || results[0].entry.id, route.page, route.readerScroll, route.hitIndex);
  else clearPreview();
}

function* pdfSearchPages() {
  if (!terms.length) return;
  for (const document of catalog.docs) {
    if (!document.originalPages || $('volume').value && document.id !== $('volume').value ||
        $('yearFrom').value && document.year < Number($('yearFrom').value) ||
        $('yearTo').value && document.year > Number($('yearTo').value)) continue;
    for (const [p, original] of document.texts.entries()) {
      const text = normalize(original);
      if (!terms.every(term => text.includes(term))) continue;
      const part = {p, a: 0, b: original.length};
      yield {id: `${document.id}-pdf-${p}`, p, a: 0, parts: [part], searchParts: [{...part, text}],
        title: `PDF 第 ${p + 1} 页`, kind: '原版面', searchTitle: '', confidence: 'PDF 原页检索',
        document, sourcePage: true, heading: false};
    }
  }
}

function renderResults() {
  const shown=results.slice(0,visibleLimit), groups=new Map();
  for(const result of shown) {
    const e=result.entry, key=e.parentId || e.id;
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(result);
  }
  const ordered=[];
  for(const [key,items] of groups) {
    const parent=items.find(r=>r.entry.id===key);
    if(parent) ordered.push(parent);
    else { const e=entries.find(e=>e.id===key); if(e) ordered.push({entry:e,matchedParts:[],count:0,context:true}); }
    ordered.push(...items.filter(r=>r!==parent));
  }
  const cards = ordered.map(result => {
    const entry = result.entry;
    const part = result.matchedParts[0] || entry.searchParts[0];
    const pageNumber = part?.p ?? entry.p;
    let snippet = '';
    let offset = part?.a ?? entry.a ?? 0;
    let match = false;
    if (terms.length && part) {
      const positions = terms.map(term => part.text.indexOf(term)).filter(position => position >= 0);
      const firstPosition = positions.length ? Math.min(...positions) : 0;
      match = positions.length > 0;
      if (match) {
        const original = entry.document.texts[pageNumber].slice(part.a, part.b);
        let normalizedLength = 0;
        for (const character of original) {
          normalizedLength += normalize(character).length;
          if (normalizedLength > firstPosition) break;
          offset += character.length;
        }
      }
      const start = Math.max(0, firstPosition - 20);
      snippet = (start ? '…' : '') + part.text.slice(start, start + 120)
        + (part.text.length > start + 120 ? '…' : '');
    }
    const originalPage = entry.document.labels[pageNumber];
    const location = `PDF ${pageNumber + 1}${originalPage ? ' · 原刊 ' + originalPage : ''}`;
    const matches = terms.length ? (result.count ? `${result.count} 处` : '标题匹配') : `${new Set(entry.parts.map(part => part.p)).size} 页`;
    return `<div class="result-card${entry.parentId ? ' attachment-child' : ''}"><button class="result${selected?.id === entry.id ? ' active' : ''}"
      data-id="${entry.id}" aria-pressed="${selected?.id === entry.id}" title="${escapeHtml(entry.confidence)}">
      <div class="result-top"><span>${entry.document.year} 年 · ${escapeHtml(entry.document.issue)}</span><span class="result-type">${escapeHtml(entry.kind === '待核对' ? '按页收录' : entry.kind)}</span></div>
      <h3>${highlighted(entry.title)}</h3>

      ${entry.number ? `<div class="document-number">${highlighted(entry.number)}</div>` : ''}
      ${snippet ? `<p class="snippet">${highlighted(snippet)}</p>` : ''}
    </button>
    <div class="result-source">
      <button class="source-jump" data-issue="${entry.document.id}" data-page="${pageNumber}" data-offset="${offset}"
        data-match="${match}" data-original="${!!entry.sourcePage}" title="在整期中查看">${escapeHtml(entry.document.file)}<small>${escapeHtml(location)}</small></button>
      <span>${matches}</span>
    </div></div>`;
  });
  $('results').innerHTML=[...groups.keys()].map(key=>{
    const parentIndex=ordered.findIndex(r=>r.entry.id===key);
    const children=ordered.map((r,i)=>r.entry.parentId===key ? cards[i] : '').join('');
    return `<section class="entry-family">${parentIndex>=0 ? cards[parentIndex] : ''}${children ? `<div class="attachment-children" role="group" aria-label="附件">${children}</div>` : ''}</section>`;
  }).join('');
  if (!results.length) {
    $('results').innerHTML = catalog.docs.length
      ? '<div class="empty"><strong>无匹配结果</strong><p>请调整关键词或筛选条件。</p></div>'
      : '<div class="empty"><strong>尚未导入专刊</strong><p>放入 PDF 后运行更新工具。</p></div>';
  }
  if (results.length > visibleLimit) {
    const button = document.createElement('button');
    button.className = 'loadmore';
    button.textContent = '加载更多';
    button.onclick = () => { visibleLimit += 80; renderResults(); };
    $('results').append(button);
  }
}

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2500);
}

async function copySource() {
  if (!readerDocument) return;
  const document = readerDocument;
  const current = document.entries.find(entry => entry.title === $('previewTitle').textContent &&
    entry.parts.some(part => part.p === page)) || selected;
  const source = `《铁路客货运输专刊》${document.year}年${document.issue}，${current ? current.title + (current.number ? '，' + current.number : '') + '，' : ''}PDF第${page + 1}页${document.labels[page] ? '（原刊第' + document.labels[page] + '页）' : ''}。文件：${document.file}`;
  try {
    await navigator.clipboard.writeText(source);
    toast('出处已复制');
  } catch {
    const input = window.document.createElement('textarea');
    input.value = source;
    window.document.body.append(input);
    input.select();
    const copied = window.document.execCommand('copy');
    input.remove();
    toast(copied ? '出处已复制' : '复制失败');
  }
}

$('searchForm').onsubmit = event => { event.preventDefault(); navigateSearch(); };
for (const id of ['yearFrom', 'yearTo', 'topic', 'kind', 'volume', 'sort', 'searchMode']) $(id).onchange = navigateSearch;
$('results').onclick = event => {
  const source = event.target.closest('[data-issue]');
  if (source) {
    navigateIssue(source.dataset.issue, {p: Number(source.dataset.page), a: Number(source.dataset.offset),
      match: source.dataset.match === 'true'}, true, source.dataset.original === 'true');
    return;
  }
  const button = event.target.closest('[data-id]');
  if (button) navigateEntry(button.dataset.id);
};
$('reset').onclick = () => {
  for (const id of ['yearFrom', 'yearTo', 'topic', 'kind', 'volume', 'searchMode']) $(id).value = '';
  navigateSearch();
};
$('query').addEventListener('search', () => { if (!$('query').value) navigateSearch(); });
$('prevPage').onclick = () => goToPage(page);
$('nextPage').onclick = () => goToPage(page + 2);
$('pageInput').onchange = () => goToPage($('pageInput').value);
$('pageInput').onkeydown = event => {
  if (event.key === 'Enter') { event.preventDefault(); goToPage($('pageInput').value); }
};
$('prevHit').onclick = () => stepHit(-1);
$('nextHit').onclick = () => stepHit(1);
$('zoomIn').onclick = () => stepZoom(1);
$('zoomOut').onclick = () => stepZoom(-1);
$('zoomSelect').onchange = () => {
  zoomMode = $('zoomSelect').value === 'fit' ? 'fit' : 'manual';
  if (zoomMode === 'manual') zoomScale = Number($('zoomSelect').value);
  updateZoom();
};
$('copySource').onclick = copySource;
$('about').onclick = toggleShelf;
$('closeDialog').onclick = toggleShelf;
$('scopeDialog').addEventListener('cancel', event => {
  event.preventDefault();
  toggleShelf();
});
$('scopeDialog').onclick = event => {
  if (event.target !== $('scopeDialog')) return;
  const bounds = $('scopeDialog').getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) toggleShelf();
};
$('scopeList').onclick = event => {
  const button = event.target.closest('button[data-issue]');
  if (button) navigateIssue(button.dataset.issue);
};
$('issueContents').onclick = event => {
  const button = event.target.closest('[data-chapter]');
  if (!button || !issueView) return;
  const chapter = Number(button.dataset.chapter);
  const {p, a} = issueView.chapters[chapter];
  navigateIssue(issueView.document.id, {p, a, chapter});
};
$('backView').onclick = () => history.back();
$('openIssueHere').onclick = () => {
  if (!readerDocument || issueView) return;
  const hit = hits[hitIndex];
  const visible = [...$('pageStack').querySelectorAll(`span[data-page="${page}"]`)]
    .find(node => node.getBoundingClientRect().bottom > $('viewer').getBoundingClientRect().top + 24);
  navigateIssue(readerDocument.id, {p: page, a: visible ? Number(visible.dataset.offset) : hit?.p === page ? hit.a : 0,
    match: !!selected?.sourcePage && hit?.p === page}, true, !!selected?.sourcePage);
};
$('printedPage').onclick = $('openIssueHere').onclick;
function updateFilterCount() {
  const original = $('searchMode').value === 'pdf';
  for (const id of ['topic', 'kind']) $(id).disabled = original;
  const count = ['yearFrom', 'yearTo', 'topic', 'kind', 'volume', 'searchMode'].filter(id => !$(id).disabled && $(id).value).length;
  $('filterCount').textContent = count;
  $('filterCount').hidden = !count;
}
function positionFilters() {
  const button = $('filterToggle').getBoundingClientRect();
  const width = Math.min(370, window.innerWidth - 24);
  $('filterPanel').style.left = Math.max(12, Math.min(button.right - width, window.innerWidth - width - 12)) + 'px';
  $('filterPanel').style.top = button.bottom + 8 + 'px';
}
function closeFilters() {
  $('filterPanel').hidden = true;
  $('filterToggle').setAttribute('aria-expanded', 'false');
}
$('filterToggle').onclick = () => {
  const open = $('filterPanel').hidden;
  $('filterPanel').hidden = !open;
  $('filterToggle').setAttribute('aria-expanded', String(open));
  if (open) positionFilters();
};
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.filter-anchor')) closeFilters();
});
window.addEventListener('resize', () => {
  if (!$('filterPanel').hidden) positionFilters();
  keepIssuePosition();
});
$('viewer').addEventListener('scroll', () => {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(syncScrollPosition);
}, { passive: true });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('filterPanel').hidden) {
    closeFilters(); $('filterToggle').focus({ preventScroll: true }); return;
  }
  if ($('scopeDialog').open) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    $('query').focus();
    $('query').select();
    return;
  }
  if (/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) return;
  if (event.key === '/') { event.preventDefault(); $('query').focus(); }
  if (event.key === 'Enter' && hits.length) { event.preventDefault(); stepHit(event.shiftKey ? -1 : 1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); goToPage(page); }
  if (event.key === 'ArrowRight') { event.preventDefault(); goToPage(page + 2); }
});
initializeNavigation();
