'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const {gzipSync} = require('node:zlib');
const {setTimeout: wait} = require('node:timers/promises');
const offline = path.resolve(__dirname, '../offline');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crkh-browser-test-'));
const chrome = process.env.CRKH_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const corpus = process.argv.includes('--corpus');
const exampleFile = path.join(offline,'非结构化内容示例.html');
const exampleIds = process.env.CRKH_EXAMPLE_PAGE && fs.existsSync(exampleFile)
  ? new Set([...fs.readFileSync(exampleFile,'utf8').matchAll(/data-docid="([a-f0-9-]+)"/g)].map(match=>match[1])) : new Set();
const longTitle = '国铁集团货运部关于修改《铁路货运运价里程表》有关事项及部分车站办理范围和接续线路的通知';
function makeIssue(id, pages, bookmarks, chapterPages) {
  const texts = Array(pages).fill('');
  const entries = chapterPages.map((p, i) => {
    const title = `${i + 1}.${longTitle}（第${i + 1}次修订）`;
    texts[p] = title + '北京通州站。以下为浏览器测试使用的合成文字。'.repeat(10);
    return {id: `${id}-${i}`, p, a: 0, title, kind: '文件', topic: '货运', confidence: '测试条目',
      parts: [{p, a: 0, b: texts[p].length}]};
  });
  return {id, file: `测试专刊 ${id}.pdf`, year: 2022, issue: id === 'bookmarks' ? '2、3期合刊' : '4期',
    issueOrder: id === 'bookmarks' ? 2 : 4, pages, labels: texts.map((_, p) => String(p + 1)),
    sizes: texts.map(() => [400, 600]), texts, entries,
    toc: bookmarks ? [[1, '货运管理', -1], ...entries.map((e, i) => [i === entries.length - 1 ? 7 : 2, e.title, e.p + 1])] : []};
}
const docs = [makeIssue('bookmarks', 1005, true, [0, 8, 36, 42, 54, 65, 66, 67, 68, 74, 77, 80, 99, 157, 999, 1004]),
  makeIssue('generated', 12, false, [0, 4, 11])];
let realDocs = [];
const typedTables = [
  ['kh1987104000.pdf', 20, 'operation'],
  ['kh1993201000.pdf', 78, 'technical'],
  ['kh2000103000.pdf', 54, 'statistics'],
  ['KH2015101000.pdf', 69, 'code'],
  ['KH2020106000.pdf', 32, 'fare'],
  ['铁路客货运输2024-5.pdf', 44, 'amendment']
];
if (corpus) {
  const raw = fs.readFileSync(path.join(offline, 'data/index.js'), 'utf8');
  const all = JSON.parse(raw.trim().replace(/^window.CATALOG=|;$/g, '')).docs;
  const names = new Set(['kh1951601000.pdf', 'kh1951603000.pdf', 'kh1958509000.pdf', 'kh1979102000.pdf', 'kh1991104000.pdf', 'kh2000102000.pdf',
    'kh2007106000.pdf', 'kh2010101000.pdf', 'KH2020102000.pdf', '铁路客货运输2022-2、3.pdf',
    '铁路客货运输2025-4、5.pdf', '铁路客货运输2025-6.pdf', 'KH2018105060.pdf', 'kh2002101000.pdf',
    'kh1953601000.pdf', 'kh2007104000.pdf', '铁路客货运输2021-1.pdf', '铁路客货运输2021-6.pdf',
    'kh2011101000.pdf', 'KH2015106000.pdf', 'KH2016106000.pdf', 'KH2017105060.pdf', 'KH2018101000.pdf',
    'kh2010105000.pdf','kh1988102000.pdf','kh2012101000.pdf','kh2013101000.pdf','铁路客货运输2022-1.pdf',
    'kh2001102000.pdf','kh2004105000.pdf','kh1993201000.pdf',
    'kh1981104000.pdf','kh1997202000.pdf','kh2012104000.pdf','kh2013104050.pdf',
    ...typedTables.map(([file]) => file)]);
  const selected = new Set(all.filter(doc => names.has(doc.file)));
  const decades = [...new Set(all.map(doc => Math.floor(doc.year / 10)))];
  for (const decade of decades) {
    const editions = all.filter(doc => Math.floor(doc.year / 10) === decade && doc.pages >= 12)
      .sort((a, b) => a.year - b.year || a.pages - b.pages);
    for (let i = 0; i < 6; i++) selected.add(editions[Math.floor(i * (editions.length - 1) / 5)]);
  }
  realDocs = [...selected].sort((a, b) => a.year - b.year || a.issueOrder - b.issueOrder);
  assert(realDocs.length >= 50 && realDocs.every(doc => doc.originalPages), '须先生成完整原版面数据');
}
let delayedPages = 0;
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.slice(1));
  if (process.env.CRKH_EXAMPLE_PAGE && name === '非结构化内容示例.html') {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    return fs.createReadStream(exampleFile).pipe(res);
  }
  if (name === 'data/index.js') {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    return res.end('window.CATALOG=' + JSON.stringify({docs: corpus ? realDocs : docs}) + ';');
  }
  const realAsset = /^data\/([a-f0-9]{10}-[a-f0-9]{12})\/\d+\.(page\.js|original\.webp)$/.exec(name);
  if (corpus && realAsset && (realDocs.some(doc => doc.id === realAsset[1]) || exampleIds.has(realAsset[1]))) {
    const file = path.join(offline, name);
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader('Content-Type', realAsset[2].endsWith('.js') ? 'application/javascript; charset=utf-8' : 'image/webp');
    return fs.createReadStream(file).pipe(res);
  }
  const pageAsset = /^data\/([a-z]+)\/(\d+)\.page\.js$/.exec(name);
  if (pageAsset) {
    const doc = docs.find(d => d.id === pageAsset[1]), p = Number(pageAsset[2]) - 1;
    if (!doc || p < 0 || p >= doc.pages) return res.writeHead(404).end();
    const value = doc.texts[p].replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const chunks = value.match(/.{1,29}/gu) || [];
    const svg = '<svg xmlns="http://www.w3.org/2000/svg">' + chunks.map((chunk, i) =>
      `<text x="20" y="${100 + i * 15}" font-size="10" textLength="280">${chunk}</text>`).join('') + '</svg>';
    const key = JSON.stringify(doc.id + ':' + p);
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    const send = () => {
      if (doc.id === 'bookmarks') {
        const packed = gzipSync(Buffer.from('[]\n' + svg)).toString('base64');
        res.end(`window.PAGE_PACKED[${key}]=${JSON.stringify(packed)};`);
      } else {
        res.end(`window.PAGE_COORDS[${key}]=[];window.PAGE_HTML[${key}]=${JSON.stringify(svg)};`);
      }
    };
    if (doc.id === 'bookmarks' && p >= 60 && p < 65) {
      delayedPages++;
      setTimeout(send, 180);
    }
    else send();
    return;
  }
  const files = ['index.html', 'style.css', 'flow.js', 'reader.js', 'issue.js', 'navigation.js', 'app.js'];
  if (!files.includes(name)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({html:'text/html',css:'text/css',js:'application/javascript'}[name.split('.').at(-1)]) + '; charset=utf-8');
  res.end(fs.readFileSync(path.join(offline, name)));
});
let proc, ws;
async function eventually(check, label) {
  for (let i = 0; i < 250; i++) {
    const value = await check();
    if (value) return value;
    await wait(40);
  }
  throw Error('Timeout: ' + label);
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  assert(fs.existsSync(chrome), '未找到 Chrome。可用 CRKH_CHROME 指定 Chrome 可执行文件。');
  proc = spawn(chrome, ['--headless', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--remote-debugging-port=0', '--user-data-dir=' + temp, 'about:blank'], {stdio:'ignore'});
  const cdpPort = await eventually(() => {
    try { return fs.readFileSync(path.join(temp, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { return null; }
  }, 'Chrome startup');
  const targets = await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  let seq = 0;
  const pending = new Map(), errors = [];
  ws.addEventListener('message', ({data}) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (pending.has(msg.id)) {
      const {resolve,reject} = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(Error(msg.error.message)); else resolve(msg.result);
    }
  });
  function cdp(method, params={}) {
    return new Promise((resolve,reject) => {
      const id = ++seq;
      pending.set(id,{resolve,reject});
      ws.send(JSON.stringify({id,method,params}));
    });
  }
  async function run(expression) {
    const out = await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if (out.exceptionDetails) throw Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text);
    return out.result.value;
  }
  async function ready(expression) { return eventually(() => run(expression), expression); }
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/index.html`});
  await ready('!!document.querySelector(".result-source")');
  if (corpus) {
    await run(`(async()=>{
      const doc=catalog.docs.find(doc=>doc.file==='kh2010105000.pdf');
      const attachments=doc.entries.filter(entry=>entry.kind==='附件'&&entry.p===24);
      if(attachments.length!==3 || !attachments.every(entry=>entry.parentId))throw Error('同页附件1、2、3未分别分割为子节点');
      for(const attachment of attachments) {
        const section=await renderReadingSection({...attachment,document:doc},renderSerial);
        if(attachment.attachmentLabel==='附件3'){
          const source=section.querySelector('.source-page');
          const crop=source?.dataset.crop.split(',').map(Number);
          if(!source || crop[3]-crop[1]>25 || crop[2]-crop[0]>85 || section.querySelector('table'))throw Error('线路示意图没有单独精确裁切');
        }else if(section.querySelector('.source-page') || section.querySelectorAll('table').length!==1)throw Error('标准附件里程表没有HTML解析 '+attachment.title);
      }
      const leba=doc.entries.find(entry=>entry.kind==='附件'&&entry.p===32);
      const section=await renderReadingSection({...leba,document:doc},renderSerial);
      if(section.querySelector('.source-page') || section.querySelectorAll('table').length!==1 || section.querySelectorAll('table .inline-symbol').length<2)throw Error('乐巴线表或圈正、三角货未按格显示');
      const old=catalog.docs.find(doc=>doc.file==='kh1988102000.pdf');
      const entry=old.entries.find(entry=>entry.parts.some(part=>part.p===20));
      const oldSection=await renderReadingSection({...entry,document:old},renderSerial);
      const table=[...oldSection.querySelectorAll('table')].find(table=>table.querySelector('[data-page="20"]'));
      if(!table || table.querySelectorAll('.cell-band').length<100)throw Error('1988修改表仍把多条记录挤在同一段');
      for(const [file,page,expected] of [['kh2012101000.pdf',23,'穆棱市禹实水泥有限责任公司专用线'],['kh2013101000.pdf',55,'内蒙古鑫诺蒙西物流有限公司专用铁路']]) {
        const doc=catalog.docs.find(doc=>doc.file===file),entry=doc.entries.find(entry=>entry.parts.some(part=>part.p===page));
        const section=await renderReadingSection({...entry,parts:entry.parts.filter(part=>part.p===page),document:doc},renderSerial);
        if(!section.textContent.includes(expected))throw Error('单元格跨行串字 '+file);
      }
      openIssue(old);
      if($('issueContents').textContent.includes('�'))throw Error('原PDF书签末尾乱码未清理');
    })()`);
    await run(`(async () => {
      const doc=catalog.docs.find(doc=>doc.file==='KH2018105060.pdf');
      const notice=doc.entries.find(entry=>entry.p===11 && entry.kind==='文件');
      const section=await renderReadingSection({...notice,document:doc},renderSerial);
      const heading=[...section.querySelectorAll('h3')].find(node=>node.textContent==='一、《客运运价里程表》修改内容');
      if(!heading || !/如下[:：]$/.test(heading.previousElementSibling.textContent)) throw Error('柳沟南通知的一、标题没有另起一行');
      for(const [start,count,stations] of [[15,28,['原平西','忻州西','西涧河所','太原东','太原南','大荔','西安北']],
          [18,15,['哈尔滨','宾西北','宾州','高楞','依兰','佳木斯']]]) {
        const entry=doc.entries.find(entry=>entry.p===start && entry.kind==='附件');
        const section=await renderReadingSection({...entry,document:doc},renderSerial);
        if(section.querySelector('.source-page') || section.querySelectorAll('table').length!==1 || /续上表/.test(section.textContent)) throw Error('标准里程表回退或重复表头 '+entry.title);
        const table=section.querySelector('table');
        if(table.rows.length!==count) throw Error('里程表行数错误 '+entry.title);
        if(section.querySelector('h2').textContent.includes('—')) throw Error('表题和线路标注没有分开 '+entry.title);
        for(const station of stations) if(![...table.querySelectorAll('.table-station')].some(cell=>cell.textContent.includes(station))) throw Error('站名缺失或错序 '+station);
        if(start===15) {
          for(const station of ['西涧河所','太原东','太原南','渭南北','湾李所','西安北']) {
            const cell=[...table.querySelectorAll('.table-station')].find(cell=>cell.textContent.includes(station));
            if(!cell?.querySelector('[style*="text-decoration:underline"]')) throw Error('真实下划线丢失 '+station);
          }
          const notes=[...section.querySelectorAll('.reading-paragraph')].filter(node=>node.textContent.startsWith('2'));
          if(notes.length!==1 || !notes[0].textContent.endsWith('公司。')) throw Error('续表注释被物理换行切开');
        }
      }
      for(const [file,number,tables] of [['kh1953601000.pdf',3,1],['铁路客货运输2021-1.pdf',92,1],
          ['铁路客货运输2021-6.pdf',303,3],['铁路客货运输2022-2、3.pdf',133,2]]) {
        const doc=catalog.docs.find(doc=>doc.file===file);
        const entry=doc.entries.find(entry=>entry.parts.some(part=>part.p===number-1));
        const section=await renderReadingSection({...entry,parts:entry.parts.filter(part=>part.p===number-1),document:doc},renderSerial);
        if(section.querySelector('.source-page') || section.querySelectorAll('table').length!==tables) throw Error('同页表格或标题单位误判 '+file+':'+number);
        if(number===133) {
          const values=[...section.querySelectorAll('td.table-quantity')].filter(cell=>cell.querySelectorAll(':scope > .cell-band').length===2).map(cell=>cell.textContent);
          if(values.length!==4 || !values.includes('—3') || !values.includes('4—')) throw Error('单元格内的多行里程未保留逐行对应');
        }
      }
      const prose=catalog.docs.find(doc=>doc.file==='kh2007104000.pdf');
      const noticeWithNumbers=prose.entries.find(entry=>entry.parts.some(part=>part.p===63));
      const numberSection=await renderReadingSection({...noticeWithNumbers,parts:noticeWithNumbers.parts.filter(part=>part.p===63),document:prose},renderSerial);
      if(numberSection.querySelector('.source-page') || !numberSection.textContent.includes('7.1.2')) throw Error('多级条款编号误判为多栏正文');
    })()`);
    await run(`(async()=>{
      const doc=catalog.docs.find(doc=>doc.file==='铁路客货运输2022-2、3.pdf');
      openIssue(doc);await jumpInIssue({p:132});
      await Promise.all(issueView.byPage[132].map(({slot})=>loadIssueSlot(issueView,slot)));
      const section=issueView.byPage[132][0].slot.node;
      for(const table of section.querySelectorAll('table')) {
        for(const row of table.rows) {
          const nodes=[...row.querySelectorAll('.cell-band')];
          if(!nodes.length)continue;
          for(const band of ['0','1']) {
            const rects=nodes.filter(node=>node.dataset.band===band).map(node=>node.getBoundingClientRect());
            if(rects.length<4 || Math.max(...rects.map(rect=>rect.top))-Math.min(...rects.map(rect=>rect.top))>1) throw Error('同一单元格内站名、里程和接续线没有逐行对齐');
          }
        }
      }
    })()`);
    await run(`(async () => {
      const doc = catalog.docs.find(doc => doc.file === '铁路客货运输2025-6.pdf');
      for (const entry of doc.entries.filter(entry => entry.p >= 9 && entry.p <= 15 && entry.kind === '文件')) {
        const section = await renderReadingSection({...entry, document: doc}, renderSerial);
        if (section.querySelector('.source-page')) throw Error('标准公文被误判为原版面 ' + entry.title);
        const paragraphs = [...section.querySelectorAll('p.reading-paragraph')];
        if (paragraphs.length !== 2 || !paragraphs[1].textContent.endsWith('。')) throw Error('公文自然段被拆断 ' + entry.title);
      }
      const issue = catalog.docs.find(doc => doc.file === '铁路客货运输2022-2、3.pdf');
      const notice = issue.entries.find(entry => entry.title.startsWith('国铁集团关于公布京广高铁北京丰台至杜家坎所段'));
      const section = await renderReadingSection({...notice, document: issue}, renderSerial);
      const paragraphs = [...section.querySelectorAll('p.reading-paragraph')];
      const second = paragraphs.filter(node => /^2[.．]京沪线/.test(node.textContent));
      if (second.length !== 1 || !second[0].textContent.endsWith('公司。') || !second[0].textContent.includes('2.073公里')) throw Error('第2条被物理换行切开');
      const fourth = paragraphs.find(node => /^4[.．]京原线/.test(node.textContent));
      if (!fourth?.textContent.includes('石景山南站') || !fourth.querySelector('[data-page="42"]') || !fourth.querySelector('[data-page="43"]')) throw Error('跨页正文没有合为自然段');
      for (const [title, count] of [['京广高铁客运运价里程表',44],['京广线客运运价里程表',80],['京原线客运运价里程表',45]]) {
        const entry = issue.entries.find(entry => entry.title === title);
        const section = await renderReadingSection({...entry,document:issue},renderSerial);
        const tables = section.querySelectorAll('table');
        if (tables.length !== 1 || tables[0].rows.length !== count || /续上表|接上表/.test(section.textContent)) throw Error('连续表格或重复表头有误 ' + title);
      }
    })()`);
    const wushan = realDocs.find(doc => doc.file === 'KH2020102000.pdf').entries;
    assert.equal(wushan.filter(entry => entry.title === '乌山联络线客运运价里程表').length, 1);
    assert(wushan.some(entry => entry.title.startsWith('国铁集团关于乌山联络线开办') && entry.date === '二〇二〇年一月八日'));
    for (const [file, number, family] of typedTables) {
      const observed = await run(`(async () => {
        openIssue(catalog.docs.find(doc => doc.file === ${JSON.stringify(file)}));
        await jumpInIssue({p: ${number - 1}});
        await Promise.all(issueView.byPage[${number - 1}].map(({slot}) => loadIssueSlot(issueView, slot)));
        const table = [...$('pageStack').querySelectorAll('table[data-family="${family}"]')]
          .find(node => node.querySelector('[data-page="${number - 1}"]'));
        return table && {headers: table.querySelectorAll('th[scope]').length, cells: table.querySelectorAll('td').length};
      })()`);
      assert(observed?.headers >= 2 && observed.cells, `${file} 第 ${number} 页的 ${family} 表格未通过`);
    }
    await run(`(async () => {
      openIssue(catalog.docs.find(doc => doc.file === 'kh2002101000.pdf'));
      await jumpInIssue({p: 40});
      if (!$('pageStack').querySelector('.source-page[data-page="40"]')) throw Error('无分隔线的多站时刻表应按原页显示');
    })()`);
    const screenshotFolder = process.env.CRKH_SCREENSHOTS;
    if (screenshotFolder) {
      const samples = [
        ['kh2010105000.pdf',25],['kh2010105000.pdf',33,'mileage'],['kh1988102000.pdf',21],
        ['kh2012101000.pdf',24],['kh2013101000.pdf',56],['铁路客货运输2022-1.pdf',20],
        ['KH2018105060.pdf',12], ['KH2018105060.pdf',16,'mileage'], ['KH2018105060.pdf',17,'mileage'],
        ['KH2018105060.pdf',19,'mileage'], ['KH2018105060.pdf',20,'mileage'],
        ['kh1953601000.pdf',3], ['铁路客货运输2021-1.pdf',92,'amendment'], ['铁路客货运输2021-6.pdf',303],
        ['铁路客货运输2022-2、3.pdf',133],
        ['kh1958509000.pdf', 20], ['kh1979102000.pdf', 24], ['kh2007106000.pdf', 122], ['kh2007106000.pdf', 124],
        ['kh2010101000.pdf', 22], ['铁路客货运输2022-2、3.pdf', 45], ['铁路客货运输2025-4、5.pdf', 49],
        ['kh1991104000.pdf', 16], ['KH2020102000.pdf', 7], ['kh1951603000.pdf', 4], ['kh2000102000.pdf', 90],
        ['kh2002101000.pdf', 41], ['kh1951601000.pdf', 6], ['铁路客货运输2025-6.pdf', 11], ['铁路客货运输2022-2、3.pdf', 43], ...typedTables
      ];
      for (const [file, p, family] of samples) {
        await run(`(async () => {
          openIssue(catalog.docs.find(doc => doc.file === ${JSON.stringify(file)}));
          await jumpInIssue({p: ${p - 1}});
          for (const img of issueView.positionNode?.closest('.article-section')?.querySelectorAll('.source-sheet img') || []) {
            img.loading = 'eager';
            await img.decode();
          }
          const family = ${JSON.stringify(family || '')};
          if (family) {
            await Promise.all(issueView.byPage[${p - 1}].map(({slot}) => loadIssueSlot(issueView, slot)));
            const table = [...$('pageStack').querySelectorAll('table[data-family="' + family + '"]')]
              .find(node => node.querySelector('[data-page="${p - 1}"]'));
            if (table) {
              scrollReaderTo(table);
              saveIssuePosition(issueView, table);
              if(${JSON.stringify(file)}==='KH2018105060.pdf' && table.scrollWidth>table.parentElement.clientWidth+1) throw Error('标准六列表格不应强制横向滚动');
            }
          }
        })()`);
        const screenshot = await cdp('Page.captureScreenshot', {format: 'png'});
        fs.writeFileSync(path.join(screenshotFolder, `${file}-${p}.png`), Buffer.from(screenshot.data, 'base64'));
      }
    }
    await run(`(async () => {
      openIssue(catalog.docs.find(doc => doc.file === '铁路客货运输2025-4、5.pdf'));
      await jumpInIssue({p: 48});
      const table = issueView.byPage[48][0].slot.node.querySelector('table');
      if (!table || table.rows.length !== 23 || !table.textContent.includes('★梅河口') ||
          table.querySelector('[style*="underline"]') || !table.querySelector('td[rowspan="21"]')) {
        throw Error('梅集铁路货物运价里程表的站名、合并单元格或下划线有误');
      }
    })()`);
    await run(`(async () => {
      openIssue(catalog.docs.find(doc => doc.file === 'kh1951601000.pdf'));
      await jumpInIssue({p:5});
      const section = issueView.byPage[5][0].slot.node;
      const symbol = section.querySelector('.inline-symbol');
      if (!symbol || section.querySelector('.source-page[data-page="5"]')) throw Error('普通编号符号应嵌入正文');
      const image = new Image();
      image.src = getComputedStyle(symbol).backgroundImage.slice(5,-2);
      await image.decode();
    })()`);
    await run(`(async () => {
      const document=catalog.docs.find(doc=>doc.file==='KH2018105060.pdf');
      for(const p of [11,12]) {
        openIssue(document);await jumpInIssue({p});
        await Promise.all(issueView.byPage[p].map(({slot})=>loadIssueSlot(issueView,slot)));
        const symbols=issueView.byPage[p].flatMap(({slot})=>[...slot.node.querySelectorAll('.inline-symbol')]);
        if(symbols.some(node=>/[\\u4e00-\\u9fff]/.test(node.textContent)))throw Error('2018 正常汉字不得用符号裁图替代');
      }
      openIssue(catalog.docs.find(doc=>doc.file==='kh2012104000.pdf'));await jumpInIssue({p:7});
      const text=issueView.byPage[7].map(({slot})=>slot.node.textContent).join('');
      if((text.match(/改为/g)||[]).length<6)throw Error('铁路位图符号不得吞掉改为中的为');
      const figures=issueView.byPage[7].flatMap(({slot})=>[...slot.node.querySelectorAll('.inline-symbol')]);
      if(figures.length<6 || figures.some(node=>node.textContent==='为'))throw Error('六处铁路位图符号应插在为之后');
      openIssue(catalog.docs.find(doc=>doc.file==='kh2013104050.pdf'));await jumpInIssue({p:297});
      const cells=issueView.byPage[297].flatMap(({slot})=>[...slot.node.querySelectorAll('td')]);
      if(!cells.some(cell=>cell.textContent.includes('合资') && cell.querySelector('.inline-symbol')))throw Error('合资后星号不得替代资');
      openIssue(catalog.docs.find(doc=>doc.file==='kh1981104000.pdf'));await jumpInIssue({p:36});
      const nativeText=issueView.byPage[36].map(({slot})=>slot.node.textContent).join('').replace(/\\s/g,'');
      if(!nativeText.includes('改为○另但不办理爆炸品发到'))throw Error('原生组合符号必须位于但字之前');
    })()`);
    for (const [file, p, expected] of [
      ['kh1991104000.pdf', 15, ['坨子头', '坨子头']],
      ['KH2020102000.pdf', 6, ['乌', '山', '长沙西']],
      ['kh1951603000.pdf', 3, []],
      ['kh2000102000.pdf', 89, []]
    ]) {
      const observed = await run(`(async () => {
        openIssue(catalog.docs.find(doc => doc.file === ${JSON.stringify(file)}));
        await jumpInIssue({p: ${p}});
        await Promise.all(issueView.byPage[${p}].map(({slot}) => loadIssueSlot(issueView, slot)));
        const nodes = issueView.byPage[${p}].flatMap(({slot}) =>
          [...slot.node.querySelectorAll('[data-page="${p}"][style*="text-decoration:underline"]')]);
        const preserved = !!$('pageStack').querySelector('.source-page[data-page="${p}"]');
        return {text: [...new Set(nodes)].map(node => node.textContent), preserved};
      })()`);
      assert.deepEqual(observed.text, expected, file);
      if (!expected.length) assert(observed.preserved, file);
    }
    const total = {pages: 0, source: 0, tables: 0, prose: 0};
    for (const doc of realDocs) {
      const checked = await run(`(async () => {
        const document = catalog.docs.find(doc => doc.id === ${JSON.stringify(doc.id)});
        openIssue(document);
        const view = issueView;
        const observed = new Set();
        const count = {source: 0, tables: 0, prose: 0};
        for (const slot of view.slots) {
          await loadIssueSlot(view, slot);
          const section = slot.node.querySelector('.article-section');
          if (!section || section.querySelector('.table-layout')) throw Error('无法读取或出现模拟版式 ' + slot.entry.title);
          const anchors = [...section.querySelectorAll('[data-page]')];
          for (const node of anchors) observed.add(Number(node.dataset.page));
          for (const part of slot.entry.parts) {
            if (!anchors.some(node => Number(node.dataset.page) === part.p)) {
              throw Error('没有原页锚点 ' + (part.p + 1) + ' ' + slot.entry.title);
            }
          }
          for (const img of section.querySelectorAll('.source-sheet img')) {
            img.loading = 'eager';
            await img.decode();
            if (img.naturalWidth < 1 || !img.getBoundingClientRect().width) throw Error('原版面为空 ' + img.src);
            count.source++;
          }
          count.tables += section.querySelectorAll('table').length;
          count.prose += section.querySelectorAll('.reading-paragraph').length;
        }
        if (observed.size !== document.pages) throw Error('全文缺页');
        closeIssue();
        $('pageStack').replaceChildren();
        return {pages: observed.size, ...count};
      })()`);
      for (const key of Object.keys(total)) total[key] += checked[key];
      console.log(`${doc.file} | ${checked.pages} 页 | ${checked.tables} 张 HTML 表 | ${checked.source} 个原版面区块 | ${checked.prose} 行正文`);
    }
    const sample = realDocs.find(doc => doc.file === '铁路客货运输2022-2、3.pdf');
    await run(`$('volume').value=${JSON.stringify(sample.id)}; $('searchMode').value='pdf'; $('query').value='北京丰台'; navigateSearch()`);
    await ready('!!document.querySelector(".source-highlight.current")');
    assert(await run('hits.length > 0'));
    const hit = await run(`(() => {
      const first = document.querySelector('.source-jump');
      const target = Number(first.dataset.page);
      first.click();
      return target;
    })()`);
    await ready(`issueView?.original && !issueView.pending && page === ${hit} && !!document.querySelector('.source-highlight')`);
    await run('history.back()');
    await ready('!issueView && selected?.sourcePage && !!document.querySelector(".source-highlight.current")');
    assert.deepEqual(errors, []);
    console.log(`Chrome 全文通过：${realDocs.length} 期，${total.pages} 页，${total.tables} 张 HTML 表，${total.source} 个原版面区块，${total.prose} 个自然段；原页检索、高亮和后退通过。`);
    if (process.env.CRKH_EXAMPLE_PAGE) {
      await cdp('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/${encodeURIComponent('非结构化内容示例.html')}`});
      await ready('document.querySelectorAll("details.example").length === 48');
      const checked = await run(`(async () => {
        document.getElementById('expand').click();
        for (const img of document.querySelectorAll('.example img')) {img.loading='eager';await img.decode();}
        const select=document.getElementById('category');
        select.value=select.options[1].value;select.dispatchEvent(new Event('change'));
        const visible=[...document.querySelectorAll('.example')].filter(node=>!node.hidden);
        if(!visible.length || visible.some(node=>node.dataset.reason!==select.value)) throw Error('示例筛选有误');
        select.value='';select.dispatchEvent(new Event('change'));
        document.getElementById('collapse').click();
        const examples=[...document.querySelectorAll('.example')];examples[0].open=true;
        return {images:document.querySelectorAll('.example img').length,visible:examples.filter(node=>!node.hidden).length};
      })()`);
      assert.deepEqual(checked,{images:48,visible:48});
      if(process.env.CRKH_SCREENSHOTS){
        const proof=await cdp('Page.captureScreenshot',{format:'png'});
        fs.writeFileSync(path.join(process.env.CRKH_SCREENSHOTS,'非结构化内容示例.png'),Buffer.from(proof.data,'base64'));
      }
      console.log('通过：48 个非结构化示例的图像、类型筛选和展开收起。');
    }
    return;
  }
  await run('window.__samePage = {}; $("query").value="北京通州站"; navigateSearch();');
  await ready('!!document.querySelector("#pageStack mark")');
  const source = await run(`(() => {
    const result = [...document.querySelectorAll(".source-jump")].find(b => b.dataset.page === "65");
    const value = {p:Number(result.dataset.page), a:Number(result.dataset.offset)};
    $("results").scrollTop = 350;
    value.scroll = $("results").scrollTop;
    result.click();
    return value;
  })()`);
  await ready('issueView && !issueView.pending && page === 65 && !!document.querySelector("#issueContents [aria-current]")');
  assert.equal(await run('Number(document.querySelector("#issueContents [aria-current] small").textContent)'), 66);
  assert.equal(await run('issueView.anchor.a'), source.a);
  await wait(300);
  assert(delayedPages > 0, 'The jump must exercise loading preceding pages');
  assert.equal(await run('page'), 65, 'Loading pages above the hit must keep the target');
  await run('$("zoomIn").click(); $("zoomIn").click(); $("zoomOut").click()');
  assert.equal(await run('page'), 65, 'Changing the font size must keep the target');
  for (const [width,height] of [[1440,900],[1024,768],[800,700],[620,700],[390,844],[320,720]]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    const measurements = await run(`(() => {
      const nav = $("issueContents");
      return {pageOverflow: document.documentElement.scrollWidth - innerWidth,
        directoryOverflow: nav.scrollWidth - nav.clientWidth,
        rows:[...nav.querySelectorAll(".chapter-link")].map(row => {
          const title = row.querySelector("span"), number = row.querySelector("small");
          const range = document.createRange();
          range.selectNodeContents(number);
          return {label:number.textContent, lines:range.getClientRects().length,
            right:number.getBoundingClientRect().right,
            gap:number.getBoundingClientRect().left-title.getBoundingClientRect().right};
        })};
    })()`);
    assert(measurements.directoryOverflow <= 1, JSON.stringify({width, measurements}));
    assert(measurements.pageOverflow <= 1, JSON.stringify({width, measurements}));
    assert(measurements.rows.every(row => row.lines === 1 && row.gap >= 8 &&
      Math.abs(row.right-measurements.rows[0].right) <= 1), JSON.stringify({width, measurements}));
    console.log(`Chrome ${width}×${height}：16 条长标题，1–4 位页码单行右对齐，目录和页面无横向溢出。`);
  }
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await wait(150);
  assert.equal(await run('page'), 65);
  await run(`[...$("issueContents").querySelectorAll(".chapter-link")].find(button =>
    button.querySelector("small").textContent === "1000").click()`);
  await ready('issueView && !issueView.pending && page === 999');
  await run('history.back()');
  await ready('issueView && !issueView.pending && page === 65');
  await run('history.back()');
  await ready('!issueView && !$("searchSidebar").hidden && $("query").value === "北京通州站" && !!document.querySelector("#pageStack mark")');
  assert.equal(await run('$("results").scrollTop'), source.scroll);
  await run('history.forward()');
  await ready('issueView && !issueView.pending && page === 65');
  await run('$("about").click()');
  await ready('$("scopeDialog").open');
  await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:5,y:5,button:'left',clickCount:1});
  await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:5,y:5,button:'left',clickCount:1});
  await ready('!$("scopeDialog").open && issueView && page === 65');
  await run('$("about").click(); document.querySelector("#scopeList [data-issue=generated]").click()');
  await ready('issueView?.document.id === "generated" && !issueView.pending && !$("scopeDialog").open');
  assert.equal(await run('$("issueContents").querySelectorAll(".chapter-link").length'), 3);
  await run('document.querySelector("#issueContents button:last-child").click()');
  await ready('issueView && !issueView.pending && page === 11');
  await run('history.back()');
  await ready('issueView && !issueView.pending && page === 0');
  await run('history.back()');
  await ready('$("scopeDialog").open && issueView?.document.id === "bookmarks" && !issueView.pending && page === 65');
  assert.equal(await run('!!window.__samePage'), true);
  assert.deepEqual(errors, []);
  console.log('Chrome：搜索命中、目录定位、前进后退、背景关闭、无书签目录均通过，页面未重载，未捕获脚本异常。');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  ws?.close();
  if (proc && proc.exitCode == null) {
    proc.kill();
    await new Promise(resolve => proc.once('exit', resolve));
  }
  server.close();
  fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});
});
