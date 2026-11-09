'use strict';

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
          window.PAGE_HTML[key] = decoded.slice(decoded.indexOf('\n') + 1);
        }
        const markup = window.PAGE_HTML[key];
        if (!markup) throw new Error('阅读数据为空');
        coordinateOrder.push(key);
        while (coordinateOrder.length > 30) delete window.PAGE_HTML[coordinateOrder.shift()];
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
  const runs=[...xml.querySelectorAll('text')].map(node=>{
    const text=node.textContent,a=offset;offset+=text.length;
    return {text,a,b:offset,line:node.getAttribute('data-line'),x:Number(node.getAttribute('x')),y:Number(node.getAttribute('y')),width:Number(node.getAttribute('textLength')),size:Number(node.getAttribute('font-size')),bold:node.getAttribute('font-weight')==='bold',p:number};
  });
  const media = [...markup.slice(end).matchAll(
    /<img data-kind="(layout|image)"(?: data-owner="(\d+)")? data-a="(\d+)" data-b="(\d+)" width="(\d+)" height="(\d+)" src="(data:image\/png;base64,[A-Za-z0-9+/=]+)">/g
  )].map(([, kind, owner, a, b, width, height, src]) => ({
    type: 'media', kind, owner: owner == null ? null : Number(owner),
    a: Number(a), b: Number(b), width: Number(width), height: Number(height), p: number, src
  }));
  return {runs, media, rules:[...xml.querySelectorAll('path')].map(n=>n.getAttribute('d')),width:document.sizes[number][0],height:document.sizes[number][1]};
}

function readingPartBlocks(decoded, part, title, pageLength) {
  const {runs, rules, width, height} = decoded;
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
function inlineRuns(runs) {
  const text=runs.map(r=>r.text).join('');
  let normalized='',offset=0;
  const mapping=[];
  for(const ch of text){const value=normalize(ch);normalized+=value;for(let i=0;i<value.length;i++)mapping.push([offset,offset+ch.length]);offset+=ch.length;}
  const ranges=[];
  for(const term of terms){if(!term)continue;let at=0;while((at=normalized.indexOf(term,at))>=0){ranges.push([mapping[at][0],mapping[at+term.length-1][1]]);at+=term.length;}}
  ranges.sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for(const [a,b] of ranges){const last=merged.at(-1);if(last && a<last[1])last[1]=Math.max(last[1],b);else merged.push([a,b]);}
  function slice(a,b){let pos=0,out='';for(const run of runs){const start=Math.max(0,a-pos),end=Math.min(run.text.length,b-pos);if(end>start)out+=`<span data-page="${run.p}" data-offset="${run.a+start}">${escapeHtml(run.text.slice(start,end).replace(/\ue010/g,'.').replace(/\ue5d2/g,'~'))}</span>`;pos+=run.text.length;if(pos>=b)break;}return out;}
  function location(at){let pos=0;for(const run of runs){if(at<pos+run.text.length)return {p:run.p,a:run.a+at-pos};pos+=run.text.length;}return {p:0,a:0};}
  let cursor=0,out='';
  for(const [a,b] of merged){const loc=location(a);out+=slice(cursor,a)+`<mark data-page="${loc.p}" data-offset="${loc.a}">${slice(a,b)}</mark>`;cursor=b;}
  return out+slice(cursor,text.length);
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
  const labels = new Map(cells.map(cell => [cell, tableCellText(cell)]));
  const columns = Array.from({length: block.columns}, () => ({stationHeading: -1, prose: false, marker: false}));
  const stationLabel = /^(?:(?:始发|出发|到达|经由|办理|交接|货运|客运)站(?:名|名称)?|站名(?:称)?|车站(?:名|名称)?|发站|到站|起点站|终点站)$/;
  const proseLabel = /接续线名|备注|说明|办理限制|修改内容|办理范围|限制内容/;
  const stationMarker = /^[□☐⊗×※△▲○◯◎⊙●◇◆☆★]/u;
  let headingEnd = -1;
  for (const cell of cells) {
    if (cell.r0 > 3 || cell.c0 !== cell.c1) continue;
    const column = columns[cell.c0];
    const label = labels.get(cell);
    if (column.stationHeading < 0 && stationLabel.test(label)) {
      column.stationHeading = cell.r1;
      headingEnd = Math.max(headingEnd, cell.r1);
    }
    if (cell.r0 === 0 && proseLabel.test(label)) {
      column.prose = true;
      headingEnd = Math.max(headingEnd, cell.r1);
    }
  }
  for (const cell of cells) {
    if (cell.c0 !== cell.c1 || cell.r0 <= headingEnd) continue;
    const column = columns[cell.c0];
    const label = labels.get(cell);
    if (column.stationHeading >= 0) {
      column.marker ||= stationMarker.test(label);
    } else if (label.length >= 12 && /[\u4e00-\u9fff]/.test(label)) {
      column.prose = true;
    }
  }

  const textUnits = text => [...text].reduce((n, ch) => n + (/[\u2e80-\uffef]/u.test(ch) ? 1 : .62), 0);
  let minWidth = width * 1.12;
  function renderCell(cell) {
    const column = columns[cell.c0];
    const label = labels.get(cell);
    const body = cell.r0 > headingEnd;
    const station = cell.c0 === cell.c1 && column.stationHeading >= 0 && cell.r0 > column.stationHeading;
    const prose = !station && body && (cell.c0 === cell.c1 ? column.prose : label.length >= 12);
    const runs = tableCellRuns(cell);
    const stackedNumbers = cell.lines.length > 1 && cell.lines.every(line =>
      /^[+−—-]?[０-９0-9]+(?:[.．][０-９0-9]+)?$/.test(line.runs.map(run => run.text).join('')));
    let content;
    if (station) {
      content = cell.lines.map(line => {
        if (!column.marker) return `<div>${inlineRuns(line.runs)}</div>`;
        const [first, ...rest] = line.runs;
        if (!stationMarker.test(first.text)) return `<div class="station-line"><span></span><span>${inlineRuns(line.runs)}</span></div>`;
        const marker = {...first, text: first.text[0]};
        const name = {...first, text: first.text.slice(1), a: first.a + 1};
        return `<div class="station-line"><span>${inlineRuns([marker])}</span><span>${inlineRuns([name, ...rest])}</span></div>`;
      }).join('');
    } else if (stackedNumbers) {
      content = cell.lines.map(line => `<div>${inlineRuns(line.runs)}</div>`).join('');
    } else {
      content = inlineRuns(runs);
    }
    if (body && !prose && label) {
      const fraction = (block.xs[cell.c1 + 1] - block.xs[cell.c0]) / (block.right - block.left);
      const units = stackedNumbers || station
        ? Math.max(...cell.lines.map(line => textUnits(line.runs.map(run => run.text).join(''))))
        : textUnits(label);
      // Long entries and sliver columns can wrap rather than widening the entire table.
      minWidth = Math.max(minWidth, Math.min(64, (units + .9 + (station && column.marker ? 1.25 : 0)) / fraction));
    }
    const style = station ? 'table-station' : prose ? 'table-prose' : '';
    return `<td class="${style}" rowspan="${cell.r1 - cell.r0 + 1}" colspan="${cell.c1 - cell.c0 + 1}">${content}</td>`;
  }
  const rows = block.rows.map(row => '<tr>' + row.map(renderCell).join('') + '</tr>').join('');
  return wrap(`<table style="min-width:${minWidth}em"><colgroup>${cols}</colgroup><tbody>${rows}</tbody></table>`);
}
function blocksHTML(blocks) {
  return blocks.map(block => {
    if (block.type.startsWith('table')) return tableHTML(block);
    if (block.type === 'parameters') return '<dl class="article-parameters">' + block.rows.map(row =>
      `<dt>${inlineRuns(row.label)}</dt><dd>${inlineRuns(row.value)}</dd>`).join('') + '</dl>';
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
    const tag = block.type === 'heading' ? 'h3' : 'p';
    return `<${tag}${block.type === 'metadata' ? ' class="article-note"' : ''}>${inlineRuns(block.runs)}</${tag}>`;
  }).join('');
}
async function renderReadingSection(entry, serial, wholeIssue = false) {
  const blocks=[],imagePages=new Set();
  let previousPage = -2;
  for(const part of wholeIssue ? entry.parts : partsWithImagePages(entry)){
    const markup = await loadReadingPage(entry.document, part.p);
    if (serial !== renderSerial) return;
    const decoded = decodeFlow(entry.document, part.p, markup);
    if (markup.includes('image-note')) imagePages.add(part.p + 1);
    const fresh = readingPartBlocks(decoded, part, entry.heading === false ? '' : entry.title, entry.document.texts[part.p].length);
    if (part.p === previousPage + 1) joinTableContinuation(blocks.at(-1), fresh);
    previousPage = part.p;
    const last=blocks.at(-1),first=fresh[0];
    if (last?.type === 'paragraph' && first?.type === 'paragraph' &&
        !/[。；;：:！？!?]$/.test(last.runs.at(-1).text) &&
        !startsReadingParagraph(first.runs.map(run => run.text).join(''))) {
      last.runs.push(...fresh.shift().runs);
    }
    blocks.push(...fresh);
  }
  if(serial!==renderSerial)return;
  const section=window.document.createElement('section');section.className='article-section';section.dataset.entry=entry.id;
  section.innerHTML = (entry.heading !== false && (wholeIssue || entry.parentId)
    ? `<h2 data-page="${entry.p}" data-offset="${entry.a}">${entry.parentId ? '<small>附件</small>' : ''}${escapeHtml(entry.title)}</h2>` : '')
    + blocksHTML(blocks) + (imagePages.size ? `<p class="article-note">PDF 第 ${[...imagePages].join('、')} 页含原始图像，请查看原件。</p>` : '')
    + (wholeIssue && !blocks.length && entry.heading === false
      ? `<p class="article-note" data-page="${entry.p}" data-offset="${entry.a}">PDF 第 ${entry.p + 1} 页</p>` : '')
    + (wholeIssue ? '' : `<footer>出处：${escapeHtml(entry.document.file)} · PDF ${entry.p+1}—${entry.parts.at(-1).p+1} 页</footer>`);
  return section;
}

function fitPositionedText(section) {
  for (const ink of section.querySelectorAll('.table-positioned-ink')) {
    if (ink.offsetWidth) ink.style.transform = `scaleX(${ink.parentElement.clientWidth / ink.offsetWidth})`;
  }
}

async function selectEntry(id, targetPage, restoreScroll, restoreHit) {
  const chosen=entries.find(e=>e.id===id);if(!chosen)return;
  selected=chosen;readerDocument=chosen.document;const serial=++renderSerial;
  const root=entries.find(e=>e.id===(chosen.parentId||chosen.id))||chosen;
  articleFamily=[root,...entries.filter(e=>e.parentId===root.id)].sort((a,b)=>a.p-b.p||a.a-b.a);
  page=targetPage ?? chosen.p;hits=[];hitIndex=-1;articleMarks=[];
  for(const button of $('results').querySelectorAll('.result')){button.classList.toggle('active',button.dataset.id===id);button.setAttribute('aria-pressed',String(button.dataset.id===id));}
  $('documentName').textContent=readerDocument.file;$('previewTitle').textContent=root.title;
  $('pageStack').hidden=false;$('previewEmpty').hidden=true;
  $('pageStack').innerHTML=`<article class="reading-article"><header><div class="article-meta">${readerDocument.year} 年 · ${escapeHtml(readerDocument.issue)}</div><h1>${escapeHtml(root.title)}</h1><div class="article-meta">${escapeHtml(root.number||'')}<span>PDF ${root.p+1}—${root.parts.at(-1).p+1} 页</span></div></header><div class="article-loading">正在读取正文…</div></article>`;
  $('viewer').scrollTop=0;updateZoom(false);updateReadingPosition();
  try {
    const article=$('pageStack').firstElementChild;
    for(const entry of articleFamily){
      const section = await renderReadingSection(entry, serial);
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
        articleMarks[hitIndex].classList.add('current');
      }
      $('viewer').scrollTop = restoreScroll;
    } else if (targetPage != null) {
      scrollReaderTo(article.querySelector(`[data-page="${targetPage}"]`));
    } else if(hitIndex>=0)focusHit();
    else scrollReaderTo(article.querySelector(`[data-entry="${chosen.id}"]`));
    updateReadingPosition();
  }catch(error){if(serial===renderSerial){$('pageStack').querySelector('.article-loading')?.remove();toast('正文读取失败，请运行更新脚本');}}
}
function focusHit(){
  articleMarks.forEach((n,i)=>n.classList.toggle('current',i===hitIndex));
  const mark=articleMarks[hitIndex];if(!mark)return;
  const details = mark.closest('details');
  if (details) details.open = true;
  page=Number(mark.dataset.page);scrollReaderTo(mark,true);updateReadingPosition();
}
function stepHit(direction){if(!hits.length)return;hitIndex=(hitIndex+direction+hits.length)%hits.length;focusHit();}
function goToPage(value){
  if(!readerDocument)return;const n=Number(value)-1;if(!Number.isInteger(n)||n<0||n>=readerDocument.pages)return;
  if (issueView) { navigateIssue(readerDocument.id, {p:n}); return; }
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
