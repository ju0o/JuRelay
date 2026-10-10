#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distMod = await import(path.join(repo, 'dist/server/mcp/app/pm-widget-resource.js'));
const fullHtml = distMod.pmWidgetHtml('https://example.invalid/w');
const style = fullHtml.match(/<style>([\s\S]*?)<\/style>/)[1];
const outDir = path.join(repo, '.agent-relay/cert/ux-v3-switch');
mkdirSync(outDir, { recursive: true });
function fixture(width) {
  return '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8" />' +
  '<meta name="viewport" content="width=' + width + ', initial-scale=1" />' +
  '<style>' + style + ' html,body{margin:0;padding:0;} #wrap{width:' + width + 'px;max-width:' + width + 'px;margin:0;padding:10px;} #result{white-space:pre-wrap;font:11px monospace;margin-top:8px;}</style></head>' +
  '<body><div id="wrap"><div class="card" id="card">' +
  '<div class="hdr" id="hdr"><span class="dot waiting pulse"></span><span class="app">Agent Relay</span>' +
  '<details class="proj-switch" id="projSwitch"><summary id="projSwitchLabel">JuControler \u25BE</summary>' +
  '<div class="proj-menu" id="projSwitchMenu" role="menu"></div></details>' +
  '<span class="hpill">PM \uB300\uAE30</span>' +
  '<span class="hfrac"><b>0</b> / <span>0</span></span>' +
  '<span class="lang"><button class="on">\uD55C\uAD6D\uC5B4</button><button>EN</button></span>' +
  '</div></div></div><div id="result">PENDING</div>' +
  readFileSyncInline() + '</body></html>';
}
function readFileSyncInline() {
  return '<scr' + 'ipt>(function(){var out={};' +
  'function R(el){if(!el)return null;var r=el.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};}' +
  'function CS(el){if(!el)return null;var c=getComputedStyle(el);return{display:c.display,visibility:c.visibility,position:c.position,ox:c.overflowX,oy:c.overflowY,z:c.zIndex,ct:c.containerType};}' +
  'function chain(el){var ch=[];var n=el;while(n&&n!==document.body){var c=getComputedStyle(n);ch.push(n.tagName+"."+String(n.className||"").split(" ")[0]+" ox="+c.overflowX+" oy="+c.overflowY);n=n.parentElement;}return ch;}' +
  'var sw=document.getElementById("projSwitch");var menu=document.getElementById("projSwitchMenu");var label=document.getElementById("projSwitchLabel");' +
  'var names=["actl","Agent Relay","Jucontroler Private Planning","JuControler","JuPlan","R30 AI Revenue","V1cert","V1cert3","ws"];' +
  'names.forEach(function(n,i){var b=document.createElement("button");b.type="button";b.textContent=n;if(i===3)b.className="cur";menu.appendChild(b);});' +
  'var re=document.createElement("button");re.type="button";re.textContent="REPREP";menu.appendChild(re);' +
  'out.before={open:sw.open,labelRect:R(label),menuRect:R(menu),menuCS:CS(menu),swCS:CS(sw),hdrCS:CS(document.getElementById("hdr")),cardCS:CS(document.getElementById("card")),btnCount:menu.querySelectorAll("button").length,chain:chain(menu)};' +
  'var toggled=false;try{label.click();toggled=(sw.open===true);}catch(e){out.clickErr=String(e);}' +
  'out.after={open:sw.open,toggled:toggled,menuRect:R(menu),menuCS:CS(menu)};' +
  'if(sw.open){var mr=menu.getBoundingClientRect();var lr=label.getBoundingClientRect();' +
  'var el=document.elementFromPoint(lr.x+lr.width/2,lr.y+lr.height+8);' +
  'out.hit={el:el?(el.tagName+"."+String(el.className||"").split(" ")[0]):"null",menuVisible:(mr.width>0&&mr.height>0)};' +
  'out.btns=Array.prototype.map.call(menu.querySelectorAll("button"),function(b){var r=b.getBoundingClientRect();return{t:b.textContent.slice(0,10),w:Math.round(r.width),h:Math.round(r.height)};});' +
  'try{label.click();}catch(e){} out.closed={open:sw.open};}' +
  'document.getElementById("result").textContent="SWITCH_MEASURE "+JSON.stringify(out);' +
  '})();</scr'+'ipt>';
}
function chromeBin(){for(const c of ['google-chrome','chromium','chromium-browser']){const r=spawnSync('which',[c],{encoding:'utf8'});if(r.status===0&&r.stdout.trim())return r.stdout.trim();}throw new Error('no chrome');}
const chrome=chromeBin();
const summary={uri:distMod.PM_WIDGET_RESOURCE_URI,fp:distMod.PM_WIDGET_CONTENT_FINGERPRINT,widths:{}};
for(const width of [320,380,540,900]){
  const dir=mkdtempSync(path.join(os.tmpdir(),'swm-'));
  try{
    const htmlPath=path.join(dir,'sw-'+width+'.html');
    const shotPath=path.join(outDir,'switch-'+width+'.png');
    writeFileSync(htmlPath,fixture(width),'utf8');
    const shot=spawnSync(chrome,['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--force-device-scale-factor=1','--window-size='+Math.max(width+40,480)+',700','--screenshot='+shotPath,pathToFileURL(htmlPath).href],{encoding:'utf8',timeout:30000});
    if(shot.status!==0)throw new Error('shot fail:'+shot.stderr);
    const dom=spawnSync(chrome,['--headless=new','--disable-gpu','--no-sandbox','--dump-dom',pathToFileURL(htmlPath).href],{encoding:'utf8',timeout:30000});
    const m=(dom.stdout||'').match(/SWITCH_MEASURE (\{.*?\})<\/div>/s);
    let data=null;
    try{data=m?JSON.parse(m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')):{nomatch:true};}
    catch(e){data={parseError:String(e).slice(0,200),raw:(m?m[1].slice(0,400):'NO_MATCH')};}
    summary.widths[width]={shot:path.relative(repo,shotPath),measure:data};
    console.log('=== width '+width+' ===');
    console.log(JSON.stringify(data,null,1));
  }finally{rmSync(dir,{recursive:true,force:true});}
}
writeFileSync(path.join(outDir,'dom-measure.json'),JSON.stringify(summary,null,2));
console.log('saved '+path.join(outDir,'dom-measure.json'));
