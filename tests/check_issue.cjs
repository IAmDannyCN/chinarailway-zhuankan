'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = __dirname + '/../offline/';
const catalogue = JSON.parse(fs.readFileSync(root + 'data/index.js', 'utf8')
  .replace(/^window.CATALOG=/, '').replace(/;\s*$/, ''));
const {issueSections, issueChapters} = new Function('normalize',
  fs.readFileSync(root + 'issue.js', 'utf8') + ';return {issueSections, issueChapters};'
)(value => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ''));
let withBookmarks = 0;
let generated = 0;
for (const doc of catalogue.docs) {
  const sections = issueSections(doc);
  const position = doc.texts.map(() => 0);
  let priorPage = 0;
  for (const section of sections) {
    for (const part of section.parts) {
      assert(part.p >= priorPage, doc.file);
      assert.equal(part.a, position[part.p], doc.file);
      position[part.p] = part.b;
      priorPage = part.p;
    }
  }
  assert.deepEqual(position, doc.texts.map(text => text.length), doc.file);
  const chapters = issueChapters(doc, sections);
  const usableBookmarks=(doc.toc||[]).filter(([,title])=>!/^.*\.(?:pdf|docx?|xls[x]?)$/i.test(title.replace(/\ufffd+/g,'').trim()));
  if (usableBookmarks.some(([, , p]) => p > 0 && p <= doc.pages)) {
    assert.deepEqual(chapters.map(item => [item.level, item.title]), usableBookmarks
      .filter(([, title]) => title.replace(/\ufffd+/g,'').trim()).map(([level, title]) => [level, title.replace(/\ufffd+/g,'').trim()]), doc.file);
    withBookmarks++;
  } else {
    assert(chapters.length, doc.file);
    generated++;
  }
  assert(chapters.every(item => item.p == null || item.p < doc.pages), doc.file);
}
console.log(`通过：${catalogue.docs.length} 期全文范围及阅读顺序，${withBookmarks} 期沿用 PDF 书签，${generated} 期生成目录。`);

// Exercise the normal route functions against a history stack with real popstate semantics.
const nodes = new Map();
function element(id) {
  if (!nodes.has(id)) nodes.set(id, {value: '', scrollTop: 0, open: false,
    showModal() { this.open = true; }, close() { this.open = false; }});
  return nodes.get(id);
}
const doc = {id: 'sample'};
let cursor = 0;
const stack = [null];
const events = [];
let onPop;
const history = {
  get state() { return stack[cursor]; },
  replaceState(state) { stack[cursor] = structuredClone(state); },
  pushState(state) { stack.splice(++cursor, Infinity, structuredClone(state)); },
  back() { onPop({state: stack[--cursor]}); },
  forward() { onPop({state: stack[++cursor]}); }
};
const context = vm.createContext({
  $: element, history, catalog: {docs: [doc]}, issueView: null, terms: [], selected: null,
  page: 0, visibleLimit: 80, hitIndex: -1,
  window: {addEventListener(type, listener) { assert.equal(type, 'popstate'); onPop = listener; }},
  closeIssue() { context.issueView = null; },
  search(route) { events.push(['search', route]); context.selected = {id: route.entry || 'entry'};
    context.terms = ['北京']; context.page = route.page ?? 0; },
  openIssue(document) { events.push(['open', document]); context.issueView = {document, anchor: {p: 0}}; },
  jumpInIssue(target) { events.push(['jump', target]); context.issueView.anchor = target; }
});
vm.runInContext(fs.readFileSync(root + 'navigation.js', 'utf8'), context);
element('query').value = '北京';
context.initializeNavigation();
element('results').scrollTop = 85;
element('viewer').scrollTop = 120;
context.toggleShelf();
assert(element('scopeDialog').open);
assert.equal(events.length, 1, 'Opening the shelf keeps the current search preview');
element('scopeList').scrollTop = 200;
context.navigateIssue('sample');
assert(!element('scopeDialog').open);
assert.equal(events.at(-1)[1].p, 0);
context.navigateIssue('sample', {p: 8, a: 44, chapter: 3});
assert.equal(events.at(-1)[1].a, 44);
assert.equal(events.filter(([type]) => type === 'open').length, 1);
history.back();
assert.equal(events.at(-1)[1].p, 0);
history.back();
assert(element('scopeDialog').open);
assert.equal(element('scopeList').scrollTop, 200);
assert.equal(events.at(-1)[1].entry, 'entry');
assert.equal(events.at(-1)[1].resultScroll, 85);
assert.equal(events.at(-1)[1].readerScroll, 120);
context.toggleShelf();
assert(!element('scopeDialog').open);
history.forward();
assert(element('scopeDialog').open);
history.forward();
history.forward();
assert.equal(events.at(-1)[1].p, 8);
history.back();
history.back();
history.back();
context.navigateIssue('sample', {p: 2, a: 93, match: true}, true);
assert.equal(events.at(-1)[1].a, 93);
assert.equal(context.terms.join(), '北京');
history.back();
assert.equal(element('query').value, '北京');
assert.equal(events.at(-1)[1].entry, 'entry');
console.log('通过：专刊列表、全文、章节跳转及搜索出处的后退和前进，原搜索位置恢复。');
