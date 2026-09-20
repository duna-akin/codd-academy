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
  const jumpedToSQL = $('#sqlSurface') && !$('#sqlSurface').hidden;   // the last level is SQL only
  click(doc.querySelectorAll('.pill')[0]);
  if (!text('#levelLabel').includes('Level 1')) errors.push('could not jump back to level 1');
  console.log('switch:', 'the last level switched the language =', jumpedToSQL);
  if (!jumpedToSQL) errors.push('a SQL-only level should switch the language on its own');
  click($('#modeRA'));                                   // the sections below are about the algebra

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

  // 8. The result panel hides, so a student can work without the live answer.
  click(doc.querySelectorAll('.pill')[1]);          // level 2: Just the names
  expr.focus();
  expr.value = 'π_{ename}(Employee)';
  expr.dispatchEvent(new window.Event('input', { bubbles: true }));
  expr.blur();
  const visibleRows = doc.querySelectorAll('#output tbody tr').length;
  const resultToggle = $('#resultToggle');
  click(resultToggle);
  const hiddenRows = doc.querySelectorAll('#output tbody tr').length;
  let savedState = {};
  try { savedState = JSON.parse(window.localStorage.getItem('relational-algebra-game-v1') || '{}'); }
  catch (e) { /* checked elsewhere */ }
  console.log('hide  :', visibleRows, 'rows ->', hiddenRows, '| meta =', JSON.stringify(text('#outputMeta')),
              '| aria-expanded =', resultToggle.getAttribute('aria-expanded'),
              '| persisted =', savedState.resultOpen);
  if (hiddenRows !== 0 || text('#outputMeta') !== '' || savedState.resultOpen !== false) {
    errors.push('hiding the result should hide the rows, the row count, and persist');
  }

  // An invalid query still explains itself: that is validity, not the answer.
  expr.focus();
  expr.value = 'π_{nope}(Employee)';
  expr.dispatchEvent(new window.Event('input', { bubbles: true }));
  console.log('blind :', 'error still shown =', !!$('#output .error-msg'),
              '|', text('#output').trim().slice(0, 48));
  if (!$('#output .error-msg')) errors.push('errors should survive hiding the result');

  // Checking an answer works while blind.
  expr.value = 'π_{ename}(Employee)';
  expr.dispatchEvent(new window.Event('input', { bubbles: true }));
  expr.blur();
  click($('#btnCheck'));
  console.log('check5:', text('#feedback').trim(), '| rows still hidden =',
              doc.querySelectorAll('#output tbody tr').length === 0);
  if (!/Correct/.test(text('#feedback')) || doc.querySelectorAll('#output tbody tr').length !== 0) {
    errors.push('checking while blind should work and not reveal the table');
  }

  click(resultToggle);                                    // back to interactive for the walk below
  console.log('show  :', doc.querySelectorAll('#output tbody tr').length, 'rows |',
              text('#outputMeta'));
  if (doc.querySelectorAll('#output tbody tr').length !== visibleRows) {
    errors.push('reopening the result should bring the table back');
  }

  // 9. The other language: the same questions, answered in SQL.
  click(doc.querySelectorAll('.pill')[0]);
  click($('#modeSQL'));
  const sql = $('#sqlInput');
  const typeSql = t => { sql.value = t; sql.dispatchEvent(new window.Event('input', { bubbles: true })); };
  console.log('sqlmode:', 'algebra surface hidden =', $('#raSurface').hidden,
              '| clause chips =', doc.querySelectorAll('.clause-chip').length,
              '| question =', JSON.stringify(text('#question').slice(0, 44)));
  if (!$('#raSurface').hidden || $('#sqlSurface').hidden) errors.push('the SQL switch did not swap the editors');
  if (!doc.querySelectorAll('.clause-chip').length) errors.push('no clause palette in SQL mode');

  typeSql('SELECT * FROM Employee');
  console.log('sqlrun :', doc.querySelectorAll('#output thead th').length, 'columns,',
              doc.querySelectorAll('#output tbody tr').length, 'rows');
  click($('#btnCheck'));
  console.log('sqlchk1:', text('#feedback').trim());
  if (!/Correct/.test(text('#feedback'))) errors.push('a correct SQL answer was rejected');

  // Clicking a clause drops it in at the cursor.
  click($('#btnClear'));
  click(doc.querySelector('.clause-chip'));
  console.log('clause :', JSON.stringify(sql.value));
  if (sql.value !== 'SELECT ') errors.push('clicking a clause chip did not insert it');

  // SQL keeps duplicate rows, and the check says so.
  click(doc.querySelectorAll('.pill')[12]);              // level 13: A new database
  typeSql("SELECT sname FROM Student NATURAL JOIN Enrolled WHERE grade = 'A'");
  click($('#btnCheck'));
  const dupes = text('#feedback').trim();
  typeSql("SELECT DISTINCT sname FROM Student NATURAL JOIN Enrolled WHERE grade = 'A'");
  click($('#btnCheck'));
  console.log('dupes  :', dupes);
  if (!/DISTINCT/.test(dupes)) errors.push('a duplicate-row answer was not explained');
  if (!/Correct/.test(text('#feedback'))) errors.push('the DISTINCT answer was rejected');

  // Broken SQL stays quiet until you stop typing, then explains itself.
  typeSql('SELECT FROM');
  const sqlQuiet = $('#sqlError').hidden;
  await sleep(800);
  console.log('sqlerr :', text('#sqlError'), '| silent while typing =', sqlQuiet);
  if (!sqlQuiet || $('#sqlError').hidden) errors.push('SQL errors should wait for a pause, then appear');

  // Tab completion knows clauses, tables and columns.
  click($('#btnClear'));
  const sqlMenu = $('#sqlSuggest');
  const sqlShown = () => sqlMenu.hidden ? '(closed)'
    : [...sqlMenu.querySelectorAll('.s-word')].map(n => n.textContent).join(', ');
  const sqlType = t => {
    const at = sql.selectionStart;
    sql.value = sql.value.slice(0, at) + t + sql.value.slice(at);
    sql.setSelectionRange(at + t.length, at + t.length);
    sql.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const sqlKey = k => {
    const e = new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ctrlKey: k === 'CtrlEnter' });
    sql.dispatchEvent(k === 'CtrlEnter'
      ? new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ctrlKey: true })
      : e);
  };
  sql.focus();
  sqlType('sel');
  const kwMenu = sqlShown();
  sqlKey('Tab');
  sqlType('sna');
  const colMenu = sqlShown();
  sqlKey('Tab');
  sqlType(' fro');
  sqlKey('Tab');
  sqlType('Stu');
  const tableMenu = sqlShown();
  sqlKey('Tab');
  console.log('sqlmenu:', 'after "sel" =', kwMenu, '| after "sna" =', colMenu, '| after "Stu" =', tableMenu);
  console.log('sqltab :', JSON.stringify(sql.value));
  if (sql.value !== 'SELECT sname FROM Student') errors.push('tab completion did not write the SQL query');
  sqlKey('CtrlEnter');
  console.log('ctrl+↵ :', text('#feedback').trim().slice(0, 60));
  if (!/Not quite|Correct/.test(text('#feedback'))) errors.push('Ctrl+Enter did not check the answer');
  sql.blur();

  // A SQL-only level cannot be asked in the algebra, and says so.
  click(doc.querySelectorAll('.pill')[0]);
  click($('#modeRA'));
  click(doc.querySelectorAll('.pill')[38]);             // level 39: In order
  console.log('sqlonly:', text('#modeNote').trim().slice(0, 60), '| algebra disabled =', $('#modeRA').disabled);
  if (!$('#modeRA').disabled || $('#modeNote').hidden) errors.push('a SQL-only level should disable the algebra');
  typeSql('SELECT ename, salary FROM Employee ORDER BY salary');
  click($('#btnCheck'));
  const unordered = text('#feedback').trim();
  typeSql('SELECT ename, salary FROM Employee ORDER BY salary DESC');
  click($('#btnCheck'));
  console.log('ordered:', unordered);
  if (!/order/.test(unordered)) errors.push('row order should be checked on an ORDER BY level');
  if (!/Correct/.test(text('#feedback'))) errors.push('the ordered answer was rejected');

  // 10. The algebra you built, written out as SQL.
  click(doc.querySelectorAll('.pill')[3]);              // level 4: Filter, then project
  click($('#modeRA'));
  click($('#peekToggle'));
  expr.focus();
  expr.value = 'π_{ename}(σ_{salary > 60000}(Employee))';
  expr.dispatchEvent(new window.Event('input', { bubbles: true }));
  expr.blur();
  console.log('peek   :', JSON.stringify(text('#peek')));
  if (!/SELECT DISTINCT ename/.test(text('#peek'))) errors.push('the SQL translation did not appear');
  click($('#btnUseSQL'));
  click($('#btnCheck'));
  console.log('usesql :', $('#sqlSurface').hidden ? '(still in algebra)' : text('#feedback').trim());
  if ($('#sqlSurface').hidden || !/Correct/.test(text('#feedback'))) {
    errors.push('carrying the translated query into the SQL box did not work');
  }

  // 10b. Switching language brings the query with you, both ways.
  click(doc.querySelectorAll('.pill')[4]);              // level 5: Two conditions
  click($('#modeRA'));                                 // the language is sticky across levels
  expr.focus();
  expr.value = "π_{ename, salary}(σ_{dept = 'Engineering' AND age < 40}(Employee))";
  expr.dispatchEvent(new window.Event('input', { bubbles: true }));
  expr.blur();
  click($('#modeSQL'));
  console.log('carry→ :', JSON.stringify(sql.value.replace(/\n/g, ' ')));
  if (!/^SELECT DISTINCT ename, salary/.test(sql.value)) errors.push('the algebra did not come across as SQL');
  click($('#btnCheck'));
  if (!/Correct/.test(text('#feedback'))) errors.push('the carried-over SQL did not answer the level');

  // ...and back the other way, from a query the student wrote themselves.
  click($('#btnClear'));
  click($('#modeSQL'));
  typeSql('SELECT ename, salary FROM Employee WHERE age < 40 AND dept = \'Engineering\'');
  click($('#modeRA'));
  console.log('←carry :', JSON.stringify(expr.value), '| canvas nodes =', doc.querySelectorAll('.node').length);
  if (!/^π_\{ename, salary\}/.test(expr.value)) errors.push('the SQL did not come across as an expression tree');
  click($('#btnCheck'));
  if (!/Correct/.test(text('#feedback'))) errors.push('the carried-over algebra did not answer the level');

  // Some SQL has no algebra at all, and says which part.
  click(doc.querySelectorAll('.pill')[14]);             // level 15: For all
  click($('#modeSQL'));
  typeSql('SELECT DISTINCT eid FROM WorksOn W1 WHERE NOT EXISTS (' +
          'SELECT * FROM Project P WHERE NOT EXISTS (' +
          'SELECT * FROM WorksOn W2 WHERE W2.eid = W1.eid AND W2.pid = P.pid))');
  click($('#btnCheck'));
  const exists = /Correct/.test(text('#feedback'));
  click($('#modeRA'));
  console.log('noalgb :', text('#feedback').trim().slice(0, 72));
  if (!exists) errors.push('the NOT EXISTS answer to level 15 was rejected');
  if (!/no counterpart in the algebra/.test(text('#feedback'))) {
    errors.push('switching away from an untranslatable query should explain itself');
  }
  if (doc.querySelectorAll('.node').length) errors.push('a refused translation should leave the canvas empty');

  // 11. Every level, in every language it can be asked in.
  let failed = 0;
  for (const mode of ['ra', 'sql']) {
    const button = mode === 'sql' ? '#modeSQL' : '#modeRA';
    click(doc.querySelectorAll('.pill')[0]);
    click($(button));
    let walked = 0;
    for (let i = 0; i < LEVELS.length; i++) {
      if (mode === 'sql' ? !!LEVELS[i].sql : !!LEVELS[i].solution) {
        click($(button));                 // a single-language level may have switched us
        click($('#btnClear'));
        click($('#btnSolution'));
        click($('#btnCheck'));
        const fb = text('#feedback').trim();
        if (!/Correct/.test(fb)) { failed++; console.log('  ' + mode + ' L' + (i + 1) + ' FAIL: ' + fb); }
        walked++;
      }
      if (i < LEVELS.length - 1) {
        click($('#btnNext'));
        if (!text('#levelLabel').includes('Level ' + (i + 2))) {
          failed++; console.log('  nav FAIL at ' + (i + 1) + ': ' + text('#levelLabel'));
        }
      }
    }
    console.log('levels :', walked + ' solved through the UI in ' + (mode === 'sql' ? 'SQL' : 'the algebra'));
  }
  console.log('pills  :', text('#progress').replace(/\s+/g, ' '));
  console.log('errors:', errors.length ? errors : 'none');
  if (failed || errors.length) { console.log('\nSMOKE TEST FAILED'); process.exit(1); }
  console.log('\nSMOKE TEST PASSED');
}).catch(e => { console.error('FATAL', e); process.exit(1); });
