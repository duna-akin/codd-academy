/* End-to-end smoke test: drives the real UI in jsdom. Run with: npm test */
const { JSDOM } = require('jsdom');
const path = process.argv[2] || require('path').join(__dirname, '..', 'index.html');
const errors = [];

JSDOM.fromFile(path, {
  runScripts: 'dangerously',
  resources: 'usable',
  // jsdom refuses localStorage on a file:// origin; a real one exercises the save/load path.
  url: 'https://relational-algebra.test/index.html',
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

  // 0. With nothing solved, the last level must already be reachable.
  const pills = doc.querySelectorAll('.pill');
  if (doc.querySelectorAll('.pill[disabled], .pill.locked').length) {
    errors.push('locked pills present on a fresh profile');
  }
  click(pills[pills.length - 1]);
  console.log('jump  :', text('#levelLabel'), '(from a fresh profile, nothing solved)');
  if (!text('#levelLabel').includes('Level ' + LEVELS.length)) errors.push('could not jump to the last level');
  click(doc.querySelectorAll('.pill')[0]);
  if (!text('#levelLabel').includes('Level 1')) errors.push('could not jump back to level 1');

  // 0b. The level bar collapses, expands, and remembers which it was.
  const bar = $('#levelbar'), toggle = $('#barToggle');
  click(toggle);
  const collapsed = bar.classList.contains('collapsed') && toggle.getAttribute('aria-expanded') === 'false';
  let stored = {};
  try { stored = JSON.parse(window.localStorage.getItem('relational-algebra-game-v1') || '{}'); }
  catch (e) { errors.push('localStorage unavailable: ' + e.message); }
  click(toggle);
  const reopened = !bar.classList.contains('collapsed') && toggle.getAttribute('aria-expanded') === 'true';
  console.log('bar   :', 'collapses =', collapsed, '| reopens =', reopened,
              '| persisted barOpen =', stored.barOpen, '| label =', text('#barNow'));
  if (!collapsed || !reopened || stored.barOpen !== false) errors.push('level bar toggle misbehaved');

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
