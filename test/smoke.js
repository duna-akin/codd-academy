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
.then(async dom => {
  const { window } = dom;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
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

  // 5. Typing the expression instead of dragging it.
  click(doc.querySelectorAll('.pill')[1]);          // level 2: Just the names
  const expr = $('#exprInput');
  expr.focus();
  expr.value = 'project_{ename}(Employee)';         // ASCII form, no Greek keyboard
  expr.dispatchEvent(new window.Event('input', { bubbles: true }));
  console.log('typed :', 'canvas nodes =', doc.querySelectorAll('.node').length,
              '| rendered =', text('#formula').trim(),
              '| result cols =', doc.querySelectorAll('#output thead th').length);
  if (doc.querySelectorAll('.node').length < 2) errors.push('typing did not build the canvas tree');
  click($('#btnCheck'));
  console.log('check2:', text('#feedback').trim());
  if (!/Correct/.test(text('#feedback'))) errors.push('a typed answer was not accepted');

  // Bad syntax explains itself and leaves the canvas standing.
  const before = doc.querySelectorAll('.node').length;
  expr.value = 'project_{ename}(Employee';
  expr.dispatchEvent(new window.Event('input', { bubbles: true }));
  const quiet = $('#exprError').hidden;          // silent while you are still typing
  await sleep(900);                              // ...then it explains itself
  console.log('synerr:', text('#exprError').trim(), '| silent while typing =', quiet,
              '| canvas kept =', doc.querySelectorAll('.node').length === before);
  if (!quiet) errors.push('syntax errors should stay quiet until typing pauses');
  if ($('#exprError').hidden || doc.querySelectorAll('.node').length !== before) {
    errors.push('a syntax error should be reported without destroying the canvas');
  }

  // ...and dragging writes back into the text box.
  expr.blur();
  click($('#btnClear'));
  drop(doc.querySelector('.slot'), { kind: 'rel', value: 'Employee' });
  drop(doc.querySelector('.node'), { kind: 'op', value: 'project' });
  console.log('sync  :', 'canvas -> text =', JSON.stringify(expr.value));
  if (expr.value !== 'π_{}(Employee)') errors.push('canvas edits did not reach the text box');

  // 6. Autocomplete: build level 2's answer with nothing but letters and Tab.
  click($('#btnClear'));
  const menu = $('#exprSuggest');
  const shown = () => menu.hidden ? '(closed)'
    : [...menu.querySelectorAll('.s-word')].map(n => n.textContent).join(', ');
  // capture the caret before assigning value — assignment moves it to the end
  const type = t => {
    const at = expr.selectionStart;
    expr.value = expr.value.slice(0, at) + t + expr.value.slice(at);
    expr.setSelectionRange(at + t.length, at + t.length);
    expr.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const key = k => {
    const e = new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    expr.dispatchEvent(e);
    return e;
  };
  expr.focus();
  type('proj');
  const opMenu = shown();
  key('Tab');
  const snippet = expr.value, snippetCaret = expr.selectionStart;
  type('ena');
  const attrMenu = shown();                     // attribute-aware inside {}
  key('Tab'); key('Tab');                       // accept "ename", then step into ( )
  type('Emp');
  const relMenu = shown();
  key('Tab');
  console.log('menus :', 'after "proj" =', opMenu, '| inside {} after "ena" =', attrMenu,
              '| after "Emp" =', relMenu);
  console.log('tabbed:', JSON.stringify(snippet), 'caret', snippetCaret, '->', JSON.stringify(expr.value));
  if (snippet !== 'π_{}()' || snippetCaret !== 3) errors.push('Tab did not insert the π snippet');
  if (attrMenu !== 'ename') errors.push('no attribute suggestions inside {}');
  if (expr.value !== 'π_{ename}(Employee)') errors.push('tab-completion did not finish the query');
  click($('#btnCheck'));
  console.log('check3:', text('#feedback').trim());
  if (!/Correct/.test(text('#feedback'))) errors.push('the tab-completed answer was rejected');

  // Typing a closer that is already present steps over it instead of doubling it.
  expr.value = 'π_{a}(R)';
  expr.setSelectionRange(7, 7);
  const over = key(')');
  console.log('typeover:', 'caret', expr.selectionStart, '| value', JSON.stringify(expr.value));
  if (!over.defaultPrevented || expr.selectionStart !== 8) errors.push('closing-paren type-over failed');
  expr.blur();

  // 7. Aggregation: one node, two fields — grouping attributes left of the ℱ.
  click(doc.querySelectorAll('.pill')[26]);         // level 27: How many each?
  expr.focus();
  expr.value = 'dept group_{COUNT(eid)}(Employee)'; // ASCII spelling of ℱ
  expr.dispatchEvent(new window.Event('input', { bubbles: true }));
  console.log('agg   :', 'grouping fields on canvas =', doc.querySelectorAll('.pre-input').length,
              '| rendered =', text('#formula').trim(),
              '| rows =', doc.querySelectorAll('#output tbody tr').length,
              '| cols =', [...doc.querySelectorAll('#output thead th')].map(n => n.textContent).join(','));
  if (doc.querySelectorAll('.pre-input').length !== 1) errors.push('aggregate node lacks a grouping field');
  click($('#btnCheck'));
  console.log('check4:', text('#feedback').trim());
  if (!/Correct/.test(text('#feedback'))) errors.push('a typed aggregate was not accepted');

  // Inside {} the menu offers aggregate functions as well as attributes.
  expr.focus();
  expr.value = 'dept group_{CO}(Employee)';
  expr.setSelectionRange(14, 14);                   // inside the braces, just after "CO"
  expr.dispatchEvent(new window.Event('input', { bubbles: true }));
  console.log('fnmenu:', shown());
  if (!/COUNT/.test(shown())) errors.push('no aggregate-function suggestions inside {}');
  expr.blur();

  // The walk below assumes it starts at level 1.
  click(doc.querySelectorAll('.pill')[0]);

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
