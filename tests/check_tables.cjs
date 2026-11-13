'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const {gunzipSync} = require('node:zlib');
const root=path.resolve(__dirname,'..');
const {articleBlocks, joinTableContinuation, tableCellText, tableCellRuns, tableProfile,
  verifyReadingUnderlines, canDisplayReadingPart, splitReadingColumns} = new Function(
  fs.readFileSync(path.join(root, 'offline/flow.js'), 'utf8') +
  ';return {articleBlocks, joinTableContinuation, tableCellText, tableCellRuns, tableProfile, verifyReadingUnderlines, canDisplayReadingPart, splitReadingColumns}'
)();
const catalog=JSON.parse(fs.readFileSync(path.join(root,'offline/data/index.js'),'utf8').replace(/^window.CATALOG=/,'').replace(/;\s*$/,''));
const decode=s=>s.replace(/&(?:amp|lt|gt|quot|#x27);/g,m=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#x27;':"'"}[m]));
function readPage(doc,p){
 let coordinates = [];
 const source=fs.readFileSync(path.join(root,'offline/data',doc.id,`${p+1}.page.js`),'utf8');
 const svg = source.startsWith('window.PAGE_PACKED[')
   ? (() => {
       const packed = JSON.parse(source.slice(source.indexOf('=') + 1).trim().replace(/;$/, ''));
       const raw = gunzipSync(Buffer.from(packed, 'base64')).toString('utf8');
       coordinates = JSON.parse(raw.slice(0, raw.indexOf('\n')));
       return raw.slice(raw.indexOf('\n') + 1);
     })()
   : JSON.parse(source.split('window.PAGE_HTML[')[1].split('=').slice(1).join('=').trim().replace(/;$/,''));
 let a=0;const runs=[];
 for(const match of svg.matchAll(/<text ([^>]+)>([\s\S]*?)<\/text>/g)){
  const attrs=Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
  const text=decode(match[2]);runs.push({text,a,b:a+text.length,x:+attrs.x,y:+attrs.y,width:+attrs.textLength,size:+attrs['font-size'],
    line:attrs['data-line'],bold:attrs['font-weight']==='bold',underline:attrs['text-decoration']==='underline',p});a+=text.length;
 }
 const rules = [...svg.matchAll(/<path d="([^"]*)"/g)].map(m=>m[1]);
 return {runs:splitReadingColumns(runs,rules,coordinates,...doc.sizes[p]),rules,width:doc.sizes[p][0],height:doc.sizes[p][1],length:a,
   sourceOnly:/<svg[^>]*data-source="true"/.test(svg)};
}
function parsePage(doc,p,part,title){
 const {runs,rules,width,height,length}=readPage(doc,p);
 return articleBlocks(runs,rules,width,height,part || {a:0,b:length},title || '');
}

if (process.argv.includes('--fallbacks')) {
  const candidates = [];
  for (const doc of catalog.docs) {
    const pages = new Map();
    for (const entry of doc.entries) {
      if (entry.kind === '目录') continue;
      for (const part of entry.parts) {
        if (!pages.has(part.p)) pages.set(part.p, []);
        pages.get(part.p).push({entry, part});
      }
    }
    for (const [p, items] of pages) {
      const decoded = readPage(doc,p);
      verifyReadingUnderlines(decoded.runs, decoded.rules);
      for (const {entry,part} of items) {
        const blocks = articleBlocks(decoded.runs,decoded.rules,decoded.width,decoded.height,{...part,strict:true},entry.title);
        if (!decoded.sourceOnly && canDisplayReadingPart(blocks,decoded,part)) continue;
        const reason = decoded.sourceOnly ? (decoded.width > decoded.height ? '横向及特殊图表' : '图件和原始版面') :
          decoded.runs.some(run => run.fraction) ? '公式与上下标' :
          blocks.some(block => block.type === 'table-layout') ? '复杂格线和无分隔表格' : '多栏或特殊文字排版';
        candidates.push({year:doc.year,issue:doc.issue,file:doc.file,id:doc.id,p,label:doc.labels[p],source:doc.source,
          title:entry.title,kind:entry.kind,reason,text:doc.texts[p].slice(part.a,part.b)});
        break;
      }
    }
  }
  fs.writeFileSync(process.env.CRKH_EXAMPLE_CANDIDATES || '/tmp/crkh-unstructured-candidates.json',JSON.stringify(candidates));
  console.log('原版面候选', candidates.length);
  process.exit(0);
}

if (process.argv.includes('--types')) {
  const counts = new Map(), samples = new Map();
  const track = ['kh1951601000.pdf','kh1992206000.pdf','kh1999101000.pdf','kh2000103000.pdf',
    'kh2005101000.pdf','KH2015101000.pdf','KH2020106000.pdf','铁路客货运输2024-5.pdf'];
  for (const doc of catalog.docs) {
    const source = new Set(doc.mediaPages);
    const byPage = Array.from({length: doc.pages}, () => []);
    for (const entry of doc.entries) {
      if (!['目录','待核对'].includes(entry.kind)) for (const part of entry.parts) byPage[part.p].push({entry,part});
    }
    for (const [p, items] of byPage.entries()) {
      if (source.has(p) || !items.length) continue;
      const decoded = readPage(doc,p);
      if (!decoded.rules.length) continue;
      const {runs, rules, width, height} = decoded;
      verifyReadingUnderlines(runs, rules);
      for (const {entry,part} of items) {
        const blocks = articleBlocks(runs,rules,width,height,{...part,strict:true},entry.title);
        const tables = blocks.filter(block => block.type === 'table');
        if (!tables.length || !canDisplayReadingPart(blocks,decoded,part)) continue;
        for (const table of tables) {
          const {family, headerRows} = tableProfile(table, entry.title);
          counts.set(family,(counts.get(family) || 0) + 1);
          const records = samples.get(family) || new Map();
          const decade = Math.floor(doc.year/10);
          if (!records.has(decade)) records.set(decade, [doc.file,p+1,entry.title,
            table.rows.slice(0,Math.max(1,headerRows)).flat().map(tableCellText).join('｜')]);
          samples.set(family,records);
          if (track.includes(doc.file) && family !== 'grid' && headerRows > 0 && part.p === entry.p) {
            console.log('样例',family,doc.file,p+1,entry.title,table.rows[0].map(tableCellText).join('｜'));
          }
        }
      }
    }
  }
  for (const [family,count] of [...counts].sort((a,b)=>b[1]-a[1])) {
    console.log('合计',family,count,JSON.stringify([...samples.get(family).values()]));
  }
  process.exit(0);
}
let pages=0,tables=0,fallbacks=0,merged=0;const decades=new Set();
const all=process.argv.includes('--all');
const names=['kh1958503000.pdf','kh1964411120.pdf','kh1979103000.pdf','kh1989105000.pdf','kh1992205000.pdf','kh2009105000.pdf','KH2019102030.pdf','铁路客货运输2022-2、3.pdf','铁路客货运输2025-1.pdf'];
for(const doc of catalog.docs.filter(d=>all||names.includes(d.file))){
 for(let p=0;p<doc.pages;p++){
  const pageOffsets=new Set();
  for(const block of parsePage(doc,p).filter(b=>b.type.startsWith('table'))){
   for(const run of block.runs){assert(!pageOffsets.has(run.a),`${doc.file}:${p+1} duplicated table text`);pageOffsets.add(run.a);}
   tables++;decades.add(Math.floor(doc.year/10)*10);
   if(block.type==='table-layout'){fallbacks++;continue;}
   const count=block.rows.length*block.columns,seen=new Uint8Array(count),offsets=[];
   for(const row of block.rows)for(const cell of row){
    if(cell.r1>cell.r0||cell.c1>cell.c0)merged++;
    for(let r=cell.r0;r<=cell.r1;r++)for(let c=cell.c0;c<=cell.c1;c++)assert.equal(seen[r*block.columns+c]++,0,`${doc.file}:${p+1} overlapping cell`);
    offsets.push(...cell.runs.map(r=>r.a));
    assert.equal(cell.lines.reduce((n,l)=>n+l.runs.length,0),cell.runs.length);
   }
   assert(seen.every(v=>v===1),`${doc.file}:${p+1} missing cell`);
   assert.deepEqual(offsets.sort((a,b)=>a-b),block.runs.map(r=>r.a).sort((a,b)=>a-b));
   if(doc.file==='铁路客货运输2022-2、3.pdf' && p===44){
    assert.equal(block.columns,6);assert.equal(block.rows.length,18);
    const texts=block.rows.map(row=>row.map(c=>c.runs.map(r=>r.text).join('')));
    for(const [station,first,last] of [['北京丰台','—','2291'],['杜家坎所','10','2281'],['涿州东','55','2236'],['郑州东','686','1605']]){
     const row=texts.slice(2).find(r=>r.some(t=>t.includes(station)));assert(row,station);assert(row.includes(first)&&row.includes(last),`${station} mileage row`);
    }
    assert(block.rows[0].some(c=>c.c1-c.c0===1 && c.runs.some(r=>r.text==='本线里程')));
   }
  }
  pages++;
 }
}
console.log(`通过：${pages} 页，${tables} 个表格区域，${merged} 个合并单元格；${fallbacks} 个复杂区域保留位置；年代 ${[...decades].sort().join('、')}。`);


const issue = catalog.docs.find(doc => doc.file === '铁路客货运输2022-2、3.pdf');
if (issue) {
  const readerSource = fs.readFileSync(path.join(root, 'offline/reader.js'), 'utf8');
  const tableHTML = new Function('normalize', 'escapeHtml', 'terms', 'tableProfile', 'tableCellRuns',
    readerSource + ';return tableHTML'
  )(s => s.normalize('NFKC').toLowerCase(), s => s, ['丰沙'], tableProfile, tableCellRuns);
  const cases = [
    ['京广高铁客运运价里程表', 44, '广州南', 44],
    ['京广线客运运价里程表', 46, '广州', 80],
    ['京原线客运运价里程表', 50, '原平', 45]
  ];
  for (const [title, start, destination, rowCount] of cases) {
    const entry = issue.entries.find(e => e.title === title && e.p === start);
    assert(entry);
    const blocks = [];
    for (const part of entry.parts) {
      const fresh = parsePage(issue, part.p, part, entry.title);
      joinTableContinuation(blocks.at(-1), fresh);
      blocks.push(...fresh);
    }
    const tables = blocks.filter(block => block.type === 'table');
    assert.equal(tables.length, 1, title);
    const [table] = tables;
    assert.equal(table.rows.length, rowCount, title);
    assert(table.rows[1].some(cell => tableCellText(cell) === destination), title);
    const html = tableHTML(table);
    assert.equal((html.match(/>本线里程<\//g) || []).length, 1, title);
    assert(!blocks.some(block => block.type === 'paragraph' &&
      block.runs.map(run => run.text).join('') === '续上表'), title);
    assert(table.runs.some(run => run.p === entry.parts.at(-1).p), title);
    if (title === '京广线客运运价里程表') {
      const stations = [...html.matchAll(/<td class="table-station"[^>]*>(.*?)<\/td>/g)];
      assert(stations.find(match => match[1].includes('□') && match[1].includes('北京丰台'))[1].includes('station-line'));
      assert(stations.find(match => match[1].replace(/<[^>]+>/g, '').includes('高碑店'))[1].includes('<span></span>'));
      const prose = html.match(/<td class="table-prose"[^>]*>(.*?)<\/td>/)[1];
      assert(!/<div|<br/.test(prose));
      assert.match(prose, /<mark[^>]*><span[^>]*>丰<\/span><span[^>]*>沙<\/span><\/mark>/);
    }
  }
  console.log('通过：三张跨页里程表分别连续，表头唯一，原页定位保留，站名前缀占位一致，跨断行词组可高亮。');
}

const historicalCases = [
  ['kh1958509000.pdf', '重新公布朝鲜铁路开办联运业务站名表', 'table'],
  ['kh1979102000.pdf', '关于重新公布《铁路各营业站最大起重能力表》的通知', 'table-series']
];
for (const [file, title, type] of historicalCases) {
  const doc = catalog.docs.find(d => d.file === file);
  if (!doc) continue;
  const entry = doc.entries.find(e => e.title === title);
  assert(entry);
  const blocks = [];
  for (const part of entry.parts) {
    const fresh = parsePage(doc, part.p, part, title);
    joinTableContinuation(blocks.at(-1), fresh);
    blocks.push(...fresh);
  }
  const tables = blocks.filter(block => block.type.startsWith('table'));
  assert.equal(tables.length, 1, title);
  assert.equal(tables[0].type, type, title);
  assert(!blocks.some(block => block.type === 'paragraph' &&
    block.runs.map(run => run.text).join('') === '续上表'), title);
  if (type === 'table') {
    // The original has no bottom rule below station 30, on PDF page 21.
    const row = tables[0].rows.find(cells => cells.some(cell => tableCellText(cell) === '30'));
    assert.deepEqual(row.map(tableCellText), ['30', '平壤管理局', '木宰洞Зедон', '1—381', '']);
  } else {
    assert.equal(tables[0].tables.length, 16);
  }
  console.log(`通过：${title}的跨页衔接。`);
}
