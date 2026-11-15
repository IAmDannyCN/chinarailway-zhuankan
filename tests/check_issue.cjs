'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = __dirname + '/../offline/';
const catalogue = JSON.parse(fs.readFileSync(root + 'data/index.js', 'utf8')
  .replace(/^window.CATALOG=/, '').replace(/;\s*$/, ''));
const {issueSections,issueChapters,issueDateISO,issueChapterEntry,issueChapterLabel,originalURL} = new Function('normalize','escapeHtml','readingPunctuation',
  fs.readFileSync(root + 'issue.js', 'utf8') + ';return {issueSections,issueChapters,issueDateISO,issueChapterEntry,issueChapterLabel,originalURL};'
)(value => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ''),
  value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),value=>value);

assert.equal(issueDateISO('一九五一年十月五日'),'1951-10-05');
assert.equal(issueDateISO('二○一五年九月二十五日'),'2015-09-25');
assert.equal(issueDateISO('二〇二四年二月二十九日'),'2024-02-29');
assert.equal(issueDateISO('（２０２２年６月１４日）'),'2022-06-14');
assert.equal(issueDateISO('二O一七年十二月廿八日'),'2017-12-28');
assert.equal(issueDateISO('2025/12/3'),'2025-12-03');
assert.equal(issueDateISO('二〇二三年二月二十九日'),'');
assert.equal(issueDateISO('2025年13月1日'),'');
assert.equal(issueDateISO('2025年1月'),'');
assert.equal(issueDateISO(''),'');

const documentEntry={id:'notice',p:1,a:12,title:'关于调整货物运价的通知',kind:'文件',number:'铁运电〔2025〕106号',date:'二〇二五年十二月三日',parts:[{p:1,a:12,b:60}]};
const attachment={id:'attachment',p:2,a:8,title:'德大线客运运价里程表',kind:'附件',parentId:'notice',number:'',parts:[{p:2,a:8,b:60}]};
const sample={pages:4,texts:['封面','通知正文','里程表正文','其他文件'],entries:[documentEntry,attachment],toc:
 [[1,'货运管理',-1],[2,'1.关于调整货物运价的通知',2],[3,'附件1：德大线客运运价里程表黄河涯—东营南',3]]};
const matched=issueChapters(sample,issueSections(sample));
assert.deepEqual(matched.map(ch=>[ch.level,ch.p]),[[1,undefined],[2,1],[3,2]],'PDF目录层级和原目标页不变');
assert.equal(matched[1].number,documentEntry.number);
assert.equal(matched[1].date,'2025-12-03');
assert.equal(matched[1].a,12);
assert.equal(matched[2].title,attachment.title,'附件优先用正文核准的正式题名，不带书签中的首末站');
assert.equal(matched[2].number,'','附件不冒用父文件文号');
assert.equal(issueChapterEntry(sample,'附件1：德大线客运运价里程表黄河涯站—东营南站及相关联络线范围',2)?.title,attachment.title,
 '同页附件的首末站附注很长时仍沿用清理后的正式题名');
assert.equal(matched[0].date,undefined,'章节分组不套用同页文件的日期');
assert.equal(issueChapterEntry(sample,'无关通知',1),null,'仅同页但题名无关不得继承元数据');
const omittedGlyph={...sample,entries:[{...documentEntry,title:'关于回空器的容积计算'}]};
assert.equal(issueChapterEntry(omittedGlyph,'四、关于回空容器的容积计算',1)?.number,documentEntry.number,
 '同页标题仅缺一个提取字时仍识别文号日期');
assert.equal(issueChapterEntry(omittedGlyph,'四、关于回空容器的容积计算',0),null,
 '缺字近似匹配不能跨到相邻页的别篇文件');
const nearby=issueChapters({...sample,toc:[[1,documentEntry.title,1]]},issueSections(sample));
assert.equal(nearby[0].p,0,'书签偏一页时仍保留PDF自身目标页');
assert.equal(nearby[0].number,documentEntry.number,'偏一页的可靠同题名书签也显示文号');
const generatedChapters=issueChapters({...sample,toc:[]},issueSections(sample));
assert.equal(generatedChapters.find(ch=>ch.title===documentEntry.title).date,'2025-12-03');
assert.equal(generatedChapters.find(ch=>ch.title===documentEntry.title).number,documentEntry.number);
const label=issueChapterLabel({title:'<标题>',number:'铁运电〔2025〕106号',date:'2025-12-03'});
assert(label.includes('&lt;标题>'));
assert(label.includes('class="chapter-number"'));
assert(label.includes('<time datetime="2025-12-03">2025-12-03</time>'));
assert.equal(issueChapterLabel({title:'附件'}).includes('chapter-meta'),false,'没有文号和日期就不占空白行');

const macURI='file:///Users/example/PDF%20%E4%B8%93%E5%88%8A/%E9%93%81%E8%B7%AF.pdf';
const winURI='file:///D:/%E9%93%81%E8%B7%AF/%E4%B8%93%E5%88%8A%20PDF/KH2015105000.pdf';
assert.equal(originalURL({source:macURI},2),macURI+'#page=3');
assert.equal(originalURL({source:winURI},0),winURI+'#page=1');
assert.equal(originalURL({source:winURI},null),winURI);
assert.equal(originalURL({source:'../pdf/铁路 专刊.pdf'},0),'../pdf/'+encodeURIComponent('铁路 专刊.pdf')+'#page=1');
assert.equal(originalURL({file:'铁路 专刊.pdf'},1),'../pdf/'+encodeURIComponent('铁路 专刊.pdf')+'#page=2');
console.log('通过：目录中文日期转阿拉伯日期、文号与来源一致、附件题名清理，外部file URI不重复编码。');
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
    const used=new Set();
    const expected=usableBookmarks.filter(([,title])=>title.replace(/\ufffd+/g,'').trim()).map(([level,rawTitle,page])=>{
      const title=rawTitle.replace(/\ufffd+/g,'').trim(),p=page-1;
      const entry=p>=0 && p<doc.pages?issueChapterEntry(doc,title,p,used):null;
      if(entry)used.add(entry.id);
      return [level,entry?.kind==='附件'?entry.title:title];
    });
    assert.deepEqual(chapters.map(item=>[item.level,item.title]),expected,doc.file);
    withBookmarks++;
  } else {
    assert(chapters.length, doc.file);
    generated++;
  }
  assert(chapters.every(item => item.p == null || item.p < doc.pages), doc.file);
  assert(chapters.every(item=>!item.date || /^\d{4}-\d{2}-\d{2}$/.test(item.date)),doc.file);
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
