const fs=require('fs'),assert=require('assert');
const articleBlocks=new Function(fs.readFileSync(__dirname+'/../offline/flow.js','utf8')+';return articleBlocks;')();
let a=0;const run=(text,x,y,bold=false)=>{const r={text,a,b:a+text.length,x,y,size:10,bold,p:0};a=r.b;return r;};
const rows=[run('第一章总则',40,100,true),run('根据本规定，',30,130),run('办理有关事项。',20,145),run('第二条其他规定。',30,165)];
const blocks=articleBlocks(rows,[],300,500,{a:0,b:a},'某通知');
assert.deepEqual(blocks.map(b=>b.type),['heading','paragraph','paragraph']);
assert.equal(blocks[1].runs.map(r=>r.text).join(''),'根据本规定，办理有关事项。');
a=0;
const cells=[run('站名',30,100),run('里程',130,100),run('甲站',30,120),run('12',130,120)];
const table=articleBlocks(cells,['M20,90L20,140M110,90L110,140M210,90L210,140M20,90L210,90M20,110L210,110M20,140L210,140'],300,500,{a:0,b:a},'表');
assert.equal(table[0].type,'table');assert.equal(table[0].rows.length,2);assert.equal(table[0].rows[1][1].runs[0].text,'12');
assert(!fs.readFileSync(__dirname+'/../offline/reader.js','utf8').includes('scrollIntoView'));
console.log('通过：标题分级、段落合并、条文起段、表格分列及局部滚动。');
// A keyword spanning extracted runs stays one navigable hit and retains its source location.
const reader=fs.readFileSync(__dirname+'/../offline/reader.js','utf8');
const inlineSource=reader.slice(reader.indexOf('function readingMatches('),reader.indexOf('function blocksHTML('));
const inline=new Function('normalize','escapeHtml','terms',inlineSource+';return inlineRuns;')(s=>s.normalize('NFKC').replace(/\s+/g,'').toLowerCase(),s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;'),['南京北站','2025']);
const marked=inline([{text:'南京',a:30,p:2},{text:'北站２０',a:32,p:2},{text:'２５',a:36,p:2}]);
assert.equal((marked.match(/<mark /g)||[]).length,2);
assert(marked.includes('<mark data-page="2" data-offset="30">'));
assert(marked.includes('<mark data-page="2" data-offset="34">'));
console.log('通过：跨行关键词与全角数字高亮、原文位置映射。');

// Partial rules are row boundaries too; merged headers must not split the table.
a=0;
const mergedRuns=[run('分组',25,20),run('里程',125,20),run('起点',75,40),run('终点',125,40),run('甲',25,70),run('甲站',75,60),run('10',125,60),run('乙站',75,80),run('20',125,80)];
const rules=['M0,0L150,0M0,100L150,100M0,0L0,100M150,0L150,100M50,0L50,100M100,30L100,100M50,30L150,30M0,50L150,50M50,75L150,75'];
const grid=articleBlocks(mergedRuns,rules,200,200,{a:0,b:a},'').filter(b=>b.type==='table');
assert.equal(grid.length,1);assert.equal(grid[0].rows.length,4);
assert.equal(grid[0].rows[0][0].r1,1);assert.equal(grid[0].rows[0][1].c1,2);
assert.equal(grid[0].rows[2][0].r1,3);
assert.equal(grid[0].rows[2][2].runs[0].text,'10');assert.equal(grid[0].rows[3][1].runs[0].text,'20');
console.log('通过：跨行/跨列表头、局部横线、站名里程逐行对应。');
// A separately drawn outer frame must not duplicate the inner table's text.
const framed=articleBlocks(mergedRuns,[...rules,'M-2,-2L152,-2M152,-2L152,102M152,102L-2,102M-2,102L-2,-2'],200,200,{a:0,b:a},'').filter(b=>b.type.startsWith('table'));
const offsets=framed.flatMap(b=>b.runs.map(r=>r.a));assert.equal(offsets.length,new Set(offsets).size);
assert.equal(framed.length,1);
console.log('通过：独立双线外框与内部网格合并，文字不重复。');

a=0;
const parameterRuns = [run('车型⋯⋯⋯DF11', 20, 105), run('单个轴重⋯⋯⋯23t', 20, 120),
  run('五、车体', 20, 145), run('1.车体倾斜50毫米;', 20, 165)];
const parameters = articleBlocks(parameterRuns, [], 300, 500, {a: 0, b: a}, '');
assert.deepEqual(parameters.map(b => b.type), ['parameters', 'heading', 'paragraph']);
assert.equal(parameters[0].rows[1].label[0].text, '单个轴重');
assert.equal(parameters[0].rows[1].value[0].text, '23t');
assert.equal(parameters[0].rows[1].value[0].a, parameterRuns[1].a + '单个轴重⋯⋯⋯'.length);
console.log('通过：点引线参数逐行对应，编号条款与上方标题分开。');

const verifyReadingUnderlines = new Function(
  fs.readFileSync(__dirname + '/../offline/flow.js', 'utf8') + ';return verifyReadingUnderlines;'
)();
const underlineRuns = [
  {...run('真实线', 20, 30), underline: true, width: 28},
  {...run('线框数字', 20, 60), underline: true, width: 35},
  {...run('细矩形线', 75, 30), underline: true, width: 36},
  {...run('无图形证据', 130, 30), underline: true, width: 42},
  {...run('灭失重量', 20, 85), underline: true, width: 40, line: 3},
  {...run('总重量', 25, 96), width: 30, line: 4}
];
verifyReadingUnderlines(underlineRuns, [
  'M19.5,32L48.5,32',
  'M10,45h100v17h-100Z',
  'M75,31h36v0.6h-36Z',
  'M20,87L60,87'
]);
assert.deepEqual(underlineRuns.map(run => !!run.underline), [true, false, true, false, false, false]);
assert(underlineRuns[4].fraction);
console.log('通过：保留文字下方独立的线段和细矩形，排除表格边线及无几何证据的下划线。');

const {tableRegions, tableProfile} = new Function(
  fs.readFileSync(__dirname + '/../offline/flow.js', 'utf8') + ';return {tableRegions, tableProfile};'
)();
a = 0;
const schedule = [
  ['车次', 14, 24], ['到达', 78, 24], ['开车', 138, 24],
  ['0003', 14, 44], ['07:03', 78, 44], ['07:06', 138, 44],
  ['0004', 14, 60], ['09:12', 78, 60], ['09:16', 138, 60]
].map(([text,x,y]) => ({...run(text,x,y), width: 24}));
const frame = 'M10,10L190,10M10,32L190,32M10,75L190,75M10,10L10,75M70,10L70,75M130,10L130,75M190,10L190,75';
const [ruled] = tableRegions(schedule, [frame + 'M10,51L190,51'], 220, true);
assert.equal(ruled.type, 'table');
assert.equal(tableProfile(ruled).family, 'train');
assert.deepEqual(tableProfile(ruled).columns.map(column => column.kind), ['code','time','time']);
const [unruled] = tableRegions(schedule, [frame], 220, true);
assert.equal(unruled.type, 'table-layout');
console.log('通过：分格时刻表保留车次和到开时刻，多站时刻共用一格时采用原版面。');

a = 0;
const noticeRows = [
  {...run('中国国家铁路集团有限公司',50,60,true),width:200,line:0},
  {...run('关于开通运营的通知',70,90,true),width:160,line:1},
  {...run('各铁路局集团公司:',30,120),width:100,line:2},
  {...run('这是正文第一行。',50,145),width:200,line:3},
  {...run('同一个自然段继续。',30,160),width:220,line:4},
  {...run('这是第二个自然段。',50,185),width:200,line:5},
  {...run('继续到这里结束。',30,200),width:130,line:6}
];
const noticeBlocks = articleBlocks(noticeRows,[],300,500,{a:0,b:a,strict:true},'关于开通运营的通知');
const paragraphs = noticeBlocks.filter(block=>block.type==='paragraph');
assert.equal(paragraphs.length,3);
assert.equal(paragraphs[1].runs.map(run=>run.text).join(''),'这是正文第一行。同一个自然段继续。');
assert.equal(paragraphs[2].runs.map(run=>run.text).join(''),'这是第二个自然段。继续到这里结束。');
assert(paragraphs[1].indent > 1.5 && paragraphs[1].indent < 2.5);
const {joinTableContinuation} = new Function(fs.readFileSync(__dirname+'/../offline/flow.js','utf8')+';return {joinTableContinuation};')();
const first = structuredClone(ruled), second = structuredClone(ruled);
first.context=['甲站—乙站'];
const nextBlocks = [{type:'annotation',runs:[{text:'甲站—乙站'}]}, {type:'continuation',runs:[{text:'续上表'}]},second];
joinTableContinuation(first,nextBlocks,true);
assert.equal(first.rows.length,5);
assert.equal(nextBlocks.length,0);
console.log('通过：按正文缩进合并自然段，保留段内句号，续表去除重复标注和表头。');

// Extractors sometimes place a bold heading and the preceding prose on one line ID.
a=0;
const mixedLine = [
  {...run('现将有关事项通知如下:',20,100),size:21,width:110,line:0},
  {...run('一、《客运运价里程表》修改内容',40,115.5,true),size:20.4,width:150,line:0},
  {...run('1.相关规定见附件。',40,131),size:21,width:160,line:2}
];
const mixedBlocks=articleBlocks(mixedLine,[],300,500,{a:0,b:a,strict:true},'');
assert.deepEqual(mixedBlocks.map(block=>block.type),['paragraph','heading','paragraph']);
assert.equal(mixedBlocks[1].runs.map(run=>run.text).join(''),'一、《客运运价里程表》修改内容');

// Underlined names in adjacent ruled rows must not be mistaken for a fraction.
const stationUnderline=[
  {...run('西涧河所',30,100,true),size:18,width:36,line:1,underline:true},
  {...run('太原东',34,116,true),size:18,width:28,line:2,underline:true}
];
verifyReadingUnderlines(stationUnderline,['M30,102L66,102M34,118L62,118M20,108L90,108M20,90L20,125M90,90L90,125']);
assert(stationUnderline.every(run=>run.underline && !run.fraction));
console.log('通过：同一文字块内标题独立成行，跨单元格下划线不误判为分式。');

const splitReadingColumns=new Function(fs.readFileSync(__dirname+'/../offline/flow.js','utf8')+';return splitReadingColumns')();
a=0;
const headerRuns=[
  {...run('铁运电〔',20,35),line:'reference',width:40},
  {...run('2025',60,41),line:'reference',width:20},
  {...run('〕81号',80,35),line:'reference',width:30},
  {...run('(仅供参考)(2022',180,20),line:'furniture',width:80},
  {...run('2、3)',260,20),line:'furniture',width:25}
];
const markedHeaders=splitReadingColumns(headerRuns,[],[],300,500);
const headerBlocks=articleBlocks(markedHeaders,[],300,500,{a:0,b:a,strict:true},'');
assert.equal(headerBlocks.flatMap(block=>block.runs).map(run=>run.text).join(''),'铁运电〔2025〕81号');
assert.equal(headerBlocks[0].type,'metadata');
const privateHeader=splitReadingColumns([
  {text:'(2013\ue0106)',a:0,b:8,x:200,y:40,width:50,size:10,line:'0'},
  {text:'··1',a:8,b:11,x:270,y:40,width:15,size:10,line:'0'}
],[],[],300,500);
assert(privateHeader.every(run=>run.furniture));
console.log('通过：按整行识别页眉，保留文号年份，移除完整的参考标注。');

const canDisplayReadingPart=new Function(fs.readFileSync(__dirname+'/../offline/flow.js','utf8')+';return canDisplayReadingPart')();
a=0;
const numbered=[];
for(let i=0;i<4;i++) {
  numbered.push({...run('7.1.'+(i+1),20,120+i*20),width:22,line:i});
  numbered.push({...run('按照有关规定办理相关事项。',77,120+i*20),width:170,line:i});
}
const numberedPart={a:0,b:a,strict:true};
assert(canDisplayReadingPart(articleBlocks(numbered,[],300,500,numberedPart,''),
  {runs:numbered,rules:[],width:300,height:500},numberedPart));
console.log('通过：多级条款编号后的空白不误判为表格列间空白。');

// Inflated Chinese font metrics must not interleave consecutive physical rows.
const tablePhysicalLines=new Function(fs.readFileSync(__dirname+'/../offline/flow.js','utf8')+';return tablePhysicalLines')();
a=0;
const narrowName=[];
for(const [row,text]of ['内蒙古鑫诺蒙','西物流有限公','司专用铁路'].entries()) {
  for(const [column,character]of [...text].entries())narrowName.push({...run(character,100+column*7.5,110+row*8.83),size:16.04,width:16.04,line:row<2?'69':'99'});
}
const nameLines=tablePhysicalLines(narrowName);
assert.deepEqual(nameLines.map(line=>line.runs.map(run=>run.text).join('')),['内蒙古鑫诺蒙','西物流有限公','司专用铁路']);
a=0;
const mixedPunctuation=[
  {...run('甲',20,100),width:16,size:16,line:'same'},
  {...run(',',30,106),width:9,size:9,line:'same'},
  {...run('乙',39,100),width:16,size:16,line:'same'},
  {...run('丙',20,109),width:16,size:16,line:'same'}
];
assert.deepEqual(tablePhysicalLines(mixedPunctuation).map(line=>line.runs.map(run=>run.text).join('')),['甲,乙','丙']);

// Real outer cells remain intact; proven parallel records get aligned subrows.
a=0;
const recordRuns=[
  {...run('页数',5,60),width:20}, {...run('线名',40,60),width:20},
  {...run('站名',80,60),width:20}, {...run('修改内容',125,60),width:60}
];
for(const [i,station]of ['五原','四分滩','头道桥'].entries()) {
  const y=90+i*20;
  recordRuns.push({...run('22',5,y),width:12},{...run('包兰',40,y),width:20},
    {...run(station,80,y),width:30},{...run(i?'增加△':'改为△',125,y),width:40});
}
const recordRules=['M0,40L220,40M0,70L220,70M0,150L220,150M0,40L0,150M35,40L35,150M70,40L70,150M120,40L120,150M220,40L220,150'];
const [records]=tableRegions(recordRuns,recordRules,250,true);
assert.equal(records.type,'table');assert.equal(records.rows.length,2);assert(records.logicalRows);
assert(records.rows[1].every(cell=>cell.recordBands.length===3));
assert.deepEqual(records.rows[1][3].recordBands.map(band=>band.runs.map(run=>run.text).join('')),['改为△','增加△','增加△']);
const sparseRecordRuns=recordRuns.filter(run=>!/(?:改为|增加)△/.test(run.text)||run.y===110);
const [sparseRecords]=tableRegions(sparseRecordRuns,recordRules,250,true);
assert.deepEqual(sparseRecords.rows[1][3].recordBands.map(band=>({p:band.p,y:band.sourceY,text:band.runs.map(run=>run.text).join('')})),[
 {p:0,y:87,text:''},{p:0,y:107,text:'增加△'},{p:0,y:127,text:''}
]);
const emptyNotes=recordRuns.filter(run=>!/(?:改为|增加)△/.test(run.text));
const [symbolOnlyRecords]=tableRegions(emptyNotes,recordRules,250,true);
assert.deepEqual(symbolOnlyRecords.rows[1][3].recordBands.map(band=>({p:band.p,y:band.sourceY,n:band.runs.length})),[
 {p:0,y:87,n:0},{p:0,y:107,n:0},{p:0,y:127,n:0}
]);
// A code column spanning physical rows with additional unruled category rows
// needs source-region rendering unless all subrows can be proved.
a=0;
const categoryRuns=[{...run('代码',5,60),width:20},{...run('站名',40,60),width:20},{...run('修改内容',80,60),width:60}];
for(const [i,y]of [82,95,115,145].entries())categoryRuns.push({...run('01',5,y),width:12});
for(const [i,y]of [85,115,145].entries())categoryRuns.push({...run('某站',40,y),width:20},{...run('增加',80,y),width:20});
const categoryRules=['M0,40L180,40M0,70L180,70M35,100L180,100M35,130L180,130M0,160L180,160M0,40L0,160M35,40L35,160M70,40L70,160M180,40L180,160'];
assert.equal(tableRegions(categoryRuns,categoryRules,220,true)[0].type,'table-layout');
console.log('通过：格内基线与原文顺序共同校验，未分隔修改记录逐行对应，无法证明的跨行代码区域不糊格。');
// A surviving outer frame with missing inner verticals must not convert a
// whole continuation's records into one full-width prose cell.
a=0;
const maskedGridRuns=[
 {...run('页数',5,60),width:20},{...run('线名',40,60),width:20},
 {...run('站名',80,60),width:20},{...run('修改内容',125,60),width:60},
 ...[0,1,2].map(i=>({...run((97+i)+'陇海某站增加△危',5,90+i*20),width:180}))
];
const maskedGridRules=['M0,40L220,40M0,70L220,70M0,150L220,150M0,40L0,150M35,40L35,70M70,40L70,70M120,40L120,70M220,40L220,150'];
assert.equal(tableRegions(maskedGridRuns,maskedGridRules,250,true)[0].type,'table-layout');
console.log('通过：缺失内部竖线的续表不会被当成跨列大段正文。');
// Nonnumeric category keys also identify multiple records; long text from
// several map regions cannot be flattened into one prose cell.
a=0;
const mapRegionRuns=[{...run('图别',5,60),width:25},{...run('修改内容',75,60),width:60}];
for(const [i,name]of ['东北','北方','南方'].entries())mapRegionRuns.push({...run(name,5,90+i*30),width:30});
for(let i=0;i<7;i++)mapRegionRuns.push({...run('修改某线有关事项',75,85+i*12),width:110});
const mapRegionRules=['M0,40L220,40M0,70L220,70M0,170L220,170M0,40L0,170M65,40L65,170M220,40L220,170'];
assert.equal(tableRegions(mapRegionRuns,mapRegionRules,250,true)[0].type,'table-layout');
console.log('通过：图别等非数字短标识与多段修改不能糊成大格。');

// Separate extraction IDs do not make a new physical line for a suffix punctuation.
a=0;
const suffixRuns=[
 {...run('北京局:石景山,改',20,120),width:100,line:'0'},
 {...run(';',145,120),width:4,line:'15'},
 {...run('下一项规定。',20,145),width:90,line:'16'}
];
const suffixBlocks=articleBlocks(suffixRuns,[],300,500,{a:0,b:a,strict:true},'');
assert.equal(suffixBlocks[0].runs.map(run=>run.text).join(''),'北京局:石景山,改;');
assert(!suffixBlocks.some(block=>/^[;。]+$/.test(block.runs?.map(run=>run.text).join(''))));
console.log('通过：相同物理基线的标点不因提取行编号不同而独立成段。');

// Some embedded full-width Latin fonts report a rectangle over twice as tall
// as Chinese glyphs on the same baseline. Synthetic SVG y then crosses the
// next rule, so cell assignment must use the original glyph rectangles.
a=0;
const denseRuns=[],denseCoordinates=[];
function denseRun(text,x,top,height,line) {
  const item={...run(text,x,top+height*.82),size:7.76,width:text.length*4,line};
  denseRuns.push(item);
  for(let i=0;i<text.length;i++)denseCoordinates.push([(x+i*4)/3,top/2,4/3,height/2]);
}
for(const [text,x]of [['担当局',15],['车次',65],['发到站',130],['批准价格',190]])denseRun(text,x,11,8.9,'head');
for(let row=0;row<3;row++) {
  denseRun('甲局',15,21+row*8,8.9,'row'+row);
  denseRun('K'+(row+1),65,17.4+row*8,18.4,'row'+row);
  denseRun(['甲—乙','丙—丁','戊—己'][row],130,21+row*8,8.9,'row'+row);
  denseRun('新空',190,21+row*8,8.9,'row'+row);
}
const denseRules=['M10,10L230,10M10,20L230,20M10,28L230,28M10,36L230,36M10,44L230,44M10,10L10,44M60,10L60,44M120,10L120,44M180,10L180,44M230,10L230,44'];
const denseDecoded=splitReadingColumns(denseRuns,denseRules,denseCoordinates,300,200);
const denseBlocks=articleBlocks(denseDecoded,denseRules,300,200,{a:0,b:a,strict:true},'');
assert.equal(denseBlocks.length,1);
assert.equal(denseBlocks[0].type,'table');
assert.deepEqual(denseBlocks[0].rows.slice(1).map(row=>row.map(cell=>cell.runs.map(run=>run.text).join(''))),[
 ['甲局','K1','甲—乙','新空'],['甲局','K2','丙—丁','新空'],['甲局','K3','戊—己','新空']
]);
assert.equal(denseBlocks[0].runs.length,denseRuns.length);
assert.equal(tableProfile(denseBlocks[0]).family,'train');
assert.equal(tableProfile(denseBlocks[0]).headerRows,1);
const denseContinuation=structuredClone(denseBlocks[0]);
const denseNext=[{type:'continuation',runs:[{text:'续上表'}]},denseContinuation];
joinTableContinuation(denseBlocks[0],denseNext,true);
assert.equal(denseNext.length,0);
assert.equal(denseBlocks[0].rows.length,7);
assert.equal(denseBlocks[0].rows.flat().filter(cell=>cell.runs.some(run=>run.text==='担当局')).length,1);
const numberedPrevious=structuredClone(denseBlocks[0]),numberedNext=structuredClone(denseContinuation);
numberedNext.rows[0].forEach((cell,i)=>{cell.runs=[{...cell.runs[0],text:String(i+1)}];cell.lines=[{y:cell.runs[0].y,runs:cell.runs}];});
const numberedContinuation=[{type:'continuation',runs:[{text:'续上表'}]},numberedNext];
const beforeNumbered=numberedPrevious.rows.length;
joinTableContinuation(numberedPrevious,numberedContinuation,true);
assert.equal(numberedContinuation.length,0);
assert.equal(numberedPrevious.rows.length,beforeNumbered+3);
assert(!numberedPrevious.rows.some(row=>row.every((cell,i)=>cell.runs.map(run=>run.text).join('')===String(i+1))));
const numberedFullHeader=structuredClone(denseContinuation);
numberedFullHeader.rows.slice(1).flat().forEach(cell=>{cell.r0++;cell.r1++;});
const auxiliaryNumbers=structuredClone(numberedNext.rows[0]);
auxiliaryNumbers.forEach(cell=>{cell.r0=1;cell.r1=1;});
numberedFullHeader.rows.splice(1,0,auxiliaryNumbers);
const numberedFullNext=[structuredClone(numberedFullHeader)];
joinTableContinuation(numberedFullHeader,numberedFullNext,true);
assert.equal(numberedFullNext.length,0);
assert.equal(numberedFullHeader.rows.length,8);
assert.equal(numberedFullHeader.rows.filter(row=>row.every((cell,i)=>cell.runs.map(run=>run.text).join('')===String(i+1))).length,1);
console.log('通过：密集表格按源字框归格，异体数字字体不串行，末行车次不落在表外。');
