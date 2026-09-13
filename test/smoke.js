/* End-to-end smoke test: drives the real UI in jsdom. Run with: npm test */
const { JSDOM } = require('jsdom');
const path = require('path').join(__dirname, '..', 'index.html');
const errors = [];

JSDOM.fromFile(path, {
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: new (require('jsdom').VirtualConsole)()
    .on('jsdomError', e => { if (!/getContext/.test(e.message)) errors.push('jsdomError: ' + e.message); })
    .on('error', (...a) => errors.push('console.error: ' + a.join(' ')))
}).then(dom => new Promise(r => dom.window.addEventListener('load', () => setTimeout(() => r(dom), 120))))
.then(dom => {
  const { window } = dom;
  const doc = window.document;
  const $ = s => doc.querySelector(s);
  const click = n => n.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const text = s => ($(s) || {}).textContent || '';
  const LEVELS = window.GAME.LEVELS;

  console.log('boot  :', text('#levelLabel'), '|', text('#levelTitle'));
  console.log('tables:', doc.querySelectorAll('.table-card').length, 'relation cards,',
              doc.querySelectorAll('.op-chip').length, 'operator chips');

  // 1. Click-to-place: arm the Employee chip, click the empty slot.
  click(doc.querySelector('.table-head'));
  click(doc.querySelector('.slot'));
  console.log('place :', 'formula =', text('#formula').trim(), '| rows shown =',
              doc.querySelectorAll('#output tbody tr').length);
  click($('#btnCheck'));
  console.log('check1:', text('#feedback').trim());

  // 2. Wrap the relation in an operator by dropping onto the existing node.
  const drop = (target, payload) => {
    const dt = { data: {}, setData(k, v) { this.data[k] = v; }, getData(k) { return this.data[k]; } };
    dt.setData('text/plain', JSON.stringify(payload));
    const ev = new window.Event('drop', { bubbles: true, cancelable: true });
    ev.dataTransfer = dt;
    target.dispatchEvent(ev);
  };
  drop(doc.querySelector('.node'), { kind: 'op', value: 'project' });
  const input = doc.querySelector('.param-input');
  input.value = 'ename';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  console.log('wrap  :', text('#formula').trim(), '| result cols =',
              doc.querySelectorAll('#output thead th').length);

  // 3. A deliberately wrong answer, then a broken condition.
  click($('#btnCheck'));
  console.log('wrong :', text('#feedback').trim());
  input.value = 'nope';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  console.log('error :', text('#output').trim().slice(0, 80));

  // 4. Hints, then walk every level via Show solution -> Check -> Next.
  click($('#btnHint'));
  console.log('hint  :', text('#feedback').trim().slice(0, 70));

  let failed = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    click($('#btnClear'));
    click($('#btnSolution'));
    click($('#btnCheck'));
    const fb = text('#feedback').trim();
    const ok = /Correct/.test(fb);
    if (!ok) { failed++; console.log('  L' + (i + 1) + ' FAIL: ' + fb); }
    if (i < LEVELS.length - 1) {
      click($('#btnNext'));
      if (!text('#levelLabel').includes('Level ' + (i + 2))) {
        failed++; console.log('  nav FAIL at ' + (i + 1) + ': ' + text('#levelLabel'));
      }
    }
  }
  console.log('levels:', LEVELS.length - failed + '/' + LEVELS.length, 'solved through the UI');
  console.log('pills :', text('#progress'));
  console.log('errors:', errors.length ? errors : 'none');
  if (failed || errors.length) { console.log('\nSMOKE TEST FAILED'); process.exit(1); }
  console.log('\nSMOKE TEST PASSED');
}).catch(e => { console.error('FATAL', e); process.exit(1); });
