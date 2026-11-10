'use strict';
function sliceReadingRuns(runs, start, end) {
  return runs.filter(run => run.b > start && run.a < end).map(run => {
    const a = Math.max(run.a, start), b = Math.min(run.b, end);
    return {...run, a, b, text: run.text.slice(a - run.a, b - run.a)};
  });
}

function startsReadingParagraph(text) {
  return /^(第[一二三四五六七八九十百\d]+条|[一二三四五六七八九十]+[、.]|\d{1,3}[.、](?!\d)|[（(][一二三四五六七八九十\d]+[)）]|附件|附表|注[:：])/.test(text);
}

// Prose reflows; table geometry preserves row/column correspondence and merged cells.
function articleBlocks(runs, rules, width, height, part, title) {
  const selectedRuns = sliceReadingRuns(runs, part.a, part.b);
  const tables=tableRegions(selectedRuns,rules,width,part.strict);
  const tableRuns=new Set(tables.flatMap(t=>t.runs));
  const rows=[];
  for(const run of selectedRuns) {
    if(tableRuns.has(run))continue;
    // Repeated page furniture is excluded from the article, but stays in the original PDF.
    if((run.y<height*.11 || run.y>height*.94) && /^[\d.·□、()（）—\-\s]+$/.test(run.text)) continue;
    if(/^[\ue000-\uf8ff~]+$/.test(run.text)) continue;
    let row=rows.at(-1);
    if(!row || (part.strict && run.line != null ? row.line !== run.line :
        Math.abs(row.y-run.y)>Math.max(run.size,row.size)*.85)) {
      row={y:run.y,size:run.size,line:run.line,runs:[]};rows.push(row);
    }
    row.runs.push(run);row.size=Math.max(row.size,run.size);
  }
  const blocks=[];
  const headingKey = value => value.normalize('NFKC').toLowerCase().replace(/[\s：:]/g, '');
  const titleKey = headingKey(title);
  const firstRows = rows.filter(row => row.runs[0].a < part.a + 260).slice(0, 12);
  const suppressed = new Set();
  for (let i = 0; titleKey && i < firstRows.length; i++) {
    let key = '';
    for (let j = i; j < Math.min(firstRows.length, i + 5); j++) {
      const value = headingKey(firstRows[j].runs.map(r => r.text).join(''));
      key += j === i ? value.replace(/^(?:附件|附表|附图|附录)[一二三四五六七八九十\d]+/, '') : value;
      if (key === titleKey) {
        firstRows.slice(i, j + 1).forEach(row => suppressed.add(row));
        break;
      }
      if (!titleKey.startsWith(key)) break;
    }
    if (suppressed.size) break;
  }
  const longRows = rows.filter(row => row.runs.map(run => run.text).join('').length >= 16);
  const margin = Math.min(...(longRows.length ? longRows : rows).map(row => row.runs[0].x));
  for(const row of rows) {
    const content=row.runs.map(r=>r.text).join('');
    while(tables.length && tables[0].top<row.y)blocks.push(tables.shift());
    if (part.strict && suppressed.has(row)) {
      const titleRows = [...suppressed];
      if (row === titleRows[0]) {
        blocks.push({type: 'document-title', centered: true, runs: titleRows.flatMap(row => row.runs)});
      }
      continue;
    }
    const leader = /(?:\.{4,}|[⋯…·]{3,})/.exec(content);
    if (leader && leader.index > 0 && leader.index + leader[0].length < content.length) {
      let offset = 0;
      const label = [], value = [];
      const valueStart = leader.index + leader[0].length;
      for (const run of row.runs) {
        const end = offset + run.text.length;
        if (offset < leader.index) label.push({...run, text: run.text.slice(0, leader.index - offset)});
        if (end > valueStart) {
          const skip = Math.max(0, valueStart - offset);
          value.push({...run, a: run.a + skip, text: run.text.slice(skip)});
        }
        offset = end;
      }
      const previous = blocks.at(-1);
      const rowData = {label, value};
      if (previous?.type === 'parameters') previous.rows.push(rowData);
      else blocks.push({type: 'parameters', rows: [rowData]});
      continue;
    }
    const heading=/^第[一二三四五六七八九十百\d]+[编章节目]/.test(content) ||
      /^[一二三四五六七八九十]+、[^，。；：:！？]{1,22}$/.test(content) ||
      (row.runs.every(r=>r.bold) && content.length<55);
    if(!part.strict && (content===title || (content.length>5 && title.includes(content) && row.runs[0].a<part.a+180))) continue;
    if (!part.strict && title && content.endsWith(title) && row.runs[0].a < part.a + 180 &&
        /^(?:附件|附表|附图|附录).{0,8}[:：]$/.test(content.slice(0, -title.length))) continue;
    if(/^(附件|附表|附录)[一二三四五六七八九十\d]*[:：]?$/.test(content)) continue;
    if(/^[\u4e00-\u9fff]{0,15}[〔(\[]\d{2,4}[〕)\]][\u4e00-\u9fff]{0,8}\d+号$/.test(content) || /^[一二三四五六七八九十〇○零\d]{4}年.{1,18}日$/.test(content)){blocks.push({type:'metadata',runs:row.runs});continue;}
    const x = row.runs[0].x, lastRun = row.runs.at(-1);
    const right = lastRun.x + (lastRun.width || lastRun.size * lastRun.text.length);
    const centered = (heading || content.length <= 45 && tables[0]?.top - row.y < row.size * 5)
      && Math.abs((x + right) / 2 - width / 2) < width * .06 && x - margin > row.size * 2;
    const alignedRight = x > width * .48 && (x + right) / 2 > width * .64 && content.length < 60;
    if (heading || centered) { blocks.push({type: 'heading', runs: row.runs, centered}); continue; }
    if (part.strict) {
      const indent = alignedRight ? 0 : Math.max(0, Math.min(8, (x - margin) / row.size));
      blocks.push({type: alignedRight ? 'annotation' : 'line', indent, runs: row.runs});
      continue;
    }
    const starts = startsReadingParagraph(content);
    const last=blocks.at(-1),tail=last?.runs?.at(-1)?.text || '';
    if(last?.type==='paragraph' && !starts && !/[。；;：:！？!?]$/.test(tail)) last.runs.push(...row.runs);
    else blocks.push({type:'paragraph',runs:row.runs});
  }
  blocks.push(...tables);
  return blocks;
}

// Reconstruct cells from every rule segment, including partial rules around merged cells.
function readingRules(paths) {
  const lines=[];
  const add=(x,y,x2,y2)=>{
    if(Math.abs(y-y2)<.6 && Math.abs(x-x2)>1)lines.push({h:true,v:y,a:Math.min(x,x2),b:Math.max(x,x2)});
    else if(Math.abs(x-x2)<.6 && Math.abs(y-y2)>1)lines.push({h:false,v:x,a:Math.min(y,y2),b:Math.max(y,y2)});
  };
  for(const path of paths){
    for(const m of path.matchAll(/M(-?[\d.]+),(-?[\d.]+)L(-?[\d.]+),(-?[\d.]+)/g))add(...m.slice(1).map(Number));
    for(const m of path.matchAll(/M(-?[\d.]+),(-?[\d.]+)h(-?[\d.]+)v(-?[\d.]+)/g)){
      const [x,y,w,h]=m.slice(1).map(Number);
      if (Math.abs(h) <= 1.2) add(x, y + h / 2, x + w, y + h / 2);
      else if (Math.abs(w) <= 1.2) add(x + w / 2, y, x + w / 2, y + h);
      else { add(x,y,x+w,y);add(x+w,y,x+w,y+h);add(x+w,y+h,x,y+h);add(x,y+h,x,y); }
    }
  }
  return lines;
}

function verifyReadingUnderlines(runs, paths) {
  if (!runs.some(run => run.underline)) return;
  const lines = readingRules(paths);
  const verticals = lines.filter(line => !line.h);
  const underlines = lines.filter(line => line.h && !verticals.some(vertical =>
    vertical.a <= line.v + 1.5 && vertical.b >= line.v - 1.5 &&
    vertical.v >= line.a - 1.5 && vertical.v <= line.b + 1.5));
  for (const run of runs) {
    if (!run.underline) continue;
    const stroke = underlines.find(line =>
      Math.abs(line.v - run.y) <= run.size * .45 &&
      line.a <= run.x + run.size * .2 && line.b >= run.x + run.width - run.size * .2);
    // A centered second line immediately below the stroke can be a denominator.
    run.fraction = !!stroke && runs.some(other => other.line !== run.line &&
      other.y > stroke.v + run.size * .45 && other.y <= stroke.v + run.size * 1.25 &&
      other.x >= stroke.a - 1 && other.x + other.width <= stroke.b + 1 &&
      Math.abs(other.x + other.width / 2 - (stroke.a + stroke.b) / 2) <= run.size * .4);
    run.underline = !!stroke && !run.fraction;
  }
}

function canDisplayReadingPart(blocks, decoded, part) {
  if (!blocks.length || blocks.some(block => block.type === 'table-layout')) return false;
  const {runs, width, rules} = decoded;
  const selected = runs.filter(run => run.a >= part.a && run.a < part.b);
  if (!selected.length) return false;
  const bands = new Map();
  const gutters = [];
  const tables = blocks.filter(block => block.type === 'table');
  const inTable = new Set(tables.flatMap(table => table.runs.map(run => run.a)));
  for (const run of selected) {
    if (run.b > part.b || run.fraction || !Number.isFinite(run.width) || !Number.isFinite(run.y)) return false;
    if (inTable.has(run.a)) continue;
    const band = bands.get(run.line) || [];
    const previous = band.at(-1);
    const gap = previous ? run.x - previous.x - previous.width : 0;
    if (previous && (gap < -Math.min(run.size, previous.size) * .5 ||
        gap > Math.max(run.size * 2.8, width * .065))) return false;
    if (gap >= Math.max(3, run.size * .55)) {
      const center = run.x - gap / 2;
      const gutter = gutters.find(item => Math.abs(item.center - center) <= 2);
      if (gutter) gutter.lines.add(run.line);
      else gutters.push({center, lines: new Set([run.line])});
    }
    band.push(run);
    bands.set(run.line, band);
  }
  // Aligned blank lanes over several rows indicate columns even without a grid.
  if (gutters.filter(gutter => gutter.lines.size >= 3).length >= 2) return false;
  const top = Math.min(...selected.map(run => run.y - run.size));
  const bottom = Math.max(...selected.map(run => run.y + run.size * .4));
  return readingRules(rules).every(rule => {
    if (rule.h ? rule.v < top || rule.v > bottom : rule.b < top || rule.a > bottom) return true;
    if (tables.some(table =>
        (rule.h ? rule.v >= table.top - 1.5 && rule.v <= table.bottom + 1.5 &&
          rule.a >= table.left - 1.5 && rule.b <= table.right + 1.5 :
          rule.v >= table.left - 1.5 && rule.v <= table.right + 1.5 &&
          rule.a >= table.top - 1.5 && rule.b <= table.bottom + 1.5))) return true;
    // A rule under styled text is safe only if it is covered by that underlined run.
    if (!rule.h) return false;
    const styled = selected.filter(run => run.underline && Math.abs(run.y - rule.v) <= run.size * .45 &&
      run.x + run.width > rule.a && run.x < rule.b);
    return styled.length > 0 && Math.min(...styled.map(run => run.x)) <= rule.a + 2 &&
      Math.max(...styled.map(run => run.x + run.width)) >= rule.b - 2;
  });
}

function tableRegions(runs, paths, pageWidth, strict = false) {
  const lines = readingRules(paths);
  const parent=lines.map((_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
  const join=(a,b)=>{parent[find(a)]=find(b);};
  for(let i=0;i<lines.length;i++)for(let j=0;j<i;j++){
    const a=lines[i],b=lines[j];
    const meets=a.h===b.h?Math.abs(a.v-b.v)<1 && Math.max(a.a,b.a)<=Math.min(a.b,b.b)+1:
      (a.v>=b.a-1 && a.v<=b.b+1 && b.v>=a.a-1 && b.v<=a.b+1);
    if(meets)join(i,j);
  }
  const groups=new Map();lines.forEach((l,i)=>{const k=find(i);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(l);});
  const unique=values=>{const out=[];for(const v of values.sort((a,b)=>a-b))if(!out.length||v-out.at(-1)>1)out.push(v);return out;};
  // Older editions often draw a double outer border separately from the inner grid.
  // Combine overlapping grid regions before assigning text, so a cell is emitted once.
  const candidates=[];
  for(const rules of groups.values()){
    const xs=unique(rules.filter(l=>!l.h).map(l=>l.v)),ys=unique(rules.filter(l=>l.h).map(l=>l.v));
    if(xs.length<2 || ys.length<2 || xs.at(-1)-xs[0]<pageWidth*.12 || ys.at(-1)-ys[0]<12)continue;
    let region={rules,left:xs[0],right:xs.at(-1),top:ys[0],bottom:ys.at(-1)};
    for(let i=candidates.length-1;i>=0;i--){const other=candidates[i];
      if(Math.min(region.right,other.right)-Math.max(region.left,other.left)>1 && Math.min(region.bottom,other.bottom)-Math.max(region.top,other.top)>1){
        region={rules:[...region.rules,...other.rules],left:Math.min(region.left,other.left),right:Math.max(region.right,other.right),top:Math.min(region.top,other.top),bottom:Math.max(region.bottom,other.bottom)};
        candidates.splice(i,1);i=candidates.length;
      }
    }
    candidates.push(region);
  }
  const tables=[];
  for(const candidate of candidates){
    const {rules} = candidate;
    const xs=unique(rules.filter(l=>!l.h).map(l=>l.v)),ys=unique(rules.filter(l=>l.h).map(l=>l.v));
    if(xs.length<2 || ys.length<2 || xs.at(-1)-xs[0]<pageWidth*.12 || ys.at(-1)-ys[0]<12)continue;
    const left=xs[0],right=xs.at(-1),top=ys[0];
    let bottom=ys.at(-1);
    // Some originals leave the final row open at the foot of the page.
    const edgeEnd = x => Math.max(bottom, ...rules.filter(line =>
      !line.h && Math.abs(line.v - x) < 1.1 && line.a <= bottom + 1
    ).map(line => line.b));
    const leftEnd = edgeEnd(left), rightEnd = edgeEnd(right);
    const openEnd = Math.min(leftEnd, rightEnd);
    const overlapsNext = candidates.some(other => other !== candidate &&
      other.left < right && other.right > left && other.top < openEnd && other.bottom > bottom);
    if (Math.abs(leftEnd - rightEnd) <= 1.1 && openEnd > bottom + 4 && !overlapsNext) {
      bottom = openEnd;
      ys.push(bottom);
    }
    const inside=runs.filter(r=>r.x>=left-1 && r.x<right && r.y-r.size*.3>=top && r.y-r.size*.3<bottom);
    if(!inside.length)continue;
    const columns=xs.length-1,rowCount=ys.length-1;
    // Excessively fragmented drawings are retained geometrically instead of guessed as cells.
    const fallback=()=>tables.push({type:'table-layout',runs:inside,rules,left,right,top,bottom});
    if(columns*rowCount>4000){fallback();continue;}
    const cells=Array.from({length:columns*rowCount},(_,i)=>i),root=i=>cells[i]===i?i:(cells[i]=root(cells[i]));
    function closed(h,v,a,b){
      const spans=rules.filter(l=>l.h===h && Math.abs(l.v-v)<1.1 && l.b>a && l.a<b).map(l=>[Math.max(a,l.a),Math.min(b,l.b)]).sort((x,y)=>x[0]-y[0]);
      let end=a,total=0,maxGap=0;
      for(const [x,y] of spans){if(y>end){maxGap=Math.max(maxGap,x-end);total+=y-Math.max(x,end);end=y;}}
      return strict ? Math.max(maxGap, b - end) <= 1.5 && total >= (b - a) * .8 : total >= (b - a) * .85;
    }
    if (strict && (!closed(true, top, left, right) || !closed(true, bottom, left, right) ||
        !closed(false, left, top, bottom) || !closed(false, right, top, bottom))) {
      fallback();
      continue;
    }
    for(let row=0;row<rowCount;row++)for(let col=0;col<columns;col++){
      const i=row*columns+col;
      if(col && !closed(false,xs[col],ys[row],ys[row+1]))cells[root(i)]=root(i-1);
      if(row && !closed(true,ys[row],xs[col],xs[col+1]))cells[root(i)]=root(i-columns);
    }
    const merged=new Map();
    for(let row=0;row<rowCount;row++)for(let col=0;col<columns;col++){
      const id=root(row*columns+col);if(!merged.has(id))merged.set(id,{r0:row,r1:row,c0:col,c1:col,n:0,runs:[]});
      const cell=merged.get(id);cell.r0=Math.min(cell.r0,row);cell.r1=Math.max(cell.r1,row);cell.c0=Math.min(cell.c0,col);cell.c1=Math.max(cell.c1,col);cell.n++;
    }
    if([...merged.values()].some(c=>c.n!==(c.r1-c.r0+1)*(c.c1-c.c0+1))){fallback();continue;}
    let crossesRule = false;
    for(const run of inside){
      const col=Math.max(0,Math.min(columns-1,xs.findIndex(x=>x>run.x+1)-1));
      const row=Math.max(0,Math.min(rowCount-1,ys.findIndex(y=>y>run.y-run.size*.3)-1));
      const cell = merged.get(root(row*columns+col));
      crossesRule ||= run.x < xs[cell.c0] - 1.5 || run.x + run.width > xs[cell.c1 + 1] + 1.5;
      cell.runs.push(run);
    }
    if (strict && crossesRule) { fallback(); continue; }
    const rows=Array.from({length:rowCount},()=>[]);
    for(const cell of merged.values()){
      cell.lines=[];
      for(const run of cell.runs.slice().sort((a,b)=>a.y-b.y||a.x-b.x)){
        let line=cell.lines.at(-1);
        if(!line || Math.abs(run.y-line.y)>Math.max(run.size,line.size)*.85){line={y:run.y,size:run.size,runs:[]};cell.lines.push(line);}
        line.runs.push(run);
      }
      for(const line of cell.lines)line.runs.sort((a,b)=>a.x-b.x);
      rows[cell.r0].push(cell);
    }
    rows.forEach(row=>row.sort((a,b)=>a.c0-b.c0));
    // Some older mileage sheets omit rules between stations. Several parallel
    // stacks of mileage values signal that the lines themselves carry row alignment.
    const hasUnruledRows = rows.some(row => row.filter(cell =>
      cell.lines.filter(line => /^[\d０-９]+(?:[.．][\d０-９]+)?$/.test(
        line.runs.map(run => run.text).join('')
      )).length >= (strict ? 2 : 3)
    ).length >= 2);
    if (hasUnruledRows) {
      fallback();
      continue;
    }
    tables.push({type:'table',rows,xs,ys,left,right,top,bottom,runs:inside,columns,rules});
  }
  return tables.sort((a,b)=>a.top-b.top||a.left-b.left);
}

function tableCellRuns(cell) {
  return cell.lines.flatMap(line => line.runs);
}

function tableCellText(cell) {
  return tableCellRuns(cell).map(run => run.text).join('').normalize('NFKC').replace(/\s+/g, '');
}

function joinTableContinuation(previous, nextBlocks, strict = false) {
  if (!previous?.type.startsWith('table')) return;
  const first = nextBlocks[0];
  const marker = first?.runs && !first.type.startsWith('table') &&
    /^[（(]?(?:续上表|续表|接上表)[）)]?[:：]?$/.test(first.runs.map(run => run.text).join('').replace(/\s+/g, ''));
  const next = nextBlocks[marker ? 1 : 0];
  if (!next?.type.startsWith('table')) return;
  const prior = previous.type === 'table-series' ? previous.tables.at(-1) : previous;
  const priorWidth = prior.right - prior.left;
  const nextWidth = next.right - next.left;
  if (Math.abs(priorWidth - nextWidth) > priorWidth * .08) return;
  function groupOriginalGrids() {
    if (strict || !marker) return;
    if (previous.type !== 'table-series') {
      previous.tables = [{...previous}];
      previous.type = 'table-series';
    }
    previous.tables.push(next);
    nextBlocks.splice(0, 2);
  }
  if (previous.type !== 'table' || next.type !== 'table' || next.columns !== previous.columns) {
    groupOriginalGrids();
    return;
  }
  const fractions = table => table.xs.map(x => (x - table.left) / (table.right - table.left));
  const firstWidths = fractions(previous);
  if (fractions(next).some((x, i) => Math.abs(x - firstWidths[i]) > .025)) {
    groupOriginalGrids();
    return;
  }

  const rowKey = row => JSON.stringify(row.map(cell => [
    cell.c0, cell.c1, cell.r1 - cell.r0, tableCellText(cell)
  ]));
  const looksLikeHeading = row => row.some(cell =>
    /站名|车站名称|里程|区划|品名|名称|序号|项目|代码|接续线名|备注|^单位$/.test(tableCellText(cell))
  );
  // A header with merged cells can occupy multiple physical rows.
  const headerRows = looksLikeHeading(previous.rows[0])
    ? Math.max(...previous.rows[0].map(cell => cell.r1 + 1)) : 0;
  const repeated = headerRows > 0 && next.rows.length > headerRows &&
    previous.rows.slice(0, headerRows).every((row, i) =>
      row.every(cell => cell.r1 < headerRows) && rowKey(row) === rowKey(next.rows[i]));
  // A new heading, or a mismatch in a known heading, means a separate table.
  if (!repeated && (!marker || looksLikeHeading(next.rows[0]))) {
    groupOriginalGrids();
    return;
  }

  const skip = repeated ? headerRows : 0;
  const shift = previous.rows.length - skip;
  const rows = next.rows.slice(skip).map(row => row.map(cell => ({
    ...cell, r0: cell.r0 + shift, r1: cell.r1 + shift
  })));
  previous.rows.push(...rows);
  previous.runs.push(...rows.flatMap(row => row.flatMap(cell => cell.runs)));
  nextBlocks.splice(0, marker ? 2 : 1);
}
