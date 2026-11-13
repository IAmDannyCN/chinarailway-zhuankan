'use strict';

const readingCoordinates = new Map();

function loadReadingPage(document, number) {
  const key = `${document.id}:${number}`;
  if (window.PAGE_HTML[key]) return Promise.resolve(window.PAGE_HTML[key]);
  if (coordinateRequests[key]) return coordinateRequests[key];
  coordinateRequests[key] = new Promise((resolve, reject) => {
    const script = window.document.createElement('script');
    script.src = `data/${document.id}/${number + 1}.page.js`;
    script.onload = async () => {
      script.remove();
      try {
        const packed = window.PAGE_PACKED[key];
        if (packed) {
          const bytes = Uint8Array.from(atob(packed), character => character.charCodeAt(0));
          const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
          const decoded = await new Response(stream).text();
          const separator = decoded.indexOf('\n');
          readingCoordinates.set(key, JSON.parse(decoded.slice(0, separator)));
          window.PAGE_HTML[key] = decoded.slice(separator + 1);
        } else {
          readingCoordinates.set(key, window.PAGE_COORDS[key] || []);
        }
        const markup = window.PAGE_HTML[key];
        if (!markup) throw new Error('阅读数据为空');
        coordinateOrder.push(key);
        while (coordinateOrder.length > 30) {
          const oldest = coordinateOrder.shift();
          readingCoordinates.delete(oldest);
          delete window.PAGE_HTML[oldest];
        }
        resolve(markup);
      } catch (error) {
        reject(error);
      } finally {
        delete window.PAGE_PACKED[key];
        delete window.PAGE_COORDS[key];
        delete coordinateRequests[key];
      }
    };
    script.onerror = () => {
      delete coordinateRequests[key];
      script.remove();
      reject(new Error('无法加载定位数据'));
    };
    window.document.head.append(script);
  });
  return coordinateRequests[key];
}

function clearPreview() {
  selected = null;
  readerDocument = null;
  renderSerial++;
  hits = [];
  hitIndex = -1;
  $('pageStack').replaceChildren();
  $('pageStack').hidden = true;
  $('previewEmpty').hidden = false;
  $('previewEmpty').textContent = '无匹配原文';
  $('documentName').textContent = '';
  $('previewTitle').textContent = '';
  $('printedPage').textContent = '';
  $('printedPage').disabled = true;
  $('original').removeAttribute('href');
  $('original').setAttribute('aria-disabled', 'true');
  $('pageInput').value = '';
  $('pageTotal').textContent = '—';
  $('findControls').hidden = true;
  for (const id of ['prevPage', 'nextPage', 'pageInput', 'prevHit', 'nextHit', 'copySource', 'zoomIn', 'zoomOut', 'zoomSelect', 'openIssueHere']) $(id).disabled = true;
}

function updateFindControls() {
  $('findControls').hidden = !!issueView || !terms.length;
  $('findTerm').textContent = terms.join(' ');
  $('findTerm').title = terms.join(' ');
  $('hitCounter').textContent = `${hitIndex < 0 ? '—' : hitIndex + 1} / ${hits.length}`;
  $('hitCounter').setAttribute('aria-label', hitIndex < 0 ? `${hits.length} 处匹配` : `第 ${hitIndex + 1} 处，共 ${hits.length} 处匹配`);
  $('prevHit').disabled = !hits.length;
  $('nextHit').disabled = !hits.length;
}


let articleFamily=[], articleMarks=[];
function updateReadingPosition() {
  if(!readerDocument)return;
  $('pageInput').value=page+1;$('pageTotal').textContent=readerDocument.pages;
  $('printedPage').textContent = readerDocument.labels[page] ? `原刊 ${readerDocument.labels[page]}` : `PDF ${page + 1}`;
  $('printedPage').disabled = !!issueView;
  $('original').href = originalURL(readerDocument, page);
  $('openIssueHere').disabled = false;
  $('original').removeAttribute('aria-disabled');
  for(const id of ['pageInput','copySource','zoomIn','zoomOut','zoomSelect'])$(id).disabled=false;
  $('prevPage').disabled=page===0;$('nextPage').disabled=page===readerDocument.pages-1;
  updateFindControls();
}
function decodeFlow(document, number, markup) {
  const end = markup.indexOf('</svg>') + '</svg>'.length;
  const xml = new DOMParser().parseFromString(markup.slice(0, end), 'image/svg+xml');
  let offset=0;
  let runs=[...xml.querySelectorAll('text')].map(node=>{
    const text=node.textContent,a=offset;offset+=text.length;
    return {text,a,b:offset,line:node.getAttribute('data-line'),x:Number(node.getAttribute('x')),y:Number(node.getAttribute('y')),width:Number(node.getAttribute('textLength')),size:Number(node.getAttribute('font-size')),bold:node.getAttribute('font-weight')==='bold',underline:node.getAttribute('text-decoration')==='underline',p:number};
  });
  const media = [...markup.slice(end).matchAll(
    /<img data-kind="(layout|image)"(?: data-owner="(\d+)")? data-a="(\d+)" data-b="(\d+)" width="(\d+)" height="(\d+)" src="(data:image\/png;base64,[A-Za-z0-9+/=]+)">/g
  )].map(([, kind, owner, a, b, width, height, src]) => ({
    type: 'media', kind, owner: owner == null ? null : Number(owner),
    a: Number(a), b: Number(b), width: Number(width), height: Number(height), p: number, src
  }));
  const rules = [...xml.querySelectorAll('path')].map(node => node.getAttribute('d'));
  const coordinates = readingCoordinates.get(`${document.id}:${number}`) || [];
  const regions = JSON.parse(xml.documentElement.getAttribute('data-regions') || '[]');
  for(const entry of document.entries.filter(entry=>entry.p===number && /^附件\d$/.test(entry.attachmentLabel||''))) {
    const at=entry.a+2;
    if(!/^附件[员圆猿源缘远苑愿怨]/.test(document.texts[number].slice(entry.a,entry.a+4)))continue;
    const run=runs.find(run=>run.a<=at && run.b>at);
    if(run)run.text=run.text.slice(0,at-run.a)+entry.attachmentLabel.at(-1)+run.text.slice(at-run.a+1);
  }
  runs = splitReadingColumns(runs, rules, coordinates, ...document.sizes[number]);
  for (const run of runs) {
    run.pageCoordinates=coordinates;
    run.pageSize=document.sizes[number];
    run.graphicChars=Object.fromEntries(regions.filter(region=>region.kind==='symbol' && region.b>region.a && region.a<run.b && region.b>run.a).flatMap(region=>(region.offsets||Array.from({length:region.b-region.a},(_,i)=>region.a+i)).map(offset=>[offset,{...region,text:region.offsets?region.offsets.map(offset=>document.texts[number][offset]).join(''):document.texts[number].slice(region.a,region.b)}])));
    run.graphicPage={src:`data/${document.id}/${number+1}.original.webp`,size:document.sizes[number]};
    if (/[\ue000-\uf8ff]/.test(run.text)) {
      run.symbols = coordinates.slice(run.a, run.b);
      run.symbolStart = run.a;
      run.symbolPage = {src: `data/${document.id}/${number + 1}.original.webp`, size: document.sizes[number]};
    }
  }
  if (document.originalPages) verifyReadingUnderlines(runs, rules);
  return {runs, media, rules, regions,
    sourceOnly: xml.documentElement.dataset?.source === 'true' || xml.documentElement.getAttribute('data-source') === 'true',
    coordinates,
    width:document.sizes[number][0],height:document.sizes[number][1]};
}

function readingPartBlocks(decoded, part, entry, original = false) {
  const {runs, rules, width, height} = decoded;
  const document = entry.document;
  const pageLength = document.texts[part.p].length;
  const title = entry.heading === false ? '' : entry.title;
  if (document.originalPages) {
    const source = () => [originalBlock(document, part, decoded, original)];
    if (original || decoded.sourceOnly) {
      return [originalBlock(document, {p: part.p, a: 0, b: pageLength}, decoded, true)];
    }
    if (['目录', '待核对'].includes(entry.kind)) return source();
    return regionalReadingBlocks(decoded,part,entry,title);
  }
  const media = decoded.media.filter(item =>
    item.owner == null
      ? item.a >= part.a && (item.a < part.b || item.a === part.b && part.b === pageLength)
      : item.owner === part.a);
  const blocks = [];
  let start = part.a;
  for (const item of media) {
    if (item.a < start || item.a > part.b || item.b > part.b) continue;
    if (item.a > start) blocks.push(...articleBlocks(runs, rules, width, height, {...part, a: start, b: item.a}, title));
    blocks.push(item.kind === 'layout'
      ? {...item, runs: sliceReadingRuns(runs, item.a, item.b)} : item);
    start = item.b;
  }
  if (start < part.b) blocks.push(...articleBlocks(runs, rules, width, height, {...part, a: start}, title));
  return blocks;
}

function regionContains(rect,x,y,padding=.3) {
  return x>=rect[0]-padding && x<=rect[2]+padding && y>=rect[1]-padding && y<=rect[3]+padding;
}
function regionRules(rules,rects,inverse=false) {
  return readingRules(rules).filter(rule=>{
    const inside=rects.some(rect=>regionContains(rect,rule.h?(rule.a+rule.b)/2:rule.v,rule.h?rule.v:(rule.a+rule.b)/2));
    return inverse?inside:!inside;
  }).map(rule=>rule.h?`M${rule.a},${rule.v}L${rule.b},${rule.v}`:`M${rule.v},${rule.a}L${rule.v},${rule.b}`);
}
function readingBounds(runs,width,height,padding=2,graphics=[]) {
  if(!runs.length)return [0,0,width,height];
  return [Math.max(0,Math.min(...runs.map(run=>run.x),...graphics.map(graphic=>graphic.rect[0]))-padding),
    Math.max(0,Math.min(...runs.map(run=>run.y-run.size*.9),...graphics.map(graphic=>graphic.rect[1]))-padding),
    Math.min(width,Math.max(...runs.map(run=>run.inkRight??run.x+run.width),...graphics.map(graphic=>graphic.rect[2]))+padding),
    Math.min(height,Math.max(...runs.map(run=>run.y+run.size*.3),...graphics.map(graphic=>graphic.rect[3]))+padding)];
}
function croppedOriginal(document,part,decoded,rect,kind='layout',specificRuns) {
  const {width,height}=decoded;
  const block=originalBlock(document,part,decoded,false);
  const runs=specificRuns || sliceReadingRuns(decoded.runs,part.a,part.b).filter(run=>
    regionContains(rect,run.x+run.width/2,run.y-run.size*.3));
  const offsets=runs.flatMap(run=>Array.from({length:run.text.length},(_,i)=>run.a+i));
  const glyphWidths=decoded.runs.flatMap(run=>[...run.text].flatMap((ch,i)=>/[\u4e00-\u9fff]/.test(ch) && decoded.coordinates[run.a+i]?.[2]>0?[decoded.coordinates[run.a+i][2]*width/100]:[])).sort((a,b)=>a-b);
  const sourceEm=glyphWidths[Math.floor(glyphWidths.length/2)]||10;
  return {...block,region:true,kind,displayWidth:(rect[2]-rect[0])/sourceEm,left:rect[0]/width*100,top:rect[1]/height*100,
    right:rect[2]/width*100,bottom:rect[3]/height*100,runs,offsets,
    a:runs[0]?.a??part.a,text:runs.map(run=>run.text).join(''),
    anchors:runs.map(run=>({a:run.a,y:run.y/height*100,x:run.x/width*100}))};
}
function regionalReadingBlocks(decoded,part,entry,title) {
  const {width,height}=decoded,document=entry.document;
  const regions=(decoded.regions||[]).filter(region=>region.a<part.b && region.b>part.a ||
    region.a===region.b && region.a>=part.a && (region.a<part.b || part.b===document.texts[part.p].length));
  const figures=regions.filter(region=>region.kind!=='symbol').map(region=>({...region,rect:region.rect.slice()}));
  if(figures.length) {
    const grids=tableRegions(sliceReadingRuns(decoded.runs,part.a,part.b),decoded.rules,width,true);
    for(const region of figures)for(const grid of grids) {
      const [x0,y0,x1,y1]=region.rect;
      if(Math.min(x1,grid.right)-Math.max(x0,grid.left)<=1 || Math.min(y1,grid.bottom)-Math.max(y0,grid.top)<=1)continue;
      // A picture/rotated label crossing a grid cannot be removed along with
      // some of its internal rules and then masquerade as a merged HTML cell.
      region.rect=[Math.min(x0,grid.left-1),Math.min(y0,grid.top-1),Math.max(x1,grid.right+1),Math.max(y1,grid.bottom+1)];
      region.kind='layout';
    }
  }
  const visible=sliceReadingRuns(decoded.runs,part.a,part.b).filter(run=>!figures.some(region=>
    regionContains(region.rect,run.x+run.width/2,run.y-run.size*.3)));
  const rules=regionRules(decoded.rules,figures.map(region=>region.rect));
  const clean={...decoded,runs:visible,rules};
  const fresh=articleBlocks(visible,rules,width,height,{...part,strict:true},title);
  if(!fresh.length && !figures.length)return [originalBlock(document,part,decoded,false)];
  const structured=fresh.filter(block=>block.type==='table');
  const symbols=regions.filter(region=>region.kind==='symbol' && region.a===region.b &&
    !figures.some(figure=>regionContains(figure.rect,(region.rect[0]+region.rect[2])/2,(region.rect[1]+region.rect[3])/2)));
  const looseSymbols=[];
  for(const region of symbols) {
    const [x0,y0,x1,y1]=region.rect,x=(x0+x1)/2,y=(y0+y1)/2;
    const table=structured.find(table=>regionContains([table.left,table.top,table.right,table.bottom],x,y));
    const cell=table?.rows.flat().find(cell=>regionContains([table.xs[cell.c0],table.ys[cell.r0],table.xs[cell.c1+1],table.ys[cell.r1+1]],x,y));
    if(cell){(cell.graphics??=[]).push({...region,p:part.p,src:`data/${document.id}/${part.p+1}.original.webp`,size:[width,height]});}
    else {
      const candidates=fresh.filter(block=>['paragraph','heading','annotation'].includes(block.type) && block.runs?.some(run=>
        Math.abs(run.y-y)<Math.max(2.5,(y1-y0)*.7) && Math.min(Math.abs(run.x+run.width-x0),Math.abs(run.x-x1))<Math.max(run.size*3,(x1-x0)*2)));
      if(candidates.length) {
        const chosen=candidates[0];
        (chosen.graphics??=[]).push({...region,p:part.p,src:`data/${document.id}/${part.p+1}.original.webp`,size:[width,height]});
        for(const other of candidates.slice(1)) {
          chosen.runs.push(...other.runs);
          if(other.graphics)chosen.graphics.push(...other.graphics);
          fresh.splice(fresh.indexOf(other),1);
        }
        chosen.runs.sort((a,b)=>Math.abs(a.y-b.y)>Math.max(a.size,b.size)*.65?a.y-b.y:a.x-b.x);
      } else looseSymbols.push(region);
    }
  }
  if(!figures.length && !looseSymbols.length && canDisplayReadingPart(fresh,clean,part))return fresh;
  const blocks=[];
  let zone=[];
  const flush=()=>{
    if(!zone.length)return;
    const zoneRuns=zone.flatMap(block=>block.runs||[]);
    if(!zoneRuns.length){blocks.push(...zone);zone=[];return;}
    const bounds=readingBounds(zoneRuns,width,height,2,zone.flatMap(block=>block.graphics||[]));
    const zoneDecoded={...clean,runs:zoneRuns,rules:regionRules(rules,[bounds],true)};
    if(canDisplayReadingPart(zone,zoneDecoded,part)){blocks.push(...zone);zone=[];return;}
    const checks=zone.map(block=>{
      const box=readingBounds(block.runs||[],width,height,2,block.graphics);
      return {block,box,valid:canDisplayReadingPart([block],{...clean,runs:block.runs||[],rules:regionRules(rules,[box],true)},part)};
    });
    // Repeated narrow lanes across several rows cannot be validated in isolation.
    if(checks.every(item=>item.valid))blocks.push(croppedOriginal(document,part,decoded,bounds,'layout',zoneRuns));
    else {
      let failed=[];
      const emit=()=>{if(failed.length){const runs=failed.flatMap(item=>item.block.runs||[]);blocks.push(croppedOriginal(document,part,decoded,readingBounds(runs,width,height,2,failed.flatMap(item=>item.block.graphics||[])),'layout',runs));failed=[];}};
      for(const item of checks){if(item.valid){emit();blocks.push(item.block);}else failed.push(item);}
      emit();
    }
    zone=[];
  };
  for(const block of fresh) {
    if(block.type==='table-layout') {
      flush();blocks.push(croppedOriginal(document,part,decoded,
        [Math.max(0,block.left-1),Math.max(0,block.top-1),Math.min(width,block.right+1),Math.min(height,block.bottom+1)],'layout',block.runs));
    }else if(block.type==='table' || block.type==='table-series'){flush();blocks.push(block);}
    else zone.push(block);
  }
  flush();
  for(const region of [...figures,...looseSymbols])blocks.push({...croppedOriginal(document,part,decoded,region.rect,region.kind),textReliable:region.textReliable});
  const top=block=>block.top!=null?(block.type==='source'?block.top*height/100:block.top):Math.min(...(block.runs||[]).map(run=>run.y-run.size*.7));
  return mergeReadingCrops(blocks,document,part,decoded).sort((a,b)=>top(a)-top(b));
}

function mergeReadingCrops(blocks,document,part,decoded) {
  const rect=block=>[block.left,block.top,block.right,block.bottom];
  const overlap=(a,b)=>Math.min(a[2],b[2])-Math.max(a[0],b[0])>.05 && Math.min(a[3],b[3])-Math.max(a[1],b[1])>.05;
  const groups=blocks.filter(block=>block.type==='source' && block.region).map(block=>({box:rect(block),members:new Set([block])}));
  for(let changed=true;changed;) {
    changed=false;
    for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++) {
      const a=groups[i].box,b=groups[j].box;
      const xOverlap=Math.min(a[2],b[2])-Math.max(a[0],b[0]);
      const bothLayouts=[...groups[i].members,...groups[j].members].every(block=>block.kind==='layout');
      const close=bothLayouts && xOverlap>Math.min(a[2]-a[0],b[2]-b[0])*.35 && Math.max(a[1],b[1])-Math.min(a[3],b[3])<1.5;
      if(!overlap(a,b) && !close)continue;
      groups[i].box=[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])];
      groups[j].members.forEach(block=>groups[i].members.add(block));groups.splice(j--,1);changed=true;
    }
    for(const group of groups)for(const block of blocks) {
      if(group.members.has(block) || block.type==='source' || block.type.startsWith('table') || !block.runs?.length)continue;
      const points=readingBounds(block.runs,decoded.width,decoded.height,0);
      const box=[points[0]/decoded.width*100,points[1]/decoded.height*100,points[2]/decoded.width*100,points[3]/decoded.height*100];
      if(!overlap(group.box,box))continue;
      group.members.add(block);
      group.box=[Math.min(group.box[0],box[0]),Math.min(group.box[1],box[1]),Math.max(group.box[2],box[2]),Math.max(group.box[3],box[3])];changed=true;
    }
  }
  const consumed=new Set(groups.flatMap(group=>[...group.members]));
  const result=blocks.filter(block=>!consumed.has(block));
  for(const group of groups) {
    const unique=new Map([...group.members].flatMap(block=>block.runs||[]).map(run=>[run.a,run]));
    const runs=[...unique.values()].sort((a,b)=>a.a-b.a);
    const box=[group.box[0]*decoded.width/100,group.box[1]*decoded.height/100,group.box[2]*decoded.width/100,group.box[3]*decoded.height/100];
    const members=[...group.members];
    const kind=members.every(block=>block.kind===members[0].kind)?members[0].kind:'layout';
    result.push({...croppedOriginal(document,part,decoded,box,kind,runs),textReliable:members.every(block=>block.textReliable!==false)});
  }
  return result;
}

function originalBlock(document, part, decoded, wholePage) {
  const {coordinates, runs, width, height} = decoded;
  let top = 0, bottom = 100;
  if (!wholePage && part.a < part.b && (part.a > 0 || part.b < coordinates.length)) {
    const before = coordinates.slice(0, part.a).reduce((y, box) => Math.max(y, box[1] + box[3]), 0);
    const after = coordinates.slice(part.b).reduce((y, box) => Math.min(y, box[1]), 100);
    const [min, max] = coordinates.slice(part.a, part.b).reduce(([a, b], box) =>
      [Math.min(a, box[1]), Math.max(b, box[1] + box[3])], [100, 0]);
    if (before <= min && max <= after) {
      top = (before + min) / 2;
      bottom = (after + max) / 2;
      if (!part.a) top = 0;
      if (part.b === coordinates.length) bottom = 100;
    }
  }
  const anchors = document.entries.filter(entry => entry.p === part.p && entry.a > part.a && entry.a < part.b)
    .map(entry => ({a: entry.a, y: coordinates[entry.a]?.[1]})).filter(anchor => anchor.y != null);
  return {...part, type: 'source', width, height, top, bottom, coordinates,
    anchors,
    runs: sliceReadingRuns(runs, part.a, part.b), text: document.texts[part.p].slice(part.a, part.b),
    src: `data/${document.id}/${part.p + 1}.original.webp`, original: originalURL(document, part.p)};
}

function partsWithImagePages(entry) {
  const media = new Set(entry.document.mediaPages || []);
  if (!media.size) return entry.parts;
  const parts = [];
  entry.parts.forEach((part, index) => {
    parts.push(part);
    if (part.b !== entry.document.texts[part.p].length) return;
    const limit = entry.parts[index + 1]?.p ?? entry.document.pages;
    for (let p = part.p + 1; p < limit && !entry.document.texts[p]; p++) {
      if (media.has(p)) parts.push({p, a: 0, b: 0});
    }
  });
  return parts;
}
function readingMatches(text) {
  let normalized='',offset=0;
  const mapping=[];
  for(const ch of text){const value=normalize(ch);normalized+=value;for(let i=0;i<value.length;i++)mapping.push([offset,offset+ch.length]);offset+=ch.length;}
  const ranges=[];
  for(const term of terms){if(!term)continue;let at=0;while((at=normalized.indexOf(term,at))>=0){ranges.push([mapping[at][0],mapping[at+term.length-1][1]]);at+=term.length;}}
  ranges.sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for(const [a,b] of ranges){const last=merged.at(-1);if(last && a<last[1])last[1]=Math.max(last[1],b);else merged.push([a,b]);}
  return merged;
}

function readingListMarker(text) {
  const plain=/^\s*[0-9０-９]{1,3}[.．。\ue010](?![0-9０-９])/.exec(text);
  if(plain)return {end:plain[0].length,dot:plain[0].length-1};
  const nested=/^\s*[0-9０-９]{1,3}(?:[.．][0-9０-９]{1,3}){1,4}(?![0-9０-９.．])/.exec(text);
  if(nested && /^\s*[\u4e00-\u9fff（(]/.test(text.slice(nested[0].length)) &&
      !/^\s*(?:公里|千米|毫米|厘米|立方|千克|小时|分钟|毫|米|吨|元|日|月|年|分|秒)/.test(text.slice(nested[0].length)))return {end:nested[0].length};
  const bracket=/^\s*[（(](?:[0-9０-９]{1,3}|[一二三四五六七八九十]+)[）)]/.exec(text);
  return bracket?{end:bracket[0].length}:null;
}

function readingPunctuation(text) {
  const protectedAt=new Uint8Array(text.length);
  const token=/(?:https?|ftp):\/\/[A-Za-z0-9_~:/?#@!$&'()*+,;=%.-]+|[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+|[A-Za-z]:[\\/][A-Za-z0-9_ .\\/-]+|[A-Za-z0-9_-]+\.(?:pdf|docx?|xlsx?|csv|html?|js|py|zip)\b/gi;
  for(const match of text.matchAll(token))protectedAt.fill(1,match.index,match.index+match[0].length);
  const marker=readingListMarker(text);
  const marks={',':'，',':':'：',';':'；','?':'？','!':'！','(':'（',')':'）'};
  return text.split('').map((ch,i)=>{
    if(protectedAt[i])return ch;
    if(i===marker?.dot)return '.';
    if(ch==='.' || ch===':') {
      if(/[0-9０-９]/.test(text[i-1]||'') && /[0-9０-９]/.test(text[i+1]||''))return ch;
      if(ch==='.')return /[A-Za-z]/.test(text[i-1]||'') && /[A-Za-z]/.test(text[i+1]||'')?'.':
        /^[0-9０-９]+$/.test(text.slice(0,i).trim())?'．':'。';
    }
    return marks[ch]||ch;
  }).join('');
}

function readingRunOffset(run,index) {
  return run.sourceOffsets?.[index]??run.a+index;
}

// Symbols can be missing from the PDF text layer, or consist of two glyphs
// extracted far apart. Insert their visible token between source characters,
// rather than appending it after an entire extraction run or table cell.
function readingRunsWithGraphics(runs,graphics=[]) {
  if(!graphics.length && !runs.some(run=>Object.keys(run.graphicChars||{}).length))return runs;
  const raw=runs.map(run=>run.text).join(''),display=readingPunctuation(raw),normalDots=new Set();
  let pos=0;
  for(const run of runs)for(let i=0;i<run.text.length;i++,pos++) {
    if(display[pos]==='.' && /[．。\ue010]/.test(run.text[i]))normalDots.add(`${run.p}:${readingRunOffset(run,i)}`);
  }
  const native=new Map();
  for(const run of runs)for(const graphic of Object.values(run.graphicChars||{})) {
    const offsets=graphic.offsets||Array.from({length:graphic.b-graphic.a},(_,i)=>graphic.a+i);
    if(offsets.length && offsets.every(offset=>normalDots.has(`${run.p}:${offset}`)))continue;
    const key=JSON.stringify([run.p,graphic.rect,graphic.a,graphic.b,graphic.offsets]);
    if(!native.has(key))native.set(key,{...graphic,p:run.p,...run.graphicPage});
  }
  if(!native.size && !graphics.length)return runs;
  const characters=runs.flatMap(run=>Array.from({length:run.text.length},(_,i)=>({
    run,index:i,text:run.text[i],offset:readingRunOffset(run,i)
  })));
  const nativeOffsets=new Map();
  const tokens=[];
  for(const graphic of native.values()) {
    const offsets=graphic.offsets||Array.from({length:graphic.b-graphic.a},(_,i)=>graphic.a+i);
    nativeOffsets.set(graphic,new Set(offsets));
    // A secondary source glyph may fall in a separate rendering group. It is
    // suppressed there; only the group containing the primary draws the symbol.
    if(characters.some(ch=>ch.run.p===graphic.p && ch.offset===offsets[0]))tokens.push({...graphic,sourceOffsets:offsets});
  }
  const plain=characters.filter(ch=>![...nativeOffsets].some(([graphic,offsets])=>
    ch.run.p===graphic.p && offsets.has(ch.offset)));
  tokens.push(...graphics.map(graphic=>({...graphic,text:'\ufffc',sourceOffsets:[graphic.a]})));
  const inserted=new Map();
  function geometry(ch) {
    const box=ch.run.pageCoordinates?.[ch.offset],size=ch.run.pageSize;
    return box && size ? {x:box[0]*size[0]/100,y:(box[1]+box[3]/2)*size[1]/100} :
      {x:ch.run.x+ch.run.width*ch.index/Math.max(1,ch.run.text.length),y:ch.run.tableY??ch.run.y-ch.run.size*.3};
  }
  for(const graphic of tokens) {
    const [x0,y0,x1,y1]=graphic.rect,center=(y0+y1)/2,middle=(x0+x1)/2;
    const sameLine=plain.map((ch,index)=>({ch,index,point:geometry(ch)})).filter(({ch,point})=>
      ch.run.p===graphic.p && Math.abs(point.y-center)<Math.max(3,(y1-y0)*.85,ch.run.size*.6));
    let at=-1;
    if(graphic.a===graphic.b) {
      // The insertion offset points at the next real source character (often
      // the punctuation inside a two-character run such as "为。").
      at=sameLine.find(item=>item.ch.offset===graphic.a)?.index??-1;
    } else {
      const next=Math.max(...graphic.sourceOffsets)+1;
      at=sameLine.find(item=>item.ch.offset===next && item.point.x>=middle-.35)?.index??-1;
    }
    if(at<0 && sameLine.length) {
      // Isolated vector glyphs include padding beyond their ink. The symbol
      // center, not its padded right edge, separates it from the next glyph.
      const after=sameLine.filter(item=>item.point.x>=middle-.35).sort((a,b)=>a.point.x-b.point.x);
      at=after[0]?.index??sameLine.sort((a,b)=>b.point.x-a.point.x)[0].index+1;
    }
    if(at<0) {
      const primary=characters.findIndex(ch=>ch.run.p===graphic.p && ch.offset===graphic.sourceOffsets[0]);
      at=primary<0?plain.length:characters.slice(0,primary).filter(ch=>plain.includes(ch)).length;
    }
    const text=graphic.text||'\ufffc',a=graphic.sourceOffsets[0]??graphic.a;
    const token={text,a,b:a+text.length,p:graphic.p,x:x0,y:y1,width:x1-x0,size:y1-y0,
      sourceOffsets:graphic.sourceOffsets,graphicChars:Object.fromEntries(graphic.sourceOffsets.map(offset=>[offset,graphic])),
      graphicPage:{src:graphic.src,size:graphic.size}};
    if(!inserted.has(at))inserted.set(at,[]);
    inserted.get(at).push(token);
  }
  const result=[];
  for(let i=0;i<=plain.length;i++) {
    if(inserted.has(i))result.push(...inserted.get(i).sort((a,b)=>a.x-b.x));
    if(i===plain.length)break;
    const ch=plain[i],previous=result.at(-1);
    if(previous?._sourceRun===ch.run && previous._lastIndex===ch.index-1) {
      previous.text+=ch.text;previous.sourceOffsets.push(ch.offset);previous.b=ch.offset+1;previous._lastIndex=ch.index;
    } else result.push({...ch.run,text:ch.text,a:ch.offset,b:ch.offset+1,sourceOffsets:[ch.offset],_sourceRun:ch.run,_lastIndex:ch.index});
  }
  return result;
}

function readingGraphicsByGroup(groups,graphics=[]) {
  const assigned=groups.map(()=>[]);
  for(const graphic of graphics) {
    const y=(graphic.rect[1]+graphic.rect[3])/2;
    const distances=groups.map(group=>{
      if(group.p===graphic.p && Number.isFinite(group.sourceY))return Math.abs(group.sourceY-y);
      const runs=group.runs.filter(run=>run.p===graphic.p);
      if(!runs.length)return Infinity;
      const centers=runs.map(run=>run.tableY??run.y-run.size*.3).sort((a,b)=>a-b);
      return Math.abs((group.sourceY??centers[Math.floor(centers.length/2)])-y);
    });
    const closest=Math.min(...distances);
    if(Number.isFinite(closest))assigned[distances.indexOf(closest)].push(graphic);
  }
  return assigned;
}

function readingCodeRuns(runs) {
  return runs.flatMap(run=>{
    if(!run.pageCoordinates || !run.pageSize)return [run];
    return Array.from({length:run.text.length},(_,i)=>{
      const offset=readingRunOffset(run,i),box=run.pageCoordinates[offset];
      if(!box)return {...run,text:run.text[i],a:offset,b:offset+1,sourceOffsets:[offset]};
      const x=box[0]*run.pageSize[0]/100,width=box[2]*run.pageSize[0]/100;
      return {...run,text:run.text[i],a:offset,b:offset+1,sourceOffsets:[offset],x,width,inkRight:x+width};
    });
  });
}

function inlineRuns(runs,options={}) {
  runs=readingRunsWithGraphics(runs,options.graphics);
  const text = runs.map(run => run.text).join('');
  const display=readingPunctuation(text);
  const marker=options.paragraph?readingListMarker(text):null;
  const merged = readingMatches(text).map(([a,b])=>{
    const loc=location(a);
    let cursor=0,graphic;
    for(const run of runs){if(a>=cursor && a<cursor+run.text.length){graphic=run.graphicChars?.[readingRunOffset(run,a-cursor)];break;}cursor+=run.text.length;}
    if(graphic && b-a===1) {
      let pos=0;
      const primary=graphic.offsets?.[0]??graphic.a;
      for(const run of runs){const index=Array.from({length:run.text.length},(_,i)=>readingRunOffset(run,i)).indexOf(primary);if(index>=0)return {a:pos+index,b:pos+index+1,loc};pos+=run.text.length;}
    }
    return {a,b,loc};
  }).sort((a,b)=>a.a-b.a).filter((hit,index,list)=>!index || hit.a!==list[index-1].a || hit.b!==list[index-1].b);
  function slice(a,b){
    let pos=0,out='';
    for(const run of runs){
      const start=Math.max(0,a-pos),end=Math.min(run.text.length,b-pos);
      if(end>start){
        const cuts=[start];
        if(marker && marker.end>pos+start && marker.end<pos+end)cuts.push(marker.end-pos);
        cuts.push(end);
        for(let i=0;i<cuts.length-1;i++){
          const from=cuts[i],to=cuts[i+1];
          const numbered=marker && pos+to<=marker.end;
          const classes=[run.bold?'reading-bold':'',numbered?'clause-number':'',numbered&&pos+to===marker.end?'clause-marker-end':''].filter(Boolean).join(' ');
          const style=[run.underline?'text-decoration:underline':'',numbered&&pos+to===marker.end&&/^\s/.test(text.slice(marker.end))?'--clause-gap:0':''].filter(Boolean).join(';');
          out+=`<span data-page="${run.p}" data-offset="${readingRunOffset(run,from)}"${classes?' class="'+classes+'"':''}${style?' style="'+style+'"':''}>${readingRunText(run,from,to,display.slice(pos+from,pos+to))}</span>`;
        }
      }
      pos+=run.text.length;if(pos>=b)break;
    }
    return out;
  }

  function location(at){let pos=0;for(const run of runs){if(at<pos+run.text.length)return {p:run.p,a:readingRunOffset(run,at-pos)};pos+=run.text.length;}return {p:0,a:0};}
  let cursor=0,out='';
  for(const {a,b,loc} of merged){out+=slice(cursor,a)+`<mark data-page="${loc.p}" data-offset="${loc.a}">${slice(a,b)}</mark>`;cursor=b;}
  return out+slice(cursor,text.length);
}

function readingRunText(run, start, end, displayValue) {
  const value = displayValue??run.text.slice(start, end);
  if ((!run.symbols || !run.symbolPage) && !Object.keys(run.graphicChars||{}).length) return escapeHtml(value);
  return [...value].map((character, index) => {
    if(character==='.' && /[．。\ue010]/.test(run.text[start+index]||''))return '.';
    const offset=readingRunOffset(run,start+index),graphic=run.graphicChars?.[offset];
    if(graphic)return offset===(graphic.offsets?.[0]??graphic.a)?graphicHTML({...graphic,...run.graphicPage},graphic.text):'';
    const box = run.symbols?.[run.a + start + index - run.symbolStart];
    if (!/[\ue000-\uf8ff]/.test(character) || !box || box[2] <= 0 || box[3] <= 0) return escapeHtml(character);
    const [x, y, width, height] = box;
    const [pageWidth, pageHeight] = run.symbolPage.size;
    const ratio = width * pageWidth / (height * pageHeight);
    const position = `${x / (100 - width) * 100}% ${y / (100 - height) * 100}%`;
    return `<span class="inline-symbol" aria-label="原刊符号" style="width:${ratio}em;background-image:url('${run.symbolPage.src}');background-size:${10000 / width}% ${10000 / height}%;background-position:${position}"><span>${escapeHtml(character)}</span></span>`;
  }).join('');
}

function graphicHTML(graphic,text='') {
  const [pageWidth,pageHeight]=graphic.size;
  const [left,top,right,bottom]=graphic.rect;
  const x=left/pageWidth*100,y=top/pageHeight*100,w=(right-left)/pageWidth*100,h=(bottom-top)/pageHeight*100;
  const ratio=(right-left)/(bottom-top);
  if(graphic.svg) {
    const src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(graphic.svg).replace(/'/g,'%27');
    return `<span class="inline-symbol" role="img" aria-label="原刊符号" style="width:${ratio}em;background-image:url('${src}');background-size:100% 100%;background-position:center"><span>${escapeHtml(text)||'&#xfffc;'}</span></span>`;
  }
  return `<span class="inline-symbol" role="img" aria-label="原刊符号" style="width:${ratio}em;background-image:url('${graphic.src}');background-size:${10000/w}% ${10000/h}%;background-position:${x/(100-w)*100}% ${y/(100-h)*100}%"><span>${escapeHtml(text)||'&#xfffc;'}</span></span>`;
}

function originalHighlights(block) {
  const {coordinates, a, p, top, bottom} = block;
  const cropped = bottom - top,left=block.left||0,croppedWidth=(block.right??100)-left;
  const position = ([x, y, w, h]) => `left:${(x-left)/croppedWidth*100}%;top:${(y - top) / cropped * 100}%;width:${w/croppedWidth*100}%;height:${h / cropped * 100}%`;
  return readingMatches(block.text).map(([start, end]) => {
    const rects = [];
    for (const box of (block.offsets?block.offsets.slice(start,end).map(offset=>coordinates[offset]):coordinates.slice(a + start, a + end))) {
      if (box[2] <= 0 || box[3] <= 0) continue;
      const prior = rects.at(-1);
      if (prior && Math.abs(prior[1] - box[1]) < Math.min(prior[3], box[3]) * .35
          && box[0] >= prior[0] && box[0] <= prior[0] + prior[2] + .55) {
        prior[2] = Math.max(prior[2], box[0] + box[2] - prior[0]);
        prior[3] = Math.max(prior[3], box[1] + box[3] - prior[1]);
      } else rects.push(box.slice());
    }
    return rects.map((rect, i) =>
      `<${i ? 'i' : 'mark data-page="' + p + '" data-offset="' + (block.offsets?.[start]??a + start) + '"'} class="source-highlight" data-hit="${a + start}" style="${position(rect)}"></${i ? 'i' : 'mark'}>`).join('');
  }).join('');
}
function tableHTML(block, grouped = false) {
  if (block.type === 'table-series') {
    return '<div class="article-table table-series">' +
      block.tables.map(table => tableHTML(table, true)).join('') + '</div>';
  }
  const wrap = html => grouped ? html : '<div class="article-table">' + html + '</div>';
  const sizes=block.runs.map(r=>r.size).sort((a,b)=>a-b),unit=sizes[Math.floor(sizes.length/2)]||10;
  const width=(block.right-block.left)/unit;
  if(block.type==='table-layout'){
    const lines=block.rules.map(l=>`<i style="left:${((l.h?l.a:l.v)-block.left)/unit}em;top:${((l.h?l.v:l.a)-block.top)/unit}em;${l.h?'width':'height'}:${(l.b-l.a)/unit}em" class="${l.h?'horizontal':'vertical'}"></i>`).join('');
    const runs=block.runs.map(r=>`<div class="table-positioned-text" style="left:${(r.x-block.left)/unit}em;top:${(r.y-block.top-r.size*.85)/unit}em;width:${(r.width||r.text.length*r.size)/unit}em"><span class="table-positioned-ink" style="font-size:${r.size/unit}em">${inlineRuns([r])}</span></div>`).join('');
    return wrap(`<div class="table-layout" style="width:${width}em;height:${(block.bottom-block.top)/unit}em">${lines}${runs}</div>`);
  }
  const cols = block.xs.slice(1).map((x, i) =>
    `<col style="width:${(x - block.xs[i]) / (block.right - block.left) * 100}%">`).join('');
  const cells = block.rows.flat();
  const {family, headerRows, columns, labels} = tableProfile(block, block.caption);
  const stationMarker = /^[□☐⊗×※△▲○◯◎⊙●◇◆☆★\ue000-\uf8ff]/u;
  for (const cell of cells) {
    if (cell.c0 !== cell.c1 || cell.r0 < headerRows) continue;
    const column = columns[cell.c0];
    const label = labels.get(cell);
    if (column.station) {
      column.marker ||= stationMarker.test(label) || !!cell.runs[0]?.graphicChars?.[cell.runs[0]?.a];
    } else if (!column.kind && label.length >= 12 && /[\u4e00-\u9fff]/.test(label)) {
      column.kind = 'prose';
    }
  }

  const textUnits = text => [...text].reduce((n, ch) => n + (/[\u2e80-\uffef]/u.test(ch) ? 1 : .62), 0);
  let minWidth = width * (family === 'train' ? .97 : 1.12);
  if(family==='mileage' && columns.length<=7) minWidth=Math.min(minWidth,44);
  const cellBands=new Map(cells.filter(cell=>cell.recordBands).map(cell=>[cell,cell.recordBands]));
  for(const row of block.rows) {
    const station=row.find(cell=>cell.r0>=headerRows && cell.c0===cell.c1 && columns[cell.c0].station && cell.lines.length>1);
    if(!station) continue;
    const positions=station.lines.map(line=>line.y),size=station.lines[0].size;
    const quantities=row.filter(cell=>cell.c0===cell.c1 && columns[cell.c0].kind==='number' &&
      cell.lines.length===positions.length && cell.lines.every((line,i)=>
        /^[\d０-９.．—–-]+$/.test(line.runs.map(run=>run.text).join('')) && Math.abs(line.y-positions[i])<size*.7));
    if(quantities.length<2)continue;
    for(const cell of row) {
      if(cell.lines.length<2 || cell.r1!==station.r1 || cell.c0!==cell.c1)continue;
      const bands=positions.map(()=>[]);
      for(const line of cell.lines) {
        const distances=positions.map(y=>Math.abs(line.y-y));
        bands[distances.indexOf(Math.min(...distances))].push(...line.runs);
      }
      if(!cellBands.has(cell) && bands.every(runs=>runs.length))cellBands.set(cell,bands.map(runs=>({runs})));
    }
  }
  function renderCell(cell) {
    const column = columns[cell.c0];
    const label = labels.get(cell);
    const header = cell.r0 < headerRows && cell.r1 < headerRows;
    const body = cell.r0 >= headerRows;
    const station = body && cell.c0 === cell.c1 && column.station;
    const prose = !station && body && (cell.c0 === cell.c1 ? column.kind === 'prose' : label.length >= 12);
    const quantity = body && column.kind === 'number' && /^[+−—–\-\d.,%￥¥~≤≥<>]+$/.test(label);
    const fixed = body && ['code', 'time'].includes(column.kind) && /^[\w.:+/−—–-]+$/.test(label);
    let nowrap = false;
    const runs = tableCellRuns(cell);
    const stackedNumbers = cell.lines.length > 1 && cell.lines.every(line =>
      /^(?:[+−—-]?[０-９0-9]+(?:[.．][０-９0-9]+)?|[—–-])$/.test(line.runs.map(run => run.text).join('')));
    let content;
    function stationLine(runs,graphics=[]) {
        if(!runs.length)return `<div>${inlineRuns(runs,{graphics})}</div>`;
        if (!column.marker) return `<div>${inlineRuns(runs,{graphics})}</div>`;
        const [first, ...rest] = runs;
        if (!stationMarker.test(first.text) && !first.graphicChars?.[first.a]) return `<div class="station-line"><span></span><span>${inlineRuns(runs,{graphics})}</span></div>`;
        const marker = {...first, text: first.text[0]};
        const name = {...first, text: first.text.slice(1), a: first.a + 1};
        return `<div class="station-line"><span>${inlineRuns([marker])}</span><span>${inlineRuns([name, ...rest],{graphics})}</span></div>`;
    }
    if(cellBands.has(cell)) {
      const bands=cellBands.get(cell),graphics=readingGraphicsByGroup(bands,cell.graphics);
      content=bands.map((band,i)=>`<div class="cell-band" data-band="${i}">${station?stationLine(band.runs,graphics[i]):'<div>'+inlineRuns(band.runs,{graphics:graphics[i]})+'</div>'}</div>`).join('');
    } else if (station) {
      const graphics=readingGraphicsByGroup(cell.lines,cell.graphics);
      content = cell.lines.map((line,i)=>stationLine(line.runs,graphics[i])).join('');
    } else if (stackedNumbers) {
      const graphics=readingGraphicsByGroup(cell.lines,cell.graphics);
      content = cell.lines.map((line,i) => `<div>${inlineRuns(line.runs,{graphics:graphics[i]})}</div>`).join('');
    } else if(body && family==='train' && column.kind==='code') {
      const lines=[];
      for(const line of cell.lines) {
        const last=lines.at(-1),label=line.runs.map(run=>run.text).join('').trim();
        const before=last?.runs.map(run=>run.text).join('').trim();
        if(last && (/[\/]$/.test(before) || /^[\/]/.test(label) || /^[A-Z]+$/i.test(before) && /^\d/.test(label)))last.runs.push(...line.runs);
        else lines.push({...line,runs:line.runs.slice()});
      }
      const graphics=readingGraphicsByGroup(lines,cell.graphics);
      content=lines.map((line,i)=>{
        const groups=[[]],codeRuns=readingCodeRuns(line.runs);
        const digitWidths=codeRuns.filter(run=>/^\d$/.test(run.text)).map(run=>run.width).sort((a,b)=>a-b);
        const threshold=Math.max(1.2,(digitWidths[Math.floor(digitWidths.length/2)]||line.runs[0]?.size*.5||5)*.55);
        for(const run of codeRuns) {
          const previous=groups.at(-1).at(-1),before=groups.at(-1).map(run=>run.text).join('').trim();
          const gap=previous?run.x-(previous.inkRight??previous.x+previous.width):0;
          if(previous && gap>threshold &&
              /^[A-Z]?\d[\d/]*\d$/i.test(before) && /^(?:[A-Z]?\d)/i.test(run.text))groups.push([]);
          groups.at(-1).push(run);
        }
        const assigned=readingGraphicsByGroup(groups.map(runs=>({runs})),graphics[i]);
        return '<div>'+groups.map((runs,j)=>inlineRuns(runs,{graphics:assigned[j]})).join(' ')+'</div>';
      }).join('');
    } else {
      content = inlineRuns(runs,{graphics:cell.graphics});
    }
    if (body && !prose && label && (station || quantity || fixed)) {
      const fraction = (block.xs[cell.c1 + 1] - block.xs[cell.c0]) / (block.right - block.left);
      const units = stackedNumbers || station
        ? Math.max(...cell.lines.map(line => textUnits(line.runs.map(run => run.text).join(''))))
        : textUnits(label);
      // Long entries and sliver columns can wrap rather than widening the entire table.
      const required = (units + .9 + (station && column.marker ? 1.25 : 0)) / fraction;
      nowrap = (quantity || fixed) && required <= 64;
      const limit = family === 'train' && !quantity && !fixed ? 46 : 64;
      minWidth = Math.max(minWidth, Math.min(limit, required));
    }
    const style = station ? 'table-station' : prose ? 'table-prose' : quantity ? 'table-quantity' : fixed ? 'table-fixed' : '';
    const tag = header ? 'th' : 'td';
    const scope = header ? ` scope="${cell.c0 === cell.c1 ? 'col' : 'colgroup'}"` : '';
    return `<${tag} class="${style}${nowrap ? ' table-nowrap' : ''}"${scope} rowspan="${cell.r1 - cell.r0 + 1}" colspan="${cell.c1 - cell.c0 + 1}">${content}</${tag}>`;
  }
  const rows = block.rows.map(row => '<tr>' + row.map(renderCell).join('') + '</tr>');
  const separateHead = headerRows > 0 && !cells.some(cell => cell.r0 < headerRows && cell.r1 >= headerRows);
  const head = separateHead ? '<thead>' + rows.splice(0, headerRows).join('') + '</thead>' : '';
  return wrap(`<table data-family="${family}" style="min-width:${minWidth}em"><colgroup>${cols}</colgroup>${head}<tbody>${rows.join('')}</tbody></table>`);
}
function blocksHTML(blocks) {
  return blocks.map(block => {
    if(block.type==='continuation')return `<span class="source-anchor" data-page="${block.runs[0].p}" data-offset="${block.runs[0].a}"></span>`;
    if (block.type.startsWith('table')) return tableHTML(block);
    if (block.type === 'parameters') return '<dl class="article-parameters">' + block.rows.map(row =>
      `<dt>${inlineRuns(row.label)}</dt><dd>${inlineRuns(row.value)}</dd>`).join('') + '</dl>';
    if (block.type === 'source') {
      const {top, bottom, width, height} = block;
      const left=block.left||0,right=block.right??100,cropWidth=right-left;
      const scale = 10000 / (bottom - top);
      const lines = [];
      for (const run of block.runs) {
        if (lines.length && lines.at(-1)[0].line === run.line) lines.at(-1).push(run);
        else lines.push([run]);
      }
      const transcription = lines.map(line => escapeHtml(readingPunctuation(line.map(run => run.text).join('')))).join('\n');
      return `<figure class="article-figure source-page"${block.region?` style="width:min(100%,${block.displayWidth}em);margin-inline:auto"`:""} data-page="${block.p}" data-offset="${block.a}" data-crop="${left},${top},${right},${bottom}">
        <div class="source-sheet" style="aspect-ratio:${width*cropWidth/100}/${height * (bottom - top) / 100}">
          <img src="${block.src}" style="left:${-left/cropWidth*100}%;width:${10000/cropWidth}%;top:${-top * scale / 100}%;height:${scale}%" alt="PDF 第 ${block.p + 1} 页" loading="lazy" decoding="async">
          ${block.anchors.map(({a, y, x=left}) => `<span class="source-anchor" data-page="${block.p}" data-offset="${a}" style="left:${(x-left)/cropWidth*100}%;top:${(y - top) * scale / 100}%"></span>`).join('')}
          <div class="source-highlights" aria-hidden="true">${originalHighlights(block)}</div>
        </div>
        <figcaption><a href="${escapeHtml(block.original)}" target="_blank" rel="noopener">${block.region?(block.kind==='figure'?'原图':'原版面片段'):'原版面'} · PDF ${block.p + 1}</a></figcaption>
        ${lines.length && block.textReliable!==false ? '<details class="figure-text"><summary>可复制文字</summary><div class="source-transcript">' + transcription + '</div></details>' : ''}
      </figure>`;
    }
    if (block.type === 'media') {
      const label = block.kind === 'layout' ? '原版式' : '原图';
      const lines = [];
      for (const run of block.runs || []) {
        if (lines.length && lines.at(-1)[0].line === run.line) lines.at(-1).push(run);
        else lines.push([run]);
      }
      const text = lines.length ? '<details class="figure-text"><summary>可复制文字</summary><div>' +
        lines.map(line => inlineRuns(line)).join('<br>') + '</div></details>' : '';
      return `<figure class="article-figure" data-page="${block.p}" data-offset="${block.a}">
        <img width="${block.width}" height="${block.height}" src="${block.src}" alt="${label}，PDF 第 ${block.p + 1} 页" loading="lazy" decoding="async">
        <figcaption>${label} · PDF ${block.p + 1} 页</figcaption>${text}</figure>`;
    }
    const tag = block.type === 'document-title' ? 'h2' : block.type === 'heading' ? 'h3' : 'p';
    const className = block.centered ? 'reading-centered' : block.type === 'annotation' || block.alignedRight ? 'reading-annotation'
      : block.type === 'paragraph' && block.indent != null ? 'reading-paragraph' : block.type === 'metadata' ? 'article-note' : '';
    const style = block.type === 'paragraph' && block.indent != null ? ` style="--paragraph-indent:${block.indent}em"` : '';
    return `<${tag} class="${className}"${style}>${inlineRuns(block.runs,{paragraph:block.type==='paragraph',graphics:block.graphics})}</${tag}>`;
  }).join('');
}
async function renderReadingSection(entry, serial, wholeIssue = false, original = false, shownSources = new Set()) {
  const blocks=[],imagePages=new Set();
  let previousPage = -2;
  for(const part of wholeIssue ? entry.parts : partsWithImagePages(entry)){
    const markup = await loadReadingPage(entry.document, part.p);
    if (serial !== renderSerial) return;
    const decoded = decodeFlow(entry.document, part.p, markup);
    if (markup.includes('image-note')) imagePages.add(part.p + 1);
    const fresh = readingPartBlocks(decoded, part, entry, original);
    for (const block of fresh) if (block.type === 'table') block.caption = entry.title;
    if (fresh[0]?.type === 'source' && !fresh[0].region && fresh[0].a === 0 && fresh[0].b === entry.document.texts[part.p].length) {
      if (shownSources.has(part.p)) continue;
      shownSources.add(part.p);
    }
    if (part.p === previousPage + 1) joinTableContinuation(blocks.at(-1), fresh, !!entry.document.originalPages);
    for (let i = 0; i < fresh.length - 1; i++) {
      if (!fresh[i].type.startsWith('table')) continue;
      const rest = fresh.slice(i + 1);
      const count = rest.length;
      joinTableContinuation(fresh[i], rest, !!entry.document.originalPages);
      fresh.splice(i + 1, count, ...rest);
    }
    previousPage = part.p;
    const last=blocks.at(-1),first=fresh[0];
    if (last?.type === 'paragraph' && first?.type === 'paragraph' &&
        (entry.document.originalPages ? last.openEnd && first.continued : !/[。；;：:！？!?]$/.test(last.runs.at(-1).text)) &&
        !startsReadingParagraph(first.runs.map(run => run.text).join(''))) {
      const next = fresh.shift();
      last.runs.push(...next.runs);
      last.lastRow = next.lastRow;
      last.openEnd = next.openEnd;
    }
    blocks.push(...fresh);
  }
  if(serial!==renderSerial)return;
  const section=window.document.createElement('section');section.className='article-section';section.dataset.entry=entry.id;
  const hasTitle = blocks[0]?.type === 'source' || blocks.some(block => block.type === 'document-title');
  section.innerHTML = (!hasTitle && entry.heading !== false && (wholeIssue || entry.parentId || entry.document.originalPages)
    ? `<h2 data-page="${entry.p}" data-offset="${entry.a}">${entry.parentId && entry.title!==(entry.attachmentLabel||'附件') ? '<small>' + escapeHtml(entry.attachmentLabel || '附件') + '</small>' : ''}${escapeHtml(readingPunctuation(entry.title))}</h2>` : '')
    + blocksHTML(blocks) + (imagePages.size ? `<p class="article-note">PDF 第 ${[...imagePages].join('、')} 页含原始图像，请查看原件。</p>` : '')
    + (wholeIssue && !blocks.length && entry.heading === false
      ? `<p class="article-note" data-page="${entry.p}" data-offset="${entry.a}">PDF 第 ${entry.p + 1} 页</p>` : '')
    + (wholeIssue ? '' : `<footer>出处：${escapeHtml(entry.document.file)} · PDF ${entry.p+1}—${entry.parts.at(-1).p+1} 页</footer>`);
  return section;
}

function fitPositionedText(section) {
  for(const table of section.querySelectorAll('table:has(.cell-band)')) {
    const align=()=>{
      const bands=[...table.querySelectorAll('.cell-band')];
      bands.forEach(node=>node.style.minHeight='');
      for(const row of table.rows) {
        const groups=new Map();
        for(const node of row.querySelectorAll('.cell-band')) {
          if(!groups.has(node.dataset.band))groups.set(node.dataset.band,[]);
          groups.get(node.dataset.band).push(node);
        }
        for(const nodes of groups.values()) {
          const height=Math.max(...nodes.map(node=>node.getBoundingClientRect().height));
          nodes.forEach(node=>node.style.minHeight=height+'px');
        }
      }
    };
    align();
    if(!table.bandObserver && typeof ResizeObserver!=='undefined') {
      let lastWidth=table.getBoundingClientRect().width,lastFont=getComputedStyle(table).fontSize;
      table.bandObserver=new ResizeObserver(()=>{
        const width=table.getBoundingClientRect().width,font=getComputedStyle(table).fontSize;
        if(Math.abs(width-lastWidth)>.5 || font!==lastFont){lastWidth=width;lastFont=font;align();}
      });
      table.bandObserver.observe(table);
    }
  }
  for (const ink of section.querySelectorAll('.table-positioned-ink')) {
    if (ink.offsetWidth) ink.style.transform = `scaleX(${ink.parentElement.clientWidth / ink.offsetWidth})`;
  }
}

async function selectEntry(id, targetPage, restoreScroll, restoreHit) {
  const chosen=entries.find(e=>e.id===id) || results.find(result => result.entry.id === id)?.entry;
  if(!chosen)return;
  selected=chosen;readerDocument=chosen.document;const serial=++renderSerial;
  const root=entries.find(e=>e.id===(chosen.parentId||chosen.id))||chosen;
  articleFamily=[root,...entries.filter(e=>e.parentId===root.id)].sort((a,b)=>a.p-b.p||a.a-b.a);
  page=targetPage ?? chosen.p;hits=[];hitIndex=-1;articleMarks=[];
  for(const button of $('results').querySelectorAll('.result')){button.classList.toggle('active',button.dataset.id===id);button.setAttribute('aria-pressed',String(button.dataset.id===id));}
  $('documentName').textContent=readerDocument.file;$('previewTitle').textContent=readingPunctuation(root.title);
  $('pageStack').hidden=false;$('previewEmpty').hidden=true;
  const legacyHeading = readerDocument.originalPages ? '' : `<h1>${escapeHtml(root.title)}</h1>`;
  $('pageStack').innerHTML=`<article class="reading-article"><header><div class="article-meta">${readerDocument.year} 年 · ${escapeHtml(readerDocument.issue)}</div>${legacyHeading}<div class="article-meta">PDF ${root.p+1}—${root.parts.at(-1).p+1} 页</div></header><div class="article-loading">正在读取正文…</div></article>`;
  $('viewer').scrollTop=0;updateZoom(false);updateReadingPosition();
  try {
    const article=$('pageStack').firstElementChild;
    const shownSources = new Set();
    for(const entry of articleFamily){
      const section = await renderReadingSection(entry, serial, false, !!entry.sourcePage, shownSources);
      if (!section || serial !== renderSerial) return;
      article.querySelector('.article-loading')?.remove();
      article.append(section);
      fitPositionedText(section);
    }
    articleMarks=[...article.querySelectorAll('mark')];hits=articleMarks.map(n=>({p:Number(n.dataset.page),a:Number(n.dataset.offset)}));
    hitIndex=hits.length?Math.max(0,hits.findIndex(h=>chosen.parts.some(p=>p.p===h.p&&h.a>=p.a&&h.a<p.b))):-1;
    if (restoreScroll != null) {
      if (Number.isInteger(restoreHit) && restoreHit >= 0 && restoreHit < hits.length) {
        hitIndex = restoreHit;
        setActiveHit();
      }
      $('viewer').scrollTop = restoreScroll;
    } else if (targetPage != null) {
      scrollReaderTo(article.querySelector(`[data-page="${targetPage}"]`));
    } else if(hitIndex>=0)focusHit();
    else scrollReaderTo(article.querySelector(`.source-anchor[data-page="${chosen.p}"][data-offset="${chosen.a}"]`)
      || article.querySelector(`[data-entry="${chosen.id}"]`));
    updateReadingPosition();
  }catch(error){if(serial===renderSerial){$('pageStack').querySelector('.article-loading')?.remove();toast('正文读取失败，请运行更新脚本');}}
}
function setActiveHit() {
  articleMarks.forEach((n,i)=>{
    n.classList.toggle('current',i===hitIndex);
    if (n.classList.contains('source-highlight')) {
      for (const rect of n.parentElement.querySelectorAll(`i[data-hit="${n.dataset.hit}"]`)) {
        rect.classList.toggle('current', i === hitIndex);
      }
    }
  });
}

function focusHit(){
  setActiveHit();
  const mark=articleMarks[hitIndex];if(!mark)return;
  const details = mark.closest('details');
  if (details) details.open = true;
  page=Number(mark.dataset.page);scrollReaderTo(mark,true);updateReadingPosition();
}
function stepHit(direction){if(!hits.length)return;hitIndex=(hitIndex+direction+hits.length)%hits.length;focusHit();}
function goToPage(value){
  if(!readerDocument)return;const n=Number(value)-1;if(!Number.isInteger(n)||n<0||n>=readerDocument.pages)return;
  if (issueView) { navigateIssue(readerDocument.id, {p:n}); return; }
  if (selected?.sourcePage) { navigateIssue(readerDocument.id, {p:n}, true, true); return; }
  const anchor=$('pageStack').querySelector(`[data-page="${n}"]`);
  if(anchor){navigateEntry(selected.id, n);}
  else {
    const entry = entries.find(item => item.document.id === readerDocument.id && item.parts.some(part => part.p === n));
    if (entry) navigateEntry(entry.id, n);
    else if (readerDocument.mediaPages?.includes(n)) navigateIssue(readerDocument.id, {p: n});
  }
}
function updateZoom() {
  const size = zoomMode === 'fit' ? 18 : Math.max(15, Math.min(26, 18 * zoomScale));
  $('pageStack').style.setProperty('--reading-size', size + 'px');
  $('pageStack').style.width = '100%';
  keepIssuePosition();
}
function stepZoom(direction){zoomMode='manual';zoomScale=Math.max(.85,Math.min(1.45,(parseFloat($('pageStack').style.getPropertyValue('--reading-size'))||18)/18+direction/18));updateZoom();}
function syncScrollPosition(){scrollFrame=null;if(!readerDocument)return;if (issueView) { syncIssuePosition(); return; }const top=$('viewer').getBoundingClientRect().top;const spans=$('pageStack').querySelectorAll('span[data-page], figure[data-page]');for(const span of spans){if(span.getBoundingClientRect().bottom>top+60){page=Number(span.dataset.page);updateReadingPosition();break;}}}

function scrollReaderTo(node,center=false){if(!node)return;const viewer=$('viewer');viewer.scrollTop+=node.getBoundingClientRect().top-viewer.getBoundingClientRect().top-(center?viewer.clientHeight*.35:24);}
