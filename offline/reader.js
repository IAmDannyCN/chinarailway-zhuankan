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
  runs = splitReadingColumns(runs, rules, coordinates, ...document.sizes[number]);
  for (const run of runs) {
    if (/[\ue000-\uf8ff]/.test(run.text)) {
      run.symbols = coordinates.slice(run.a, run.b);
      run.symbolStart = run.a;
      run.symbolPage = {src: `data/${document.id}/${number + 1}.original.webp`, size: document.sizes[number]};
    }
  }
  if (document.originalPages) verifyReadingUnderlines(runs, rules);
  return {runs, media, rules,
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
    const fresh = articleBlocks(runs, rules, width, height, {...part, strict: true}, title);
    return canDisplayReadingPart(fresh, decoded, part) ? fresh : source();
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

function inlineRuns(runs) {
  const text = runs.map(run => run.text).join('');
  const merged = readingMatches(text);
  function slice(a,b){let pos=0,out='';for(const run of runs){const start=Math.max(0,a-pos),end=Math.min(run.text.length,b-pos);if(end>start)out+=`<span data-page="${run.p}" data-offset="${run.a+start}"${run.bold ? ' class="reading-bold"' : ''}${run.underline ? ' style="text-decoration:underline"' : ''}>${readingRunText(run,start,end)}</span>`;pos+=run.text.length;if(pos>=b)break;}return out;}
  function location(at){let pos=0;for(const run of runs){if(at<pos+run.text.length)return {p:run.p,a:run.a+at-pos};pos+=run.text.length;}return {p:0,a:0};}
  let cursor=0,out='';
  for(const [a,b] of merged){const loc=location(a);out+=slice(cursor,a)+`<mark data-page="${loc.p}" data-offset="${loc.a}">${slice(a,b)}</mark>`;cursor=b;}
  return out+slice(cursor,text.length);
}

function readingRunText(run, start, end) {
  const value = run.text.slice(start, end);
  if (!run.symbols || !run.symbolPage) return escapeHtml(value);
  return [...value].map((character, index) => {
    const box = run.symbols[run.a + start + index - run.symbolStart];
    if (!/[\ue000-\uf8ff]/.test(character) || !box || box[2] <= 0 || box[3] <= 0) return escapeHtml(character);
    const [x, y, width, height] = box;
    const [pageWidth, pageHeight] = run.symbolPage.size;
    const ratio = width * pageWidth / (height * pageHeight);
    const position = `${x / (100 - width) * 100}% ${y / (100 - height) * 100}%`;
    return `<span class="inline-symbol" aria-label="原刊符号" style="width:${ratio}em;background-image:url('${run.symbolPage.src}');background-size:${10000 / width}% ${10000 / height}%;background-position:${position}"><span>${escapeHtml(character)}</span></span>`;
  }).join('');
}

function originalHighlights(block) {
  const {coordinates, a, p, top, bottom} = block;
  const cropped = bottom - top;
  const position = ([x, y, w, h]) => `left:${x}%;top:${(y - top) / cropped * 100}%;width:${w}%;height:${h / cropped * 100}%`;
  return readingMatches(block.text).map(([start, end]) => {
    const rects = [];
    for (const box of coordinates.slice(a + start, a + end)) {
      if (box[2] <= 0 || box[3] <= 0) continue;
      const prior = rects.at(-1);
      if (prior && Math.abs(prior[1] - box[1]) < Math.min(prior[3], box[3]) * .35
          && box[0] >= prior[0] && box[0] <= prior[0] + prior[2] + .55) {
        prior[2] = Math.max(prior[2], box[0] + box[2] - prior[0]);
        prior[3] = Math.max(prior[3], box[1] + box[3] - prior[1]);
      } else rects.push(box.slice());
    }
    return rects.map((rect, i) =>
      `<${i ? 'i' : 'mark data-page="' + p + '" data-offset="' + (a + start) + '"'} class="source-highlight" data-hit="${a + start}" style="${position(rect)}"></${i ? 'i' : 'mark'}>`).join('');
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
  const stationMarker = /^[□☐⊗×※△▲○◯◎⊙●◇◆☆★]/u;
  for (const cell of cells) {
    if (cell.c0 !== cell.c1 || cell.r0 < headerRows) continue;
    const column = columns[cell.c0];
    const label = labels.get(cell);
    if (column.station) {
      column.marker ||= stationMarker.test(label);
    } else if (!column.kind && label.length >= 12 && /[\u4e00-\u9fff]/.test(label)) {
      column.kind = 'prose';
    }
  }

  const textUnits = text => [...text].reduce((n, ch) => n + (/[\u2e80-\uffef]/u.test(ch) ? 1 : .62), 0);
  let minWidth = width * (family === 'train' ? .97 : 1.12);
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
    if (block.type.startsWith('table')) return tableHTML(block);
    if (block.type === 'parameters') return '<dl class="article-parameters">' + block.rows.map(row =>
      `<dt>${inlineRuns(row.label)}</dt><dd>${inlineRuns(row.value)}</dd>`).join('') + '</dl>';
    if (block.type === 'source') {
      const {top, bottom, width, height} = block;
      const scale = 10000 / (bottom - top);
      const lines = [];
      for (const run of block.runs) {
        if (lines.length && lines.at(-1)[0].line === run.line) lines.at(-1).push(run);
        else lines.push([run]);
      }
      const transcription = lines.map(line => line.map(run => escapeHtml(run.text)).join('')).join('\n');
      return `<figure class="article-figure source-page" data-page="${block.p}" data-offset="${block.a}">
        <div class="source-sheet" style="aspect-ratio:${width}/${height * (bottom - top) / 100}">
          <img src="${block.src}" style="top:${-top * scale / 100}%;height:${scale}%" alt="PDF 第 ${block.p + 1} 页" loading="lazy" decoding="async">
          ${block.anchors.map(({a, y}) => `<span class="source-anchor" data-page="${block.p}" data-offset="${a}" style="top:${(y - top) * scale / 100}%"></span>`).join('')}
          <div class="source-highlights" aria-hidden="true">${originalHighlights(block)}</div>
        </div>
        <figcaption><a href="${escapeHtml(block.original)}" target="_blank" rel="noopener">原版面 · PDF ${block.p + 1}</a></figcaption>
        ${lines.length ? '<details class="figure-text"><summary>可复制文字</summary><div class="source-transcript">' + transcription + '</div></details>' : ''}
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
    return `<${tag} class="${className}"${style}>${inlineRuns(block.runs)}</${tag}>`;
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
    if (fresh[0]?.type === 'source' && fresh[0].a === 0 && fresh[0].b === entry.document.texts[part.p].length) {
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
    ? `<h2 data-page="${entry.p}" data-offset="${entry.a}">${entry.parentId ? '<small>' + escapeHtml(entry.attachmentLabel || '附件') + '</small>' : ''}${escapeHtml(entry.title)}</h2>` : '')
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
  const chosen=entries.find(e=>e.id===id) || results.find(result => result.entry.id === id)?.entry;
  if(!chosen)return;
  selected=chosen;readerDocument=chosen.document;const serial=++renderSerial;
  const root=entries.find(e=>e.id===(chosen.parentId||chosen.id))||chosen;
  articleFamily=[root,...entries.filter(e=>e.parentId===root.id)].sort((a,b)=>a.p-b.p||a.a-b.a);
  page=targetPage ?? chosen.p;hits=[];hitIndex=-1;articleMarks=[];
  for(const button of $('results').querySelectorAll('.result')){button.classList.toggle('active',button.dataset.id===id);button.setAttribute('aria-pressed',String(button.dataset.id===id));}
  $('documentName').textContent=readerDocument.file;$('previewTitle').textContent=root.title;
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
