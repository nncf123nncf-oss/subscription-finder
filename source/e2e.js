// 実ブラウザ(Chrome headless / CDP)での検算。実行: node source/e2e.js
const fs = require('fs'), path = require('path'), cp = require('child_process'), http = require('http'), os = require('os');
const PAGE = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('NG', m); } };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sbf-e2e-'));
const wf = (name, buf) => { const p = path.join(TMP, name); fs.writeFileSync(p, buf); return p; };
// Shift_JIS: 「ご利用日,ご利用先,ご利用金額」と「ノートクラウド」を含む最小CSV（iconv無しで用意するため、ブラウザで作る）
(async () => {
  const chrome = cp.spawn(CHROME, ['--headless=new', '--remote-debugging-port=9361', '--user-data-dir=' + path.join(TMP, 'prof'), '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  let t; for (let i = 0; i < 50; i++) { try { t = await getJson('http://127.0.0.1:9361/json'); if (t.length) break; } catch (e) { } await sleep(200); }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = {}; const errs = [];
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } if (m.method === 'Runtime.exceptionThrown') errs.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300)); });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async x => { const r = (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result; if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  const HOOK = `window.__net=[];const of=window.fetch;window.fetch=function(){window.__net.push('fetch:'+arguments[0]);return of.apply(this,arguments)};
    const ox=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(){window.__net.push('xhr:'+arguments[1]);return ox.apply(this,arguments)};
    navigator.sendBeacon=function(){window.__net.push('beacon:'+arguments[0]);return true};
    window.__ls=[];const sset=Storage.prototype.setItem;Storage.prototype.setItem=function(){window.__ls.push(arguments[0]);return sset.apply(this,arguments)};
    try{indexedDB.open=function(){window.__ls.push('idb');throw new Error('x')}}catch(e){}`;
  await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
  async function open(w, h, scheme) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme || 'light' }] });
    await send('Page.navigate', { url: PAGE }); for (let i = 0; i < 60; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(100); } await sleep(200);
  }
  async function pick(file) { const doc = (await send('DOM.getDocument')).result.root.nodeId; const q = (await send('DOM.querySelector', { nodeId: doc, selector: '#file' })).result.nodeId; await send('DOM.setFileInputFiles', { nodeId: q, files: [file] }); await sleep(500); }
  const txt = sel => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent||''`);
  const click = sel => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const cnt = sel => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const vis = sel => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});return !!e && e.getClientRects().length>0 && getComputedStyle(e).visibility!=='hidden'})()`);

  await open(1000, 900);
  ok(await ev('getComputedStyle(document.querySelector(".layout")).display') === 'grid', '880px以上は2カラム');
  ok(await vis('#resEmpty'), '初期は未読み込み表示');
  ok(await ev('document.getElementById("file").hasAttribute("accept")') === false, 'accept属性なし');
  // 空で読み込む
  await click('#load'); ok((await txt('#status')).includes('空'), '空の読み込みは理由表示');
  // サンプル
  await click('#sample'); await sleep(200);
  let s = await txt('#status'); ok(/件を読み込み・2026年7月〜2026年9月（3か月分）・読み取れなかった行 2件/.test(s), '読み込み結果 ' + s);
  ok(await cnt('#list .it') === 8, '毎月8件'); ok((await txt('#tMonth')) === '15,610円' && (await txt('#tYear')) === '187,320円', '合計 ' + await txt('#tMonth'));
  ok((await txt('#mMonth')) === '—', '印なしは—');
  ok((await txt('#badSum')).includes('2件'), '読み取れなかった行2件'); ok((await txt('#badList')).includes('年が書かれていない') && (await txt('#badList')).includes('返金・取消の行'), '理由');
  ok((await txt('#someSum')).includes('1件'), 'ときどき1件'); ok((await txt('#onceSum')).includes('7件'), '1回だけ7件');
  ok((await ev('[...document.querySelectorAll("#list .nm")].map(e=>e.textContent)')).slice(0, 3).join('|') === '素材ストック*Z1X5|予約うけつけ帳|ノートPC 分割', '並び順');
  // 手動年払い
  await ev('[...document.querySelectorAll("#onceList li")].find(li=>li.textContent.includes("セキュリティ対策ソフト")).querySelector("button[aria-label^=年払い]").click()'); await sleep(100);
  ok(await cnt('#list .it') === 9, '年払いを加えて9件'); ok((await txt('#list')).includes('年払い（自分で追加）'), '年払いラベル');
  ok((await txt('#tYear')) === '192,820円' && (await txt('#tMonth')) === '16,068円', '年払い込み合計 ' + await txt('#tYear'));
  ok((await ev('[...document.querySelectorAll("#onceList li")].find(li=>li.textContent.includes("セキュリティ対策ソフト")).querySelector("button").disabled')), '加えたボタンは無効');
  // 印
  await ev('document.querySelectorAll("#list .it input")[0].click()'); await ev('document.querySelectorAll("#list .it input")[1].click()'); await sleep(50);
  ok((await txt('#mMonth')) === '6,300円' && (await txt('#mYear')) === '75,600円', '見直し分 ' + await txt('#mMonth'));
  ok(await cnt('#list .it.on') === 2, '印の行は強調');
  // コピー(headlessはclipboard不可→手動コピー欄、または成功)
  await click('#copyMarked'); await sleep(300); ok(await vis('#manualBox'), 'コピー結果欄'); const mv = await ev('document.getElementById("manual").value');
  ok(mv.split('\n').length === 3 && mv.includes('素材ストック') && !mv.includes('2026/'), '印だけコピー内容 ' + mv.slice(0, 60));
  // 外す
  await ev('[...document.querySelectorAll("#list .it")].find(li=>li.textContent.includes("セキュリティ")).querySelector("button").click()'); await sleep(50);
  ok(await cnt('#list .it') === 8, '外すと8件'); ok((await txt('#mMonth')) === '6,300円', '外しても印は残る');
  // 列変更
  await ev('(()=>{const s=document.getElementById("colAmt");s.value="3";s.dispatchEvent(new Event("change"))})()'); await sleep(50);
  ok((await txt('#status')).includes('読み取れる行がありませんでした'), '列を誤ると理由表示');
  await ev('(()=>{const s=document.getElementById("colAmt");s.value="2";s.dispatchEvent(new Event("change"))})()'); await sleep(50); ok(await cnt('#list .it') === 8, '列を戻すと復帰');
  // ファイル: UTF-8 BOM / Shift_JIS / PNG / 空 / 2MB超
  const csv = 'ご利用日,ご利用先,ご利用金額\n2026/07/03,ノートクラウド,1200\n2026/08/03,ノートクラウド,1200\n';
  await pick(wf('bom.csv', Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(csv)]))); ok(await cnt('#list .it') === 1 && (await txt('#list')).includes('ノートクラウド'), 'UTF-8 BOM');
  const SJ = Buffer.from('82b29798977093fa2c82b29798977090e62c82b2979897708be08a7a0a323032362f30372f30332c836d815b8367834e8389834583682c313230300a323032362f30382f30332c836d815b8367834e8389834583682c313230300a', 'hex');
  await pick(wf('sjis.csv', SJ)); ok((await txt('#list')).includes('ノートクラウド') && (await txt('#colDate option:checked')).includes('ご利用日'), 'Shift_JIS ' + (await txt('#list')).slice(0, 40));
  await pick(wf('u16.csv', Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(csv, 'utf16le')]))); ok((await txt('#list')).includes('ノートクラウド'), 'UTF-16');
  await pick(wf('img.png', Buffer.from([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0]))); ok((await txt('#status')).includes('文字のファイルではない'), 'PNG拒否');
  await pick(wf('empty.csv', Buffer.alloc(0))); ok((await txt('#status')).includes('空'), '空ファイル');
  await pick(wf('big.csv', Buffer.alloc(2 * 1024 * 1024 + 10, 0x41))); ok((await txt('#status')).includes('2MB'), '2MB超');
  // 1回だけの支払いを「毎月」として加える
  await click('#sample'); await sleep(100);
  const sec = '[...document.querySelectorAll("#onceList li")].find(li=>li.textContent.includes("セキュリティ対策ソフト"))';
  ok(await ev(sec + '.querySelectorAll("button").length') === 2, '1回だけの行に2つのボタン');
  await ev(sec + '.querySelector("button[aria-label^=毎月]").click()'); await sleep(100);
  const secIt = '[...document.querySelectorAll("#list .it")].find(li=>li.textContent.includes("セキュリティ対策ソフト"))';
  ok(await ev('!!' + secIt) && (await ev(secIt + '.textContent')).includes('毎月（自分で追加）') && (await ev(secIt + '.textContent')).includes('5,500円') && (await ev(secIt + '.textContent')).includes('66,000円') && !(await ev(secIt + '.textContent')).includes('か月'), '毎月として加える: 月5,500円・年66,000円');
  ok((await txt('#listCount')).startsWith('毎月 9件') && (await txt('#tMonth')) === '21,110円', '毎月として加える: 件数と合計 ' + (await txt('#listCount')) + ' ' + (await txt('#tMonth')));
  ok((await ev(sec + '.textContent')).includes('毎月の一覧にあります'), '毎月として加えた表示');
  await ev(secIt + '.querySelector(".rm").click()'); await sleep(100);
  ok(!(await ev('!!' + secIt)) && (await txt('#tMonth')) === '15,610円' && await ev(sec + '.querySelectorAll("button").length') === 2, '毎月から外すと元に戻る');
  // 複数ファイル（PayPayカードに似た形の架空データ。月ごとに1ファイル、見出し行つき）
  async function pickMany(files) { const doc = (await send('DOM.getDocument')).result.root.nodeId; const q = (await send('DOM.querySelector', { nodeId: doc, selector: '#file' })).result.nodeId; await send('DOM.setFileInputFiles', { nodeId: q, files }); await sleep(700); }
  const PH = '"利用日/キャンセル日","利用店名・商品名","利用者","決済方法","支払区分","利用金額","手数料","支払総額"\n';
  const mon = m => PH + `"2026/${m}/3","ノートクラウド","本人*","カード","1回","1200","0","1200"\n"2026/${m}/12","動画みほん館","本人*","カード","1回","990","0","990"\n` + (m === 8 ? `"2026/8/14","駅前ベーカリー","本人*","カード","1回","480","0","480"\n` : '');
  await pickMany([wf('m7.csv', mon(7)), wf('m8.csv', mon(8)), wf('m9.csv', mon(9)), wf('m9copy.csv', mon(9))]);
  ok((await txt('#status')).includes('4ファイルをまとめて読み込み') && (await txt('#status')).includes('同じ中身のファイル 1件'), '複数ファイル: 件数と重複の案内 ' + (await txt('#status')).slice(0, 80));
  ok((await txt('#status')).includes('3か月分') && (await txt('#status')).includes('読み取れなかった行 0件'), '複数ファイル: 3か月分・見出し行は読み取れない行に数えない');
  ok(await cnt('#list .it') === 2 && (await txt('#list')).includes('ノートクラウド') && (await txt('#list')).includes('動画みほん館') && !(await txt('#list')).includes('ベーカリー'), '複数ファイル: 毎月2件');
  ok((await txt('#list')).includes('1,200円') && !(await txt('#list')).includes('2,400円'), '複数ファイル: 同じファイルを2回選んでも二重に数えない');
  await pickMany([wf('ok.csv', mon(7)), wf('bad.png', Buffer.from([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0]))]); ok((await txt('#status')).includes('bad.png') && !(await vis('#list')), '複数ファイル: 1つでも読めなければ止めて名前を出す');
  // 1か月だけ
  await ev('document.getElementById("paste").value="2026/09/01,A,100\\n2026/09/05,B,200"'); await click('#load'); ok((await txt('#status')).includes('2か月分以上'), '1か月は案内'); ok(!(await vis('#list')), '1か月は一覧なし');
  await click('#sample'); await sleep(100); await ev('document.getElementById("paste").value="2026/07/01,A,100\\n2026/07/05,B,200"'); await click('#load'); await sleep(100);
  ok(!(await vis('#band')) && !(await vis('#list')) && !(await vis('.listhead')), 'サンプルの後に1か月を読むと、前の結果が残らない');
  // XSS
  await ev('document.getElementById("paste").value="2026/07/01,<img src=x onerror=window.__x=1>,100\\n2026/08/01,<img src=x onerror=window.__x=1>,100"'); await click('#load'); await sleep(100);
  ok(await ev('window.__x===undefined') && (await txt('#list')).includes('<img'), 'XSSは文字表示');
  // 長い桁 → band--long
  await ev('document.getElementById("paste").value="2026/07/01,A,99999999\\n2026/08/01,A,99999999"'); await click('#load'); await sleep(50);
  ok(await ev('document.getElementById("band").classList.contains("band--long")'), '13字以上で1列'); ok((await txt('#tYear')) === '1,199,999,988円', '最大年額');
  // 消す
  await click('#clear'); ok(await vis('#resEmpty') && (await ev('document.getElementById("paste").value')) === '', '消す');
  ok((await ev('window.__net.filter(u=>u.indexOf("cloudflareinsights.com")<0)')).length === 0, '通信なし ' + J(await ev('window.__net'))); ok((await ev('window.__ls')).length === 0, '保存なし');

  // ===== 375px =====
  for (const scheme of ['light', 'dark']) {
    await open(375, 800, scheme); await click('#sample'); await sleep(100);
    await ev('[...document.querySelectorAll("#onceList li")].find(li=>li.textContent.includes("セキュリティ対策ソフト")).querySelector("button[aria-label^=年払い]").click()');
    await ev('document.querySelectorAll("#list .it input")[0].click()');
    await ev('document.querySelectorAll("details").forEach(d=>d.open=true)'); await sleep(100);
    ok(await ev('document.documentElement.scrollWidth<=375'), scheme + ' 375px 横スクロールなし ' + await ev('document.documentElement.scrollWidth'));
    ok(await ev('getComputedStyle(document.querySelector(".layout")).display') === 'block', '375pxは1カラム');
    const over = await ev(`[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>375.5||r.left<-0.5)}).map(e=>e.tagName+'.'+e.className).slice(0,5)`);
    ok(over.length === 0, scheme + ' はみ出し要素なし ' + J(over));
    const tap = await ev(`[...document.querySelectorAll('button,.filebtn,select,summary,.it .chk')].filter(e=>e.getClientRects().length&&!e.closest('[hidden]')).filter(e=>e.getBoundingClientRect().height<43.5).map(e=>e.id||e.className||e.tagName)`);
    ok(tap.length === 0, scheme + ' タップ領域44px ' + J(tap));
    const lap = await ev(`[...document.querySelectorAll('#list .it')].some(li=>{const a=li.querySelector('.chk').getBoundingClientRect();return [...li.querySelectorAll('.bdg span,.nm')].some(b=>{const r=b.getBoundingClientRect();return !(r.left>=a.right||r.right<=a.left||r.top>=a.bottom||r.bottom<=a.top) && b.className!=='nm'})})`);
    ok(!lap, scheme + ' チェックとバッジの重なりなし');
    const cpy = await ev(`(()=>{const b=[...document.querySelectorAll('.copy button')].map(x=>x.getBoundingClientRect());return b[1].top>=b[0].bottom})()`); ok(cpy, 'コピーボタン縦2段');
  }
  // 長い名前・8桁 375px
  const LONGJ = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらり', LONGA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMN';
  const longCsv = [LONGJ, LONGA].map(nm => ['2026/07/01', '2026/08/01'].map(d => d + ',' + nm + ',99999999').join(String.fromCharCode(10))).join(String.fromCharCode(10));
  await open(375, 800); await ev('document.getElementById("paste").value=' + JSON.stringify(longCsv)); await click('#load'); await sleep(100);
  ok(await ev('document.documentElement.scrollWidth<=375'), '長い名前・8桁で横スクロールなし');
  const lines = await ev(`[...document.querySelectorAll('#list .nm')].map(e=>Math.round(e.getBoundingClientRect().height/parseFloat(getComputedStyle(e).lineHeight)))`); ok(lines[0] <= 3, '全角40字は3行以内 ' + J(lines));
  ok(await ev('document.getElementById("band").classList.contains("band--long")'), '合計の帯は1列');
  ok(errs.length === 0, 'JSエラーなし ' + errs.join(' | '));
  console.log('e2e: ' + pass + '/' + (pass + fail) + ' passed');
  ws.close(); chrome.kill(); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { } setTimeout(() => process.exit(fail ? 1 : 0), 300);
})();
function J(v) { return JSON.stringify(v); }
