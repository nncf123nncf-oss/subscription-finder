// 計算コア(index.html の <script id="core">)の検算。実行: node source/run-checks.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
const ctx = {}; vm.createContext(ctx); vm.runInContext(src + ';this.X=SBF;', ctx); const X = ctx.X;
let n = 0, f = 0;
const J = v => JSON.stringify(v);
const eq = (a, b, m) => { n++; if (J(a) !== J(b)) { f++; console.log('NG', m, J(a), '!=', J(b)); } };
const tr = (c, m) => eq(!!c, true, m);
const TODAY = Date.UTC(2026, 9, 9);
const run = (text, today = TODAY) => { const tb = X.parseTable(text); const det = X.detectColumns(tb.rows); const b = X.buildRecords(tb.rows, det, det.cols, today); return { tb, det, b, an: X.analyze(b.ok) }; };
const names = a => a.map(x => x.name).sort();
const cols = d => JSON.parse(J(d.cols));

// S1 サンプル
const s1 = run(X.sampleText());
eq(s1.det.header, true, 'S1 見出しあり'); eq(cols(s1.det), { date: 0, name: 1, amt: 2 }, 'S1 列');
eq(s1.an.n, 3, 'S1 3か月');
eq(names(s1.an.monthly), ['WEB会議ツール', 'ノートPC 分割', 'ノートクラウド', 'クラウド保存箱', 'デザインスタジオ PRO', '予約うけつけ帳', '動画みほん館', '素材ストック*Z1X5'].sort(), 'S1 毎月8件');
eq(s1.an.monthly.filter(x => x.kind === 'vary').map(x => [x.name, x.month, x.year]), [['クラウド保存箱', 470, 5640]], 'S1 変わる額');
eq(names(s1.an.some), ['フォント倉庫'], 'S1 ときどき'); eq(s1.an.annual.length, 0, 'S1 自動年払いなし');
eq(s1.an.once.length, 7, 'S1 1回だけ7件');
eq(s1.b.bad.map(x => x.reason), ['年が書かれていない', '返金・取消の行'], 'S1 読み取れない2件');
let items = X.listItems(s1.an, {}); let t = X.totals(items, {});
eq([t.month, t.year], [15610, 187320], 'S1 合計');
eq(items.slice(0, 3).map(x => x.month), [3300, 3000, 2800], 'S1 並び');
const sec = s1.an.once.find(o => o.name === 'セキュリティ対策ソフト');
items = X.listItems(s1.an, { [sec.key]: 1 }); t = X.totals(items, { [items[0].key]: 1, [items[1].key]: 1 });
eq([t.month, t.year, t.mMonth, t.mYear], [15610 + 458, 187320 + 5500, 6300, 75600], 'S12 手動年払い・印の合計');
eq(items[items.length - 1].kind, 'annual-manual', 'S12 年払いは末尾(月あたり458)');
// S2 名前
['NETNOTE*AB12C', 'NETNOTE*ZZ9', 'ｎｅｔｎｏｔｅ', 'NETNOTE 123456', 'netnote'].forEach(s => eq(X.normKey(s), 'NETNOTE', 'S2 ' + s));
tr(X.normKey('NETNOTE PLUS') !== 'NETNOTE', 'S2 別名'); eq(X.normKey('素材ストック＊K7Q2'), '素材ストック', 'S2 全角＊');
// S3 日付
['2026/9/5', '2026-09-05', '2026年9月5日', 'R8.9.5', '令和8年9月5日', '2026/09/05 12:30', '20260905'].forEach(s => eq(X.parseDate(s, TODAY).t, Date.UTC(2026, 8, 5), 'S3 ' + s));
eq(X.parseDate('9/5', TODAY).err, '年が書かれていない', 'S3 年なし'); eq(X.parseDate('2026/2/30', TODAY).err, '実在しない日付', 'S3 2/30');
eq(X.parseDate('2027/1/1', TODAY).err, '未来の日付', 'S3 未来'); eq(X.parseDate('26/09/05', TODAY).err, '年が2けたで読めない', 'S3 2桁年'); eq(X.parseDate('', TODAY).err, '日付が空欄', 'S3 空');
// S4 金額
['1,200', '¥1,200', '１２００円', '"1,200"', ' 1200 '].forEach(s => eq(X.parseAmount(s).v, 1200, 'S4 ' + s));
eq(X.parseAmount('').err, '金額が空欄', 'S4 空'); eq(X.parseAmount('-1200').err, '返金・取消の行', 'S4 負'); eq(X.parseAmount('▲1200').err, '返金・取消の行', 'S4 ▲');
eq(X.parseAmount('0').err, '金額が0円', 'S4 0'); eq(X.parseAmount('abc').err, '金額が読めない', 'S4 abc'); eq(X.parseAmount('100000000').err, '金額が大きすぎる', 'S4 1億'); eq(X.parseAmount('99999999').v, 99999999, 'S4 上限');
// S5 期間
const one = run('2026/09/01,A,100\n2026/09/05,B,200'); tr(one.an.need, 'S5 1か月はneed');
const gap = run('2026/07/01,A,100\n2026/09/01,A,100\n2026/07/02,B,50\n2026/08/02,B,50\n2026/09/02,B,50'); eq(gap.an.n, 3, 'S5 N=3'); eq(names(gap.an.some), ['A'], 'S5 Aはときどき'); eq(names(gap.an.monthly), ['B'], 'S5 Bは毎月');
// S6 同じ月複数
const mul = run('2026/07/01,A,1200\n2026/07/15,A,1200\n2026/08/01,A,2400');
eq([mul.an.monthly[0].kind, mul.an.monthly[0].month, mul.an.monthly[0].multi], ['same', 2400, true], 'S6 同月合計');
// S8 列判定
const noh = run('2026/07/01\tノートクラウド\t1200\n2026/08/01\tノートクラウド\t1200'); eq(noh.det.header, false, 'S8 見出しなし'); eq(cols(noh.det), { date: 0, name: 1, amt: 2 }, 'S8 タブ'); eq(noh.tb.delim, '\t', 'S8 区切りタブ');
const rev = run('1200,ノートクラウド,2026/07/01\n1200,ノートクラウド,2026/08/01'); eq(cols(rev.det), { date: 2, name: 1, amt: 0 }, 'S8 列順違い');
const card = run('利用日,カード,利用先,利用金額\n2026/07/01,****-1234,ノートクラウド,1200\n2026/08/01,****-1234,ノートクラウド,1200');
eq(cols(card.det), { date: 0, name: 2, amt: 3 }, 'S8 カード列を使わない');
const ct = X.copyText(X.listItems(card.an, {}), {}, false); tr(!/1234/.test(ct), 'S8 コピーにカード番号なし');
const noheadCard = run('2026/07/01,****-1234,ノートクラウド,1200\n2026/08/01,****-1234,ノートクラウド,1200'); eq(noheadCard.det.cols.name, 2, 'S8 見出しなしでもカード列を支払先にしない');
// S9 安全・上限
const xss = run('2026/07/01,<img src=x onerror=alert(1)>,100\n2026/08/01,<img src=x onerror=alert(1)>,100'); eq(xss.an.monthly[0].name, '<img src=x onerror=alert(1)>', 'S9 文字として保持');
const big = []; for (let i = 0; i < 3005; i++) big.push('2026/0' + (7 + i % 3) + '/01,A' + i + ',100'); const bg = run(big.join('\n')); eq(bg.b.over, 5, 'S9 3000行超'); eq(bg.b.ok.length, 3000, 'S9 3000行');
// S10 コピー
const cAll = X.copyText(items, {}, false).split('\n'); eq(cAll.length, items.length + 1, 'S10 行数'); tr(cAll[cAll.length - 1].startsWith('合計（9件）'), 'S10 合計行');
const cM = X.copyText(items, { [items[0].key]: 1 }, true).split('\n'); eq(cM.length, 2, 'S10 印だけ'); tr(!/2026/.test(cAll.join('')), 'S10 日付を含まない');
// S12 自動年払い
const yr = []; for (let k = 0; k < 13; k++) { const ym = 2025 * 12 + 8 + k; yr.push(Math.floor(ym / 12) + '/' + (ym % 12 + 1) + '/03,ノートクラウド,1200'); }
yr.push('2025/09/20,ドメイン更新,1650', '2026/09/18,ドメイン更新,1650', '2025/10/01,短い間隔,500', '2026/07/28,短い間隔,500', '2025/09/21,額違い,900', '2026/09/21,額違い,1000');
const y = run(yr.join('\n')); eq(y.an.n, 13, 'S12 13か月');
eq(y.an.annual.map(a => [a.name, a.kind, a.year, a.month]), [['ドメイン更新', 'annual-auto', 1650, 138]], 'S12 自動年払い');
tr(!y.an.some.some(s => s.name === 'ドメイン更新'), 'S12 ときどきに出ない'); tr(y.an.some.some(s => s.name === '短い間隔'), 'S12 300日は年払いでない'); tr(y.an.some.some(s => s.name === '額違い'), 'S12 額違いは年払いでない');
const it2 = X.listItems(s1.an, { [s1.an.monthly[0].key]: 1 }); eq(it2.length, 8, 'S12 毎月キーを手動指定しても増えない');
eq(X.yen(1199999988), '1,199,999,988円', 'yen'); eq(X.yen(0), '0円', 'yen0');
// レビュー①の指摘の再現
const shime = [];
['2026/07/16','2026/08/03','2026/09/03','2026/10/03'].forEach(d => shime.push(d + ',サブスクA,1000'));
['2026/07/20','2026/08/20','2026/09/20'].forEach(d => shime.push(d + ',サブスクB,500'));
['2026/07/25','2026/08/10','2026/08/25','2026/09/10','2026/09/25','2026/10/10','2026/10/15'].forEach((d, i) => shime.push(d + ',買い物' + i + ',300'));
const sm = run(shime.join('\n'), Date.UTC(2026, 9, 20)); eq(names(sm.an.monthly), ['サブスクA', 'サブスクB'], 'R1 15日締めの明細でも毎月が見つかる'); eq(sm.an.partial.length, 2, 'R1 途中の月を2つ判定から外す');
const late = run(X.sampleText() + '\n2026/05/28,遅れて載った店,800'); eq(late.an.monthly.length, 8, 'R1 遅れて載った1行で毎月が0件にならない'); eq(late.an.outside, 1, 'R1 期間外1件');
eq(X.normKey('PAYPAL *NETFLIX') !== X.normKey('PAYPAL *EBAY'), true, 'R3 代行業者*加盟店名は別');
eq(X.normKey('APPLE.COM/BILL'), 'APPLE.COM/BILL', 'R3 /BILL は残す'); eq(X.normKey('NETNOTE*ZZ9'), 'NETNOTE', 'R3 参照番号は従来どおり');
const unq = run('ご利用日,ご利用先,ご利用金額\n2026/07/03,ノートクラウド,1,200\n2026/08/03,ノートクラウド,1,200'); eq(unq.b.ok.length, 0, 'R2a 引用符なし1,200は読まない'); tr(/列の数が合わない/.test(unq.b.bad[0].reason), 'R2a 理由');
const cntcol = run('2026/07/03,ノートクラウド,1200,1\n2026/08/03,ノートクラウド,1200,1\n2026/07/05,素材,3300,1\n2026/08/05,素材,3300,1'); eq(cntcol.det.cols.amt, 2, 'R2b 右端の回数列を金額にしない');
const holder = run('山田 太郎 様,4980-****-****-1234,ご請求額\n2026/07/03,ノートクラウド,1200\n2026/08/03,ノートクラウド,1200');
tr(holder.b.bad.every(b => !/1234|山田/.test(b.name)), 'R4 契約者行のカード番号・氏名を出さない ' + JSON.stringify(holder.b.bad));
eq(holder.an.monthly.length, 1, 'R4 契約者行があっても読める');
console.log('checks: ' + (n - f) + '/' + n + ' passed'); process.exit(f ? 1 : 0);
