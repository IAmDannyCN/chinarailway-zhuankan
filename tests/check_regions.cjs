'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const queryTerms=['甲'];
const f=new Function('originalURL','normalize','escapeHtml','terms',
 fs.readFileSync(__dirname+'/../offline/flow.js','utf8')+'\n'+fs.readFileSync(__dirname+'/../offline/reader.js','utf8')+
 ';return {croppedOriginal,mergeReadingCrops,blocksHTML,originalHighlights,inlineRuns,readingRunsWithGraphics,readingGraphicsByGroup,tableHTML};')(
 ()=> '../pdf/test.pdf',s=>s,s=>s, queryTerms);
const document={id:'test',entries:[],texts:['甲乙丙'],sizes:[[300,500]]};
const runs=[
 {text:'甲',a:0,b:1,x:30,y:110,width:10,size:10,line:0,p:0},
 {text:'乙',a:1,b:2,x:45,y:120,width:10,size:10,line:1,p:0},
 {text:'丙',a:2,b:3,x:60,y:130,width:10,size:10,line:2,p:0}];
const decoded={width:300,height:500,runs,rules:[],coordinates:[[10,20,3.333,2],[15,22,3.333,2],[20,24,3.333,2]]};
const part={p:0,a:0,b:3};
const a=f.croppedOriginal(document,part,decoded,[25,95,80,130],'layout',runs.slice(0,2));
const b=f.croppedOriginal(document,part,decoded,[40,108,65,128],'symbol',runs.slice(1,2));
const merged=f.mergeReadingCrops([a,b,{type:'paragraph',runs:[runs[2]]}],document,part,decoded);
assert.equal(merged.filter(block=>block.type==='source').length,1);
assert.equal(merged.length,1,'与原图重叠的孤立HTML文字必须一起合并，不能重复显示');
assert.equal(merged[0].text,'甲乙丙');
assert.equal(new Set(merged[0].offsets).size,3);
assert(merged[0].displayWidth<10,'小片段必须按源字形尺寸显示');
const html=f.blocksHTML(merged);
assert(html.includes('width:min(100%,'));
assert(html.includes('data-crop='));
const marks=f.originalHighlights(merged[0]);
assert(marks.includes('data-offset="0"'));
assert(!marks.includes('NaN'));
console.log('通过：不同类型的原形区域重叠合并，正文不重复，小裁片不铺满，高亮保留原文索引。');

queryTerms.splice(0,1,'正');
const graphic={kind:'symbol',rect:[10,10,20,20],a:0,b:3,offsets:[0,2],text:'○正'};
const graphicPage={src:'test.webp',size:[300,500]};
const combo=f.inlineRuns([
 {text:'○',a:0,b:1,p:0,graphicChars:{0:graphic},graphicPage},
 {text:'中',a:1,b:2,p:0},
 {text:'正',a:2,b:3,p:0,graphicChars:{2:graphic},graphicPage}
]);
assert.equal((combo.match(/class="inline-symbol"/g)||[]).length,1,'组合符号只绘制一次');
assert(combo.includes('<mark data-page="0" data-offset="2">'));
assert(/<mark[^>]+>[\s\S]*class="inline-symbol"/.test(combo),'内部汉字命中应高亮完整符号');
console.log('通过：组合符号保留精确组成字索引、只绘制一次，检索内部汉字高亮原形。');

const punct=new Function(fs.readFileSync(__dirname+'/../offline/reader.js','utf8')+';return readingPunctuation')();
assert.equal(punct('各局:按规定,办理;结束. (附件)'), '各局：按规定，办理；结束。 （附件）');
assert.equal(punct('1.里程2.073公里,12:30开。'), '1.里程2.073公里，12:30开。');
assert.equal(punct('共计123.'),'共计123。');
assert.equal(punct('https://rail.example/a:b?x=1.2;v=3'), 'https://rail.example/a:b?x=1.2;v=3');
assert.equal(punct('KH2010105000.pdf'), 'KH2010105000.pdf');
assert.equal(punct('0.40元/吨公里'), '0.40元/吨公里');
console.log('通过：中文全角标点、编号点与正文句号分开处理，小数/时刻/单位/网址/文件名保留，字符索引长度不变。');

assert.equal(punct('2\ue010办理有关事项.'),'2.办理有关事项。');
assert.equal(punct('2。办理有关事项.'),'2.办理有关事项。');
const listHTML=new Function('normalize','escapeHtml','terms',fs.readFileSync(__dirname+'/../offline/reader.js','utf8')+';return inlineRuns')(
 s=>s,s=>s,[])([{text:'1\ue010办理有关事项。',a:20,b:31,p:0}],{paragraph:true});
assert(listHTML.includes('clause-marker-end'));
assert(listHTML.includes('data-offset="20"'));
assert(!listHTML.includes('\ue010'));
const listDot={kind:'symbol',rect:[10,10,12,12],a:1,b:2,text:'\ue010'};
const listGraphic=f.inlineRuns([
 {text:'1',a:0,b:1,p:0,x:0,y:15,width:8,size:10},
 {text:'\ue010',a:1,b:2,p:0,x:10,y:15,width:2,size:10,graphicChars:{1:listDot},graphicPage},
 {text:'办理。',a:2,b:5,p:0,x:14,y:15,width:30,size:10}
],{paragraph:true});
assert(!listGraphic.includes('class="inline-symbol"'),'编号点在符号token化前转成正常点，不能飘进正文');
assert(listGraphic.includes('>.</span>'));
console.log('通过：1.、2.编号保留规范点及间距，特殊点字形不再原样误排。');

queryTerms.splice(0);
const inserted={kind:'symbol',rect:[20,10,30,20],a:11,b:11,p:0,src:'test.webp',size:[300,500]};
const withPunctuation=f.readingRunsWithGraphics([
 {text:'为。',a:10,b:12,p:0,x:10,y:20,width:30,size:10}
],[inserted]);
assert.equal(withPunctuation.map(run=>run.text).join(''),'为\ufffc。','位图符号必须插在同run中的句末标点之前');
const punctGraphic=f.inlineRuns([{text:'为；',a:10,b:12,p:0,x:10,y:20,width:30,size:10}],{graphics:[inserted]});
assert(punctGraphic.indexOf('为')<punctGraphic.indexOf('class="inline-symbol"'));
assert(punctGraphic.indexOf('class="inline-symbol"')<punctGraphic.lastIndexOf('；'));
assert(punctGraphic.includes('data-offset="10"'));
assert(punctGraphic.includes('data-offset="11"'));

const other={kind:'symbol',rect:[29,10,39,23],a:12,b:14,offsets:[12,13],text:'○另'};
const moved=f.readingRunsWithGraphics([
 {text:'改为',a:10,b:12,p:0,x:10,y:20,width:18,size:10},
 {text:'另',a:13,b:14,p:0,x:29,y:20,width:10,size:10,graphicChars:{13:other},graphicPage},
 {text:'但不办理',a:14,b:18,p:0,x:40,y:20,width:40,size:10},
 {text:'○',a:12,b:13,p:0,x:31,y:24,width:10,size:10,graphicChars:{12:other},graphicPage}
]);
assert.equal(moved.map(run=>run.text).join(''),'改为○另但不办理','组合字形按实际同一行位置显示，不跟随错误提取顺序到句末');
const padded={...other,rect:[27,8,43,24]};
const paddedRuns=f.readingRunsWithGraphics([
 {text:'改为',a:10,b:12,p:0,x:10,y:20,width:18,size:10},
 {text:'另',a:13,b:14,p:0,x:29,y:20,width:10,size:10,graphicChars:{13:padded},graphicPage},
 {text:'但不办理',a:14,b:18,p:0,x:40,y:20,width:40,size:10},
 {text:'○',a:12,b:13,p:0,x:31,y:24,width:10,size:10,graphicChars:{12:padded},graphicPage}
]);
assert.equal(paddedRuns.map(run=>run.text).join(''),'改为○另但不办理','矢量透明边距超过后字起点时仍按源offset保持组合符号位置');

queryTerms.push('正');
const nonAdjacent={kind:'symbol',rect:[20,10,30,20],a:50,b:82,offsets:[50,81],text:'○正'};
const precise=f.inlineRuns([
 {text:'○',a:50,b:51,p:0,x:20,y:20,width:10,size:10,graphicChars:{50:nonAdjacent},graphicPage},
 {text:'正',a:81,b:82,p:0,x:21,y:20,width:10,size:10,graphicChars:{81:nonAdjacent},graphicPage}
]);
assert.equal((precise.match(/class="inline-symbol"/g)||[]).length,1);
assert(precise.includes('<mark data-page="0" data-offset="81">'),'非相邻组合内部汉字检索保持真实原文offset');
const vector={...nonAdjacent,svg:'<svg xmlns="http://www.w3.org/2000/svg" aria-label="原刊"><path d="M0 0L1 1"/></svg>'};
const vectorHTML=f.inlineRuns([{text:'○正',a:50,b:52,p:0,x:20,y:20,width:10,size:10,
 sourceOffsets:[50,81],graphicChars:{50:vector,81:vector},graphicPage}]);
assert(vectorHTML.includes('data:image/svg+xml;charset=utf-8,%3Csvg'));
assert(vectorHTML.includes('background-size:100% 100%'));
assert(!vectorHTML.includes('test.webp'),'原PDF字形矢量独立显示，不混入邻字或表格线');
const groups=[{sourceY:10,runs:[{p:0,y:12,size:10}]},{sourceY:30,runs:[{p:0,y:32,size:10}]},
 {sourceY:10,runs:[{p:1,y:12,size:10}]}];
const bandGraphics=[{p:0,rect:[1,7,5,13]},{p:0,rect:[1,27,5,33]},{p:1,rect:[1,7,5,13]}];
assert.deepEqual(f.readingGraphicsByGroup(groups,bandGraphics),[[bandGraphics[0]],[bandGraphics[1]],[bandGraphics[2]]],
 '各站符号只进入其同页同物理记录，跨页续表不可串用y');
assert.deepEqual(f.readingGraphicsByGroup([
 {p:0,sourceY:10,runs:[]},{p:0,sourceY:30,runs:[]},{p:1,sourceY:10,runs:[]}
],bandGraphics),[[bandGraphics[0]],[bandGraphics[1]],[bandGraphics[2]]],
 '只有符号没有可提取文字的空带也必须接收自身符号，不可挤到唯一有文字的一站');
console.log('通过：位图符号在原文插入点拆分文字，组合符号原位、内部索引准确，多记录和跨页符号各归其行。');

queryTerms.splice(0);
const codeRun=(text,a,y,x=0,width=text.length*5)=>({text,a,b:a+text.length,p:0,x,y,width,size:10});
const cell=(r,c,lines)=>({r0:r,r1:r,c0:c,c1:c,runs:lines.flatMap(line=>line.runs),lines});
const header=[cell(0,0,[{runs:[codeRun('车次',100,5)]}]),cell(0,1,[{runs:[codeRun('担当局',110,5,100)]}])];
function trainHTML(lines) {
 return f.tableHTML({type:'table',left:0,right:180,top:0,bottom:60,xs:[0,90,180],ys:[0,10,60],columns:2,
  rows:[header,[cell(1,0,lines),cell(1,1,[{runs:[codeRun('太原',120,20,100)]}])]],
  runs:[...header.flatMap(c=>c.runs),...lines.flatMap(line=>line.runs),codeRun('太原',120,20,100)]});
}
const codeCell=markup=>markup.match(/<td[^>]*>([\s\S]*?)<\/td>/)[1];
const separate=codeCell(trainHTML([{runs:[codeRun('K566/3/6/3',0,20)]},{runs:[codeRun('564/5/4/5',10,35)]}]));
assert(separate.includes('</div><div>'),'同格独立物理行的车次不能拼成长号码');
const gapCode=codeCell(trainHTML([{runs:[codeRun('K598/9',0,20,0,30),codeRun('600/597',6,20,36,35)]}]));
assert(gapCode.includes('</span> <span'),'同一行有明显空白的独立车次必须分隔');
const packedCode=codeRun('K598/9600/597',0,20,0,58);
packedCode.pageSize=[300,500];
packedCode.pageCoordinates=Array.from(packedCode.text,(_,i)=>[(i*4+(i>=6?3:0))/3,2,4/3,2]);
const internalGap=codeCell(trainHTML([{runs:[packedCode]}]));
assert(internalGap.includes('</span> <span'),'PDF把显著空白丢在同一run内部时，仍需用逐字坐标恢复车次分隔');
const wrapped=codeCell(trainHTML([{runs:[codeRun('K566/3/',0,20)]},{runs:[codeRun('6/3',7,35)]}]));
assert.equal((wrapped.match(/<div>/g)||[]).length,1,'一个车次在斜杠处折行仍为一个号码');
console.log('通过：同格独立车次按行分开，显著空白分隔，斜杠处的单车次折行保持连续。');
