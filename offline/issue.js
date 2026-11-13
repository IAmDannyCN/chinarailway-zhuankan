'use strict';

let issueView = null;

function originalURL(document, number) {
  const path = (document.source || '../pdf/' + document.file).split('/').map(encodeURIComponent).join('/');
  return number == null ? path : path + '#page=' + (number + 1);
}

function issueSections(document, sourcePages = new Set()) {
  const pages = Array.from({length: document.pages}, () => []);
  for (const entry of document.entries) {
    for (const part of entry.parts) pages[part.p].push({entry, part});
  }
  const sections = [];
  const seen = new Set();
  pages.forEach((items, p) => {
    if (sourcePages.has(p) && items.length > 1) {
      items = [{entry: {id: `source-${p}`, p, a: 0, title: `PDF 第 ${p + 1} 页`, heading: false},
        part: {p, a: 0, b: document.texts[p].length}}];
    }
    if (!items.length) {
      items.push({entry: {id: `page-${p}`, p, a: 0, title: `PDF 第 ${p + 1} 页`, heading: false},
        part: {p, a: 0, b: document.texts[p].length}});
    }
    items.sort((a, b) => a.part.a - b.part.a);
    for (const {entry, part} of items) {
      const last = sections.at(-1);
      if (last?.id === entry.id) last.parts.push(part);
      else {
        sections.push({...entry, p, a: part.a, parts: [part], document,
          heading: entry.heading !== false && !seen.has(entry.id) && entry.kind !== '待核对'});
        seen.add(entry.id);
      }
    }
  });
  return sections;
}

function issueChapters(document, sections) {
  const rawBookmarks = (document.toc || []).map(([level,title,page])=>
    [level,title.replace(/\ufffd+/g,'').trim(),page]).filter(([, title]) => title);
  const bookmarks=rawBookmarks.filter(([,title])=>!/^.*\.(?:pdf|docx?|xls[x]?)$/i.test(title));
  if (bookmarks.some(([, , p]) => p > 0 && p <= document.pages)) {
    const bookmarkTitle = value => normalize(value).replace(/^(?:[一二三四五六七八九十百]+、|[0-9]+[.、])/, '')
      .replace(/\([^)]*\d[^)]*\)$/, '');
    return bookmarks.map(([level, title, number]) => {
      const p = number - 1;
      if (p < 0 || p >= document.pages) return {level, title};
      const key = bookmarkTitle(title);
      const matches = sections.filter(section => bookmarkTitle(section.title) === key);
      const entry = matches.find(section => section.parts.some(part => part.p === p)) ||
        matches.find(section => Math.abs(section.p - p) === 1);
      const offset = document.texts[p].indexOf(title.toLowerCase().replace(/\s+/g, ''));
      return {level, title, p, date: entry?.date, a: entry?.parts.find(part => part.p === p)?.a ?? Math.max(0, offset)};
    });
  }
  const chapters = sections.filter(section => section.heading)
    .map(section => ({level: section.parentId ? 2 : 1, title: section.title, date: section.date, p: section.p, a: section.a}));
  return chapters.length ? chapters : document.texts.map((_, p) =>
    ({level: 1, title: `PDF 第 ${p + 1} 页`, p, a: 0}));
}

function closeIssue() {
  issueView?.observer.disconnect();
  issueView = null;
  $('issueSidebar').hidden = true;
  $('searchSidebar').hidden = false;
  $('openIssueHere').hidden = false;
}

function openIssue(document, original = false) {
  closeIssue();
  const serial = ++renderSerial;
  readerDocument = document;
  selected = null;
  hits = [];
  hitIndex = -1;
  page = 0;
  $('issueSidebar').hidden = false;
  $('searchSidebar').hidden = true;
  $('openIssueHere').hidden = true;
  $('documentName').textContent = document.file;
  $('previewTitle').textContent = `${document.year} 年 · ${document.issue}`;
  $('pageStack').hidden = false;
  $('previewEmpty').hidden = true;
  $('pageStack').innerHTML = `<article class="reading-article issue-article"><header>
    <div class="article-meta">${escapeHtml(document.file)}</div>
    <h1>${document.year} 年 · ${escapeHtml(document.issue)}</h1></header></article>`;
  $('viewer').scrollTop = 0;
  updateZoom();
  const article = $('pageStack').firstElementChild;
  const sections = issueSections(document);
  const chapters = issueChapters(document, sections);
  const contents = $('issueContents');
  contents.style.setProperty('--chapter-page-digits', Math.max(3, String(document.pages).length));
  contents.innerHTML = chapters.map(({level, title, p, date}, index) => {
    const label = `<span>${escapeHtml(readingPunctuation(title))}${date ? '<time>' + escapeHtml(date) + '</time>' : ''}</span>`;
    const style = `style="--chapter-indent:${Math.min(6, Math.max(0, level - 1))}"`;
    return p == null ? `<div class="chapter-label" ${style}>${label}</div>` :
      `<button class="chapter-link" ${style} data-chapter="${index}">${label}<small>${p + 1}</small></button>`;
  }).join('');
  contents.scrollTop = 0;

  const displaySections = original ? document.texts.map((text, p) => ({
    id: `original-${p}`, p, a: 0, title: `PDF 第 ${p + 1} 页`, heading: false, document,
    parts: [{p, a: 0, b: text.length}]
  })) : document.originalPages ? issueSections(document, new Set(document.mediaPages)) : sections;
  const slots = displaySections.map(entry => {
    const node = window.document.createElement('div');
    node.className = 'issue-slot';
    node.style.minHeight = Math.max(36, entry.parts.reduce((height, part) =>
      height + (part.b - part.a) * .85, 0)) + 'px';
    article.append(node);
    return {entry, node};
  });
  const slotByNode = new Map(slots.map(slot => [slot.node, slot]));
  const byPage = Array.from({length: document.pages}, () => []);
  for (const slot of slots) {
    for (const part of slot.entry.parts) byPage[part.p].push({slot, part});
  }
  const observer = new IntersectionObserver(items => {
    for (const item of items) {
      if (item.isIntersecting) loadIssueSlot(view, slotByNode.get(item.target));
    }
  }, {root: $('viewer'), rootMargin: '600px 0px'});
  const orderedChapters = chapters.map((chapter, index) => ({...chapter, index}))
    .filter(chapter => chapter.p != null)
    .sort((a, b) => a.p - b.p || a.a - b.a || a.level - b.level);
  const view = {document, original, serial, chapters, orderedChapters, slots, byPage, observer, anchor: {p: 0}, jump: 0};
  issueView = view;
  for (const {node} of slots) observer.observe(node);
  updateReadingPosition();
}

function loadIssueSlot(view, slot) {
  if (issueView !== view) return;
  if (!slot.loading) {
    view.observer.unobserve(slot.node);
    slot.node.innerHTML = '<p class="article-loading">正在读取…</p>';
    slot.loading = renderReadingSection(slot.entry, view.serial, true, view.original).then(section => {
      if (!section || issueView !== view) return;
      const keepPosition = !view.pending && view.positionScroll === $('viewer').scrollTop;
      slot.node.replaceChildren(section);
      slot.node.style.minHeight = '';
      fitPositionedText(section);
      if (keepPosition) keepIssuePosition();
    }).catch(() => {
      if (issueView !== view) return;
      slot.node.style.minHeight = '';
      slot.node.innerHTML = '<p class="article-note">本段读取失败。</p>';
      const retry = window.document.createElement('button');
      retry.className = 'plain-button';
      retry.textContent = '重试';
      retry.onclick = () => {
        slot.node.replaceChildren();
        slot.loading = null;
        loadIssueSlot(view, slot);
      };
      slot.node.append(retry);
    });
  }
  return slot.loading;
}

function saveIssuePosition(view, node) {
  const viewer = $('viewer');
  view.positionNode = node;
  view.positionY = node.getBoundingClientRect().top - viewer.getBoundingClientRect().top;
  view.positionScroll = viewer.scrollTop;
}

function keepIssuePosition() {
  const view = issueView;
  if (!view || view.pending || !view.positionNode?.isConnected) return;
  const viewer = $('viewer');
  const y = Math.min(view.positionY, Math.max(24, viewer.clientHeight - 32));
  viewer.scrollTop += view.positionNode.getBoundingClientRect().top -
    viewer.getBoundingClientRect().top - y;
  saveIssuePosition(view, view.positionNode);
}

function markIssueChapter(view, target, reveal = false) {
  const chapter = target.chapter ?? view.orderedChapters.findLast(item =>
    item.p < target.p || (item.p === target.p && item.a <= (target.a ?? 0)))?.index;
  const contents = $('issueContents');
  const active = contents.querySelector('[aria-current]');
  const button = chapter == null ? null : contents.querySelector(`[data-chapter="${chapter}"]`);
  if (active !== button) {
    active?.removeAttribute('aria-current');
    button?.setAttribute('aria-current', 'location');
  }
  if (!button || !reveal) return;
  const bounds = contents.getBoundingClientRect();
  const row = button.getBoundingClientRect();
  if (row.top < bounds.top || row.bottom > bounds.bottom) {
    contents.scrollTop += row.top - bounds.top - (contents.clientHeight - row.height) / 2;
  }
}

async function jumpInIssue(target, revealChapter = true) {
  const view = issueView;
  const p = Math.max(0, Math.min(view.document.pages - 1, target.p ?? 0));
  const candidates = view.byPage[p];
  const match = candidates.find(({part}) => target.a >= part.a && target.a < part.b) || candidates[0];
  if (!match) return;
  const {slot} = match;
  const jump = ++view.jump;
  view.pending = true;
  view.anchor = {...target, p};
  page = p;
  if (target.start) $('viewer').scrollTop = 0;
  else scrollReaderTo(slot.node);
  updateReadingPosition();
  await loadIssueSlot(view, slot);
  if (issueView !== view || jump !== view.jump) return;
  const anchors = [...slot.node.querySelectorAll(`[data-page="${p}"][data-offset]`)]
    .filter(node => target.match || !node.closest('details:not([open])'));
  // Locate the text span that contains the source offset, including a highlighted run.
  const exact = target.a == null ? null : anchors.find(node =>
    Number(node.dataset.offset) === target.a && (target.match ? node.tagName === 'MARK' : true));
  const containing = target.a == null ? null : anchors.find(node => {
    const start = Number(node.dataset.offset);
    return node.tagName !== 'H2' && start <= target.a && target.a < start + node.textContent.length;
  });
  const nearest = target.a == null ? anchors[0] : anchors.reduce((best, node) =>
    !best || Math.abs(Number(node.dataset.offset) - target.a) <
      Math.abs(Number(best.dataset.offset) - target.a) ? node : best, null);
  const anchor = exact || containing || nearest || slot.node;
  const details = anchor.closest('details');
  if (target.match && details) details.open = true;
  if (target.start) $('viewer').scrollTop = 0;
  else if (target.y != null) {
    const viewer = $('viewer');
    viewer.scrollTop += anchor.getBoundingClientRect().top - viewer.getBoundingClientRect().top - target.y;
  } else scrollReaderTo(anchor, target.match);
  saveIssuePosition(view, target.start ? $('pageStack').querySelector('header') : anchor);
  view.pending = false;
  $('previewTitle').textContent = readingPunctuation(slot.entry.title);
  markIssueChapter(view, view.anchor, revealChapter);
  updateReadingPosition();
}

function syncIssuePosition() {
  const view = issueView;
  if (view.pending) return;
  if (view.positionScroll === $('viewer').scrollTop) return;
  const top = $('viewer').getBoundingClientRect().top;
  let low = 0, high = view.slots.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (view.slots[mid].node.getBoundingClientRect().bottom <= top + 24) low = mid + 1;
    else high = mid;
  }
  const slot = view.slots[low];
  if (!slot) return;
  const node = [...slot.node.querySelectorAll('span[data-page], h2[data-page], p[data-page], figure[data-page]')]
    .find(anchor => anchor.getBoundingClientRect().bottom > top + 24);
  if (!node && view.byPage[page]?.some(item => item.slot === slot)) {
    saveIssuePosition(view, slot.node);
    return;
  }
  page = node ? Number(node.dataset.page) : slot.entry.p;
  view.anchor = node ? {p: page, a: Number(node.dataset.offset), y: node.getBoundingClientRect().top - top} : {p: page};
  saveIssuePosition(view, node || slot.node);
  markIssueChapter(view, view.anchor);
  $('previewTitle').textContent = readingPunctuation(slot.entry.title);
  updateReadingPosition();
}
