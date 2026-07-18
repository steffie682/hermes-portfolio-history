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
  const context={document,TextDecoder,Blob,console,setTimeout,clearTimeout,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}},SbiInspector:core};
  context.window=context; context.globalThis=context;
  vm.runInNewContext(fs.readFileSync('./inspector-ui.js','utf8'),context,{filename:'inspector-ui.js'});
  return {elements};
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
  console.log('inspector UI regression tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
