const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('./inspector-core.js');

class Element {
  constructor(id = '') { this.id=id; this.listeners={}; this.hidden=true; this.disabled=false; this.checked=false; this.value=''; this.textContent=''; this.children=[]; this.files=[]; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  dispatch(type) { return this.listeners[type]({ target: this }); }
  replaceChildren(...children) { this.children = children; if (!children.length) this.value=''; }
  append(...children) { this.children.push(...children); for (const child of children) if (child.selected) this.value=child.value; }
  setAttribute(name, value) { this[name] = value; }
  remove() { this.removed = true; }
  click() { return this.listeners.click?.({ target: this }); }
}
function setup() {
  const ids=['file','message','csv-section','pdf-section','header-row','raw-preview','confirmed','download-report','download-fixture','summary','safe-preview','pdf-confirmed','download-pdf-report'];
  const elements=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
  const body=new Element('body');
  const document={getElementById:id=>elements[id],createElement:()=>new Element(),body};
  const context={document,TextDecoder,Blob,console,setTimeout,clearTimeout,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}},SbiInspector:{...core}};
  context.window=context; context.globalThis=context;
  vm.runInNewContext(fs.readFileSync('./inspector-ui.js','utf8'),context,{filename:'inspector-ui.js'});
  return {elements,context};
}
const bytes = text => new TextEncoder().encode(text).buffer;
const immediate = (text, size) => ({size: size ?? text.length, arrayBuffer: async()=>bytes(text)});
async function choose(elements,file){elements.file.files=[file];return elements.file.dispatch('change');}

(async()=>{
  {
    const {elements}=setup(); let release;
    const slow={size:100,arrayBuffer:()=>new Promise(resolve=>{release=()=>resolve(bytes('SECRET_HEADER,値\n秘密,1'));})};
    const first=choose(elements,slow);
    await choose(elements,immediate('FAST_HEADER,値\n公開用,2'));
    release(); await first;
    assert.match(elements['safe-preview'].textContent,/FAST_HEADER/);
    assert.doesNotMatch(elements['safe-preview'].textContent,/SECRET_HEADER/);
  }
  {
    const {elements}=setup(); const pdf=immediate('%PDF-1.7\nsynthetic');
    await choose(elements,pdf);
    elements['pdf-confirmed'].checked=true; elements['pdf-confirmed'].dispatch('change');
    assert.equal(elements['download-pdf-report'].disabled,false);
    await choose(elements,pdf);
    assert.equal(elements['pdf-confirmed'].checked,false);
    assert.equal(elements['download-pdf-report'].disabled,true);
  }
  {
    const {elements}=setup(); let read=false;
    await choose(elements,{size:26*1024*1024,arrayBuffer:async()=>{read=true;throw new Error('must not read');}});
    assert.equal(read,false);
    assert.match(elements.message.textContent,/25MB以下/);
  }
  {
    const {elements}=setup();
    const schema='約定日,銘柄,銘柄コード,市場,取引,期限,預り,課税,約定数量,約定単価,手数料/諸経費等,税額,受渡日,受渡金額/決済損益';
    const preamble=Array.from({length:30},(_,index)=>index===0?'SECRET_ACCOUNT_ABC,private':`metadata-${index},private`).join('\n');
    const data='2000/01/01,合成銘柄,ABCD,東証,現物買,当日,特定,課税,10,1000,--,--,2000/01/03,10000';
    await choose(elements,immediate(`${preamble}\n${schema}\n${data}`));
    assert.equal(elements['header-row'].disabled,true);
    assert.equal(elements['header-row'].value,'30');
    assert.doesNotMatch(elements['safe-preview'].textContent,/SECRET_ACCOUNT_ABC/);
  }
  {
    const {elements,context}=setup();
    await choose(elements,immediate('見出し,値\n安全,1'));
    elements.confirmed.checked=true; elements.confirmed.dispatch('change');
    assert.equal(elements['download-report'].disabled,false);
    context.SbiInspector.buildSafeArtifacts=()=>{throw new Error('分類値を拒否')};
    elements['header-row'].dispatch('change');
    assert.equal(elements.confirmed.checked,false);
    assert.equal(elements['download-report'].disabled,true);
    assert.equal(elements['download-fixture'].disabled,true);
    assert.match(elements.message.textContent,/分類値を拒否/);
  }
  console.log('inspector UI regression tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
