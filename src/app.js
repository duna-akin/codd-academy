/* Game UI: drag-and-drop expression tree, live evaluation, answer checking. */
(function () {
  'use strict';

  var RA = window.RA, SQL = window.SQL, GAME = window.GAME;
  var LEVELS = GAME.LEVELS, DATABASES = GAME.DATABASES, OPS = RA.OPS;
  var STORE_KEY = 'relational-algebra-game-v1';
  var MAX_PREVIEW_ROWS = 40;

  var state = {
    levelIndex: 0,
    mode: 'ra',          // 'ra' = build an expression, 'sql' = write a query
    tree: null,
    sql: '',
    hintsShown: 0,
    usedHelp: false,
    solved: { ra: {}, sql: {} },   // mode -> levelIndex -> 'gold' | 'silver'
    armed: null,         // {kind:'op'|'rel', value:string} for click-to-place
    barOpen: true,       // is the level bar expanded?
    resultOpen: true,    // show the live result, or work blind?
    peekOpen: false      // show the algebra query rendered as SQL?
  };

  var el = {};

  /* ---------- persistence ---------- */

  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (saved && saved.solved) {
        // Progress used to be one flat map, from before there was a second
        // language to solve a level in; those stars were all algebra.
        var flat = Object.keys(saved.solved).every(function (k) { return typeof saved.solved[k] === 'string'; });
        state.solved = flat ? { ra: saved.solved, sql: {} }
                            : { ra: saved.solved.ra || {}, sql: saved.solved.sql || {} };
      }
      if (typeof saved.levelIndex === 'number') {
        state.levelIndex = Math.min(Math.max(saved.levelIndex, 0), LEVELS.length - 1);
      }
      if (saved.mode === 'ra' || saved.mode === 'sql') state.mode = saved.mode;
      if (typeof saved.barOpen === 'boolean') state.barOpen = saved.barOpen;
      if (typeof saved.resultOpen === 'boolean') state.resultOpen = saved.resultOpen;
      if (typeof saved.peekOpen === 'boolean') state.peekOpen = saved.peekOpen;
    } catch (e) { /* fresh start */ }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        solved: state.solved, levelIndex: state.levelIndex, mode: state.mode,
        barOpen: state.barOpen, resultOpen: state.resultOpen, peekOpen: state.peekOpen
      }));
    } catch (e) { /* private mode: progress simply will not persist */ }
  }

  /* ---------- helpers ---------- */

  function level() { return LEVELS[state.levelIndex]; }

  /* Not every question can be asked in both languages: ORDER BY has no algebra,
     and a level may have no SQL form worth writing. */
  function has(lv, mode) { return mode === 'sql' ? !!lv.sql : !!lv.solution; }

  function otherMode() { return state.mode === 'sql' ? 'ra' : 'sql'; }
  function modeName(mode) { return mode === 'sql' ? 'SQL' : 'the algebra'; }
  function solvedIn(mode) { return state.solved[mode] || (state.solved[mode] = {}); }

  function countIn(mode) {
    return LEVELS.filter(function (lv, i) { return has(lv, mode) && solvedIn(mode)[i]; }).length;
  }
  function totalIn(mode) {
    return LEVELS.filter(function (lv) { return has(lv, mode); }).length;
  }

  /* The question, tip, hints and palette highlights as the current language
     tells them. The level's own fields are the algebra's. */
  function view() {
    var lv = level();
    if (state.mode === 'sql') {
      var sql = lv.sql || {};
      return { question: sql.question || lv.question, tip: sql.tip || lv.tip,
               hints: sql.hints || [], focus: sql.focus || [] };
    }
    return { question: lv.question, tip: lv.tip, hints: lv.hints || [], focus: lv.focus || [] };
  }

  function currentDB() {
    var db = {};
    DATABASES[level().db].relations.forEach(function (r) { db[r.name] = r; });
    return db;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function clone(node) {
    if (!node) return null;
    if (node.type === 'rel') return { type: 'rel', name: node.name };
    return {
      type: 'op', op: node.op, param: node.param || '', group: node.group || '',
      children: (node.children || []).map(clone)
    };
  }

  function newOpNode(opName) {
    var arity = OPS[opName].arity;
    return { type: 'op', op: opName, param: '', group: '', children: new Array(arity).fill(null) };
  }

  /* ---------- tree addressing ---------- */

  function getNode(path) {
    var node = state.tree;
    for (var i = 0; i < path.length; i++) {
      if (!node || !node.children) return null;
      node = node.children[path[i]];
    }
    return node;
  }

  function setNode(path, value) {
    if (!path.length) { state.tree = value; return; }
    var parent = getNode(path.slice(0, -1));
    if (parent && parent.children) parent.children[path[path.length - 1]] = value;
  }

  // Removing an operator promotes its first filled child, so you can peel layers off.
  function removeAt(path) {
    var node = getNode(path);
    var promoted = null;
    if (node && node.children) {
      promoted = node.children.filter(Boolean)[0] || null;
    }
    setNode(path, promoted);
  }

  /* ---------- placing nodes ---------- */

  function place(path, payload) {
    var target = getNode(path);
    var node;
    if (payload.kind === 'rel') {
      node = { type: 'rel', name: payload.value };
    } else {
      node = newOpNode(payload.value);
      // Dropping an operator onto something that already exists wraps it.
      if (target) node.children[0] = target;
    }
    setNode(path, node);
    state.armed = null;
    render();
    focusFirstEmptyParam(path);
  }

  function focusFirstEmptyParam(path) {
    var selector = '.param-input[data-path="' + JSON.stringify(path) + '"]';
    var input = el.canvas.querySelector(selector);
    if (input && !input.value) input.focus();
  }

  /* ---------- rendering: tables ---------- */

  function tableHTML(rel, options) {
    options = options || {};
    var rows = rel.rows;
    var truncated = false;
    if (!options.all && rows.length > MAX_PREVIEW_ROWS) {
      rows = rows.slice(0, MAX_PREVIEW_ROWS);
      truncated = true;
    }
    var html = '<table class="rel-table"><thead><tr>' +
      rel.attrs.map(function (a) { return '<th>' + esc(a) + '</th>'; }).join('') +
      '</tr></thead><tbody>';
    if (!rel.rows.length) {
      html += '<tr class="empty-row"><td colspan="' + Math.max(rel.attrs.length, 1) + '">no rows</td></tr>';
    }
    rows.forEach(function (row) {
      html += '<tr>' + rel.attrs.map(function (a) {
        var v = row[a];
        var cls = typeof v === 'number' ? ' class="num"' : '';
        return '<td' + cls + '>' + esc(v) + '</td>';
      }).join('') + '</tr>';
    });
    html += '</tbody></table>';
    if (truncated) {
      html += '<p class="truncated">showing ' + MAX_PREVIEW_ROWS + ' of ' + rel.rows.length + ' rows</p>';
    }
    return html;
  }

  function renderTables() {
    var info = DATABASES[level().db];
    // In SQL mode there is no canvas to drag onto, so a card is a click that
    // types the table's name for you.
    var isSQL = state.mode === 'sql';
    el.dbName.textContent = info.label;
    el.dbBlurb.textContent = info.blurb;
    el.tables.innerHTML = info.relations.map(function (r) {
      return '<div class="table-card">' +
        '<div class="table-head" draggable="' + (isSQL ? 'false' : 'true') + '" data-rel="' + esc(r.name) + '" ' +
             'title="' + (isSQL ? 'Click to put this table in the query' : 'Drag me into the query canvas') + '">' +
          '<span class="grip">' + (isSQL ? '▦' : '⠿') + '</span>' +
          '<span class="rel-name">' + esc(r.name) + '</span>' +
          '<span class="rel-meta">' + r.rows.length + ' rows</span>' +
        '</div>' +
        '<div class="table-body">' + tableHTML(r, { all: true }) + '</div>' +
      '</div>';
    }).join('');

    el.tables.querySelectorAll('.table-head').forEach(function (head) {
      head.addEventListener('dragstart', function (e) {
        startDrag(e, { kind: 'rel', value: head.dataset.rel });
      });
      head.addEventListener('dragend', endDrag);
      head.addEventListener('click', function () {
        if (state.mode === 'sql') insertIntoSQL(head.dataset.rel);
        else arm({ kind: 'rel', value: head.dataset.rel }, head);
      });
    });
  }

  /* ---------- rendering: palette ---------- */

  function renderTools() {
    var isSQL = state.mode === 'sql';
    el.opBlock.hidden = isSQL;
    el.clauseBlock.hidden = !isSQL;
    if (isSQL) renderClauses();
    else renderPalette();
  }

  function renderClauses() {
    var focus = view().focus || [];
    el.clauses.innerHTML = SQL.CLAUSES.map(function (c, i) {
      var isNew = focus.indexOf(c.word) !== -1;
      return '<button class="op-chip clause-chip clause-' + c.kind + (isNew ? ' is-new' : '') + '" ' +
        'type="button" data-i="' + i + '" title="' + esc(c.word + ' — ' + c.hint) + '">' +
        '<span class="clause-word">' + esc(c.word) + '</span>' +
        (isNew ? '<span class="op-badge">new</span>' : '') +
      '</button>';
    }).join('');

    el.clauses.querySelectorAll('.clause-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        insertIntoSQL(SQL.CLAUSES[parseInt(chip.dataset.i, 10)].insert);
      });
    });
  }

  function insertIntoSQL(text) {
    var input = el.sqlInput;
    var at = input.selectionStart, end = input.selectionEnd;
    input.value = input.value.slice(0, at) + text + input.value.slice(end);
    input.setSelectionRange(at + text.length, at + text.length);
    input.focus();
    onSqlInput({ noSuggest: true });
  }

  function renderPalette() {
    var focus = view().focus || [];
    el.palette.innerHTML = Object.keys(OPS).map(function (key) {
      var meta = OPS[key];
      var isNew = focus.indexOf(key) !== -1;
      return '<button class="op-chip op-' + key + (isNew ? ' is-new' : '') + '" draggable="true" ' +
        'data-op="' + key + '" title="' + esc(meta.name + ' — ' + meta.hint) + '">' +
        '<span class="op-sym">' + meta.symbol + '</span>' +
        '<span class="op-name">' + esc(meta.name) + '</span>' +
        (isNew ? '<span class="op-badge">new</span>' : '') +
      '</button>';
    }).join('');

    el.palette.querySelectorAll('.op-chip').forEach(function (chip) {
      chip.addEventListener('dragstart', function (e) {
        startDrag(e, { kind: 'op', value: chip.dataset.op });
      });
      chip.addEventListener('dragend', endDrag);
      chip.addEventListener('click', function () {
        arm({ kind: 'op', value: chip.dataset.op }, chip);
      });
    });
  }

  /* ---------- rendering: expression tree ---------- */

  function buildNode(node, path) {
    if (!node) return buildSlot(path);

    var wrap = document.createElement('div');
    wrap.className = 'node ' + (node.type === 'rel' ? 'node-rel' : 'node-op op-' + node.op);
    wrap.dataset.path = JSON.stringify(path);

    var head = document.createElement('div');
    head.className = 'node-head';

    if (node.type === 'rel') {
      head.innerHTML = '<span class="node-sym">' + esc(node.name) + '</span>';
    } else {
      var meta = OPS[node.op];
      var symbol = document.createElement('span');
      symbol.className = 'node-sym';
      symbol.title = meta.name;
      symbol.textContent = meta.symbol;
      // Aggregation writes its grouping attributes to the left of the symbol.
      if (meta.pre) {
        head.appendChild(fieldInput(node, 'group', path, meta, meta.preLabel, meta.prePlaceholder, true));
      }
      head.appendChild(symbol);
      if (meta.param !== 'none') {
        head.appendChild(fieldInput(node, 'param', path, meta, meta.paramLabel, meta.placeholder, false));
      }
    }

    var del = document.createElement('button');
    del.className = 'node-del';
    del.type = 'button';
    del.innerHTML = '×';
    del.title = node.type === 'rel' ? 'Remove this relation' : 'Remove this operator (its first input moves up)';
    del.addEventListener('click', function (e) {
      e.stopPropagation();
      removeAt(path);
      render();
    });
    head.appendChild(del);
    wrap.appendChild(head);

    if (node.type === 'op') {
      var kids = document.createElement('div');
      kids.className = 'node-kids arity-' + OPS[node.op].arity;
      for (var i = 0; i < OPS[node.op].arity; i++) {
        kids.appendChild(buildNode((node.children || [])[i], path.concat(i)));
      }
      wrap.appendChild(kids);
    }

    attachDropTarget(wrap, path);
    return wrap;
  }

  function fieldInput(node, field, path, meta, label, placeholder, isPre) {
    var input = document.createElement('input');
    input.className = 'param-input' + (isPre ? ' pre-input' : '');
    input.type = 'text';
    input.value = node[field] || '';
    input.placeholder = placeholder || label;
    input.dataset.path = JSON.stringify(path);
    input.setAttribute('aria-label', meta.name + ' ' + label);
    input.addEventListener('input', function () {
      node[field] = input.value;
      refreshOutput();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); check(); }
    });
    // Typing must not be hijacked by the node's own drag handlers.
    input.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    return input;
  }

  function buildSlot(path) {
    var slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.path = JSON.stringify(path);
    slot.innerHTML = '<span>drop a relation or operator</span>';
    attachDropTarget(slot, path);
    return slot;
  }

  function attachDropTarget(node, path) {
    node.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.stopPropagation();
      clearDropHighlight();
      node.classList.add('drop-hover');
    });
    node.addEventListener('dragleave', function () { node.classList.remove('drop-hover'); });
    node.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      clearDropHighlight();
      var payload = readDrag(e);
      if (payload) place(path, payload);
    });
    node.addEventListener('click', function (e) {
      if (!state.armed) return;
      e.stopPropagation();
      place(path, state.armed);
    });
  }

  function clearDropHighlight() {
    el.canvas.querySelectorAll('.drop-hover').forEach(function (n) { n.classList.remove('drop-hover'); });
  }

  function renderTree() {
    el.canvas.innerHTML = '';
    el.canvas.appendChild(buildNode(state.tree, []));
    el.canvas.classList.toggle('is-armed', !!state.armed);
  }

  /* ---------- drag plumbing ---------- */

  function startDrag(e, payload) {
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
    document.body.classList.add('dragging');
    state.armed = null;
    updateArmedUI();
  }

  function endDrag() {
    document.body.classList.remove('dragging');
    clearDropHighlight();
  }

  function readDrag(e) {
    try { return JSON.parse(e.dataTransfer.getData('text/plain')); }
    catch (err) { return null; }
  }

  function arm(payload, sourceEl) {
    var same = state.armed && state.armed.kind === payload.kind && state.armed.value === payload.value;
    state.armed = same ? null : payload;
    updateArmedUI();
    if (state.armed) {
      setFeedback('info', 'Now click a slot in the canvas to place ' +
        (payload.kind === 'rel' ? payload.value : OPS[payload.value].symbol + ' ' + OPS[payload.value].name) +
        '. (Dragging works too.)');
    } else {
      clearFeedback();
    }
    if (sourceEl) { /* class refresh happens in updateArmedUI */ }
  }

  function updateArmedUI() {
    document.querySelectorAll('.op-chip, .table-head').forEach(function (n) {
      var payload = n.dataset.op ? { kind: 'op', value: n.dataset.op } : { kind: 'rel', value: n.dataset.rel };
      var on = !!state.armed && state.armed.kind === payload.kind && state.armed.value === payload.value;
      n.classList.toggle('armed', on);
    });
    el.canvas.classList.toggle('is-armed', !!state.armed);
  }

  /* ---------- evaluation ---------- */

  function evaluateTree() {
    try {
      return { ok: true, relation: RA.evaluate(state.tree, currentDB()) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /* ---------- autocomplete in the expression box ---------- */

  // Unary operators and ⋈ land you inside {} ready to type the parameter.
  var COMPLETIONS = [
    { word: 'project',    insert: 'π_{}()', caret: 3 }, { word: 'pi',        insert: 'π_{}', caret: 3 },
    { word: 'select',     insert: 'σ_{}()', caret: 3 }, { word: 'sigma',     insert: 'σ_{}', caret: 3 },
    { word: 'rename',     insert: 'ρ_{}()', caret: 3 }, { word: 'rho',       insert: 'ρ_{}', caret: 3 },
    { word: 'join',       insert: '⋈ ' },
    { word: 'union',      insert: '∪ ' },
    { word: 'intersect',  insert: '∩ ' },
    { word: 'minus',      insert: '− ' }, { word: 'difference', insert: '− ' },
    { word: 'except',     insert: '− ' },
    { word: 'product',    insert: '× ' }, { word: 'times',      insert: '× ' },
    { word: 'cross',      insert: '× ' },
    { word: 'divide',     insert: '÷ ' },
    { word: 'group',      insert: 'ℱ_{}()', caret: 3 },
    { word: 'aggregate',  insert: 'ℱ_{}()', caret: 3 }
  ].map(function (c) {
    var opName = { 'π': 'project', 'σ': 'select', 'ρ': 'rename', '⋈': 'join', '∪': 'union',
                   '∩': 'intersect', '−': 'difference', '×': 'product', '÷': 'divide',
                   'ℱ': 'group' }[c.insert[0]];
    return { kind: 'op', word: c.word, insert: c.insert, caret: c.caret,
             symbol: c.insert[0], hint: OPS[opName].hint };
  });

  // One menu, two editors: the expression box and the SQL box each describe
  // how to find their caret and what to offer there.
  var surfaces = {};
  var suggest = { items: [], index: 0, open: false, surface: null, wordStart: 0 };

  // Inside {...} or [...] you are writing a parameter, so offer attributes.
  function inParameter(text, caret) {
    var depth = 0;
    for (var i = 0; i < caret; i++) {
      if (text[i] === '{' || text[i] === '[') depth++;
      else if (text[i] === '}' || text[i] === ']') depth = Math.max(0, depth - 1);
    }
    return depth > 0;
  }

  function currentWord(input) {
    var caret = input.selectionStart;
    var m = /[A-Za-z_][A-Za-z0-9_.]*$/.exec(input.value.slice(0, caret));
    return { text: m ? m[0] : '', start: m ? caret - m[0].length : caret, caret: caret };
  }

  function byPrefix(list, prefix) {
    var low = prefix.toLowerCase();
    return list.filter(function (c) {
      return c.word.toLowerCase().indexOf(low) === 0 && c.word.toLowerCase() !== low;
    }).slice(0, 8);
  }

  function relationItems() {
    return DATABASES[level().db].relations.map(function (r) {
      return { kind: 'rel', word: r.name, insert: r.name, symbol: '▦', hint: r.attrs.join(', ') };
    });
  }

  function attributeItems(noun) {
    var seen = {}, list = [];
    DATABASES[level().db].relations.forEach(function (r) {
      r.attrs.forEach(function (a) {
        if (seen[a]) return;
        seen[a] = true;
        list.push({ kind: 'attr', word: a, insert: a, symbol: '·', hint: noun + ' of ' + r.name });
      });
    });
    return list;
  }

  function raCandidates(prefix, input) {
    if (inParameter(input.value, input.selectionStart)) {
      var fns = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'].map(function (fn) {
        return { kind: 'fn', word: fn, insert: fn + '()', caret: fn.length + 1,
                 symbol: 'ƒ', hint: 'aggregate function' };
      });
      return byPrefix(fns.concat(attributeItems('attribute')), prefix);
    }
    return byPrefix(COMPLETIONS.concat(relationItems()), prefix);
  }

  function sqlCandidates(prefix) {
    var clauses = SQL.CLAUSES.map(function (c) {
      return { kind: 'kw', word: c.word, insert: c.insert, symbol: '⌘', hint: c.hint };
    });
    return byPrefix(clauses.concat(relationItems(), attributeItems('column')), prefix);
  }

  /* One line of text: the menu opens under the word, measured with a hidden
     copy of everything before it. */
  function placeInline(surface, wordStart) {
    surface.mirror.textContent = surface.input.value.slice(0, wordStart);
    var left = Math.max(0, surface.mirror.offsetWidth - surface.input.scrollLeft);
    surface.menu.style.left = Math.min(left, surface.input.clientWidth - 120) + 'px';
    surface.mirror.textContent = '';
  }

  /* Several lines of text: the same trick, but the marker has to be measured in
     two dimensions. */
  function placeBlock(surface, wordStart) {
    var mirror = surface.mirror;
    mirror.textContent = surface.input.value.slice(0, wordStart);
    var marker = document.createElement('span');
    marker.textContent = '\u200b';
    mirror.appendChild(marker);
    var x = marker.offsetLeft, y = marker.offsetTop + marker.offsetHeight;
    mirror.textContent = '';
    surface.menu.style.left = Math.max(0, Math.min(x, surface.input.clientWidth - 150)) + 'px';
    surface.menu.style.top = (y - surface.input.scrollTop + 4) + 'px';
  }

  function openSuggest(surface) {
    var word = currentWord(surface.input);
    if (!word.text) return closeSuggest();
    var items = surface.candidates(word.text, surface.input);
    if (!items.length) return closeSuggest();

    suggest.items = items;
    suggest.index = 0;
    suggest.open = true;
    suggest.surface = surface;
    suggest.wordStart = word.start;
    renderSuggest();
    surface.place(surface, word.start);
    surface.menu.hidden = false;
    surface.input.setAttribute('aria-expanded', 'true');
  }

  function closeSuggest() {
    suggest.open = false;
    [el.exprSuggest, el.sqlSuggest].forEach(function (menu) { menu.hidden = true; });
    [el.exprInput, el.sqlInput].forEach(function (input) { input.setAttribute('aria-expanded', 'false'); });
  }

  function renderSuggest() {
    var menu = suggest.surface.menu;
    menu.innerHTML = suggest.items.map(function (c, i) {
      return '<li class="suggest-item' + (i === suggest.index ? ' active' : '') + '" data-i="' + i +
        '" role="option" aria-selected="' + (i === suggest.index) + '">' +
        '<span class="s-sym s-' + c.kind + '">' + esc(c.symbol) + '</span>' +
        '<span class="s-word">' + esc(c.word) + '</span>' +
        '<span class="s-hint">' + esc(c.hint) + '</span></li>';
    }).join('');
    menu.querySelectorAll('.suggest-item').forEach(function (li) {
      // mousedown, not click: a click would blur the input first.
      li.addEventListener('mousedown', function (e) {
        e.preventDefault();
        accept(suggest.items[parseInt(li.dataset.i, 10)]);
      });
    });
  }

  function moveSuggest(delta) {
    suggest.index = (suggest.index + delta + suggest.items.length) % suggest.items.length;
    renderSuggest();
  }

  function accept(item) {
    if (!item || !suggest.surface) return;
    var surface = suggest.surface, input = surface.input;
    var word = currentWord(input);
    var before = input.value.slice(0, word.start);
    var after = input.value.slice(word.caret);
    input.value = before + item.insert + after;
    var pos = word.start + (item.caret != null ? item.caret : item.insert.length);
    input.setSelectionRange(pos, pos);
    closeSuggest();
    surface.changed();
  }

  /* Tab out of a finished parameter and into the operand that follows:
     π_{ename|}()  ->  π_{ename}(|)  ->  π_{ename}(Employee)| */
  function jumpToNextHole() {
    var input = el.exprInput, text = input.value, from = input.selectionStart;
    if (input.selectionStart !== input.selectionEnd) return false;
    var closer = -1;
    for (var i = from; i < text.length; i++) {
      if (text[i] === '}' || text[i] === ']' || text[i] === ')') { closer = i; break; }
    }
    if (closer === -1) return false;            // nothing to skip; let Tab move focus
    var pos = closer + 1;
    if (text[pos] === '(') pos++;               // land inside the operand parens
    input.setSelectionRange(pos, pos);
    closeSuggest();
    return true;
  }

  function setExprError(msg) {
    el.exprError.textContent = msg || '';
    el.exprError.hidden = !msg;
  }

  function setSqlError(msg) {
    el.sqlError.textContent = msg || '';
    el.sqlError.hidden = !msg;
  }

  // Typing edits the same tree the canvas does; whichever one you are not
  // touching follows along.
  var errorTimer = null;
  function onExprInput(options) {
    clearTimeout(errorTimer);
    try {
      state.tree = RA.parseExpression(el.exprInput.value);
      setExprError('');
      renderTree();
      refreshOutput();
    } catch (e) {
      // Half-typed expressions are always invalid; only complain once you stop.
      setExprError('');
      errorTimer = setTimeout(function () { setExprError(e.message); }, 700);
    }
    if (!(options && options.noSuggest)) openSuggest(surfaces.ra);
  }

  var sqlErrorTimer = null;
  function onSqlInput(options) {
    state.sql = el.sqlInput.value;
    refreshOutput();
    if (!(options && options.noSuggest)) openSuggest(surfaces.sql);
  }

  function setSqlText(text) {
    el.sqlInput.value = text;
    state.sql = text;
    try { el.sqlInput.setSelectionRange(text.length, text.length); } catch (e) { /* not focused */ }
    refreshOutput();
  }

  function evaluateSQL() {
    try { return { ok: true, relation: SQL.run(state.sql, currentDB()) }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  function evaluateCurrent() { return state.mode === 'sql' ? evaluateSQL() : evaluateTree(); }

  function refreshOutput() {
    if (state.mode === 'ra') {
      el.formula.innerHTML = RA.toHTML(state.tree);
      if (document.activeElement !== el.exprInput) {
        el.exprInput.value = state.tree ? RA.toText(state.tree) : '';
        setExprError('');
      }
      renderPeek();
    }

    clearTimeout(sqlErrorTimer);
    setSqlError('');
    var res = evaluateCurrent();

    if (res.ok) {
      // Hidden means hidden: the row count alone gives the game away.
      if (!state.resultOpen) {
        muteOutput('Result hidden — work it out, then press <b>Check answer</b>.');
        return;
      }
      el.outputMeta.textContent = res.relation.attrs.length + ' column' +
        (res.relation.attrs.length === 1 ? '' : 's') + ' · ' +
        res.relation.rows.length + ' row' + (res.relation.rows.length === 1 ? '' : 's');
      el.output.className = 'output';
      el.output.innerHTML = tableHTML(res.relation);
    } else if (res.error === 'incomplete') {
      muteOutput(state.mode === 'sql'
        ? 'Write a query to see what it returns.'
        : 'Fill in the empty slots to see a result.');
    } else if (state.mode === 'sql') {
      // Half-written SQL is always broken; only complain once you stop typing.
      muteOutput('This query does not run yet.');
      sqlErrorTimer = setTimeout(function () { setSqlError(res.error); }, 600);
    } else {
      el.outputMeta.textContent = '';
      el.output.className = 'output output-error';
      el.output.innerHTML = '<p class="error-msg">' + esc(res.error) + '</p>';
    }
  }

  function muteOutput(html) {
    el.outputMeta.textContent = '';
    el.output.className = 'output output-muted';
    el.output.innerHTML = '<p class="placeholder">' + html + '</p>';
  }

  /* ---------- the algebra, written out as SQL ---------- */

  var lastPeek = null;
  var KEYWORD_RE = new RegExp('\\b(' + SQL.KEYWORDS.join('|') + ')\\b', 'g');

  function setPeekOpen(open) {
    state.peekOpen = open;
    el.peekToggle.setAttribute('aria-expanded', String(open));
    el.peekToggle.classList.toggle('collapsed', !open);
    el.peek.hidden = !open;
    save();
    renderPeek();
  }

  /* Only ever shows SQL that runs and returns the same table: a translation
     that quietly disagreed with the canvas would teach the wrong lesson. */
  function renderPeek() {
    lastPeek = null;
    el.btnUseSQL.hidden = true;
    if (!state.peekOpen) return;
    el.peek.hidden = false;

    var text = null, note = null;
    try {
      var expected = RA.evaluate(state.tree, currentDB());
      text = SQL.fromTree(state.tree, currentDB());
      if (text && !RA.compare(SQL.run(text, currentDB()), expected, {}).ok) text = null;
      if (!text) note = 'This one has no tidy SQL translation.';
    } catch (e) {
      note = e.message === 'incomplete'
        ? 'Finish the query and the SQL for it appears here.'
        : 'The query has to run before it can be translated.';
    }
    lastPeek = text;
    el.peek.classList.toggle('is-muted', !text);
    el.peek.innerHTML = text ? esc(text).replace(KEYWORD_RE, '<span class="kw">$1</span>') : esc(note);
    el.btnUseSQL.hidden = !text || !has(level(), 'sql');
  }

  /* ---------- feedback ---------- */

  function setFeedback(kind, html) {
    el.feedback.className = 'feedback feedback-' + kind;
    el.feedback.innerHTML = html;
  }

  function clearFeedback() {
    el.feedback.className = 'feedback';
    el.feedback.innerHTML = '';
  }

  /* ---------- checking ---------- */

  function expectedRelation() {
    return state.mode === 'sql'
      ? SQL.run(level().sql.solution, currentDB())
      : RA.evaluate(level().solution, currentDB());
  }

  /* SQL is checked as a list of rows, not a set: duplicates count, and a level
     that asks for an order is checked in that order. */
  function checkOptions() {
    var lv = level();
    if (state.mode !== 'sql') return { checkNames: !!lv.checkNames };
    return { checkNames: !!lv.checkNames, multiset: true, ordered: !!lv.sql.ordered };
  }

  function check() {
    var res = evaluateCurrent();
    if (!res.ok) {
      setFeedback('bad', res.error === 'incomplete'
        ? (state.mode === 'sql' ? 'There is no query to check yet.'
                                : 'Your query still has empty slots — fill them in first.')
        : '<b>That query does not run:</b> ' + esc(res.error));
      return;
    }
    var verdict = RA.compare(res.relation, expectedRelation(), checkOptions());
    if (verdict.ok) {
      var grade = state.usedHelp ? 'silver' : 'gold';
      if (solvedIn(state.mode)[state.levelIndex] !== 'gold') solvedIn(state.mode)[state.levelIndex] = grade;
      save();
      setFeedback('good', (grade === 'gold' ? '★ ' : '✓ ') + '<b>Correct!</b> ' + nextUp());
      celebrate();
      renderPills();
      renderNav();
    } else {
      setFeedback('bad', '<b>Not quite.</b> ' + esc(verdict.message));
    }
  }

  /* After a win: the same question in the other language is the best next
     thing to do, so offer it before pointing at the next level. */
  function nextUp() {
    var other = otherMode();
    if (has(level(), other) && solvedIn(other)[state.levelIndex] !== 'gold') {
      return 'The same question works in ' + modeName(other) + ' too.' +
        '<button class="link-btn" type="button" data-action="switch">Try it ›</button>';
    }
    if (state.levelIndex + 1 < LEVELS.length) {
      return 'Next up — level ' + (state.levelIndex + 2) + ': ' + esc(LEVELS[state.levelIndex + 1].title) + '.';
    }
    return 'That was the last level — you have both languages.';
  }

  function showHint() {
    var hints = view().hints;
    if (state.hintsShown >= hints.length) {
      setFeedback('info', 'No hints left — try <b>Show solution</b> to see the finished query.');
      return;
    }
    state.usedHelp = true;
    var text = hints[state.hintsShown++];
    setFeedback('info', '<b>Hint ' + state.hintsShown + '/' + hints.length + ':</b> ' + text);
    renderNav();
  }

  function showSolution() {
    state.usedHelp = true;
    if (state.mode === 'sql') setSqlText(level().sql.solution);
    else state.tree = clone(level().solution);
    render();
    setFeedback('info', 'This is one correct answer. Press <b>Check answer</b> to record it, ' +
      'then try rebuilding it yourself.');
  }

  /* ---------- level navigation ---------- */

  function goToLevel(i) {
    if (i < 0 || i >= LEVELS.length) return;
    state.levelIndex = i;
    state.tree = null;
    state.sql = '';
    state.hintsShown = 0;
    state.armed = null;
    // A level the current language cannot ask simply switches language.
    var switched = false;
    if (!has(level(), state.mode)) { state.mode = otherMode(); switched = true; }
    state.usedHelp = solvedIn(state.mode)[i] === 'silver';
    save();
    render();
    clearFeedback();
    if (switched) {
      setFeedback('info', 'Level ' + (i + 1) + ' can only be asked in ' + modeName(state.mode) + '.');
    }
  }

  function setMode(mode) {
    if (mode === state.mode || !has(level(), mode)) return;
    state.mode = mode;
    state.hintsShown = 0;
    state.usedHelp = solvedIn(mode)[state.levelIndex] === 'silver';
    state.armed = null;
    closeSuggest();
    save();
    render();
    clearFeedback();
  }

  function renderMode() {
    var lv = level();
    [['ra', el.modeRA], ['sql', el.modeSQL]].forEach(function (pair) {
      pair[1].setAttribute('aria-selected', String(state.mode === pair[0]));
      pair[1].disabled = !has(lv, pair[0]);
    });
    el.raSurface.hidden = state.mode !== 'ra';
    el.sqlSurface.hidden = state.mode !== 'sql';
    if (el.sqlInput.value !== state.sql) el.sqlInput.value = state.sql;

    var note = '';
    if (!has(lv, 'ra')) note = '<b>SQL only.</b> ' + esc(lv.raNote || '');
    else if (!has(lv, 'sql')) note = '<b>Algebra only.</b> ' + esc(lv.sqlNote || '');
    el.modeNote.innerHTML = note;
    el.modeNote.hidden = !note;
  }

  function renderPills() {
    var solved = solvedIn(state.mode);
    el.pills.innerHTML = LEVELS.map(function (lv, i) {
      var cls = 'pill';
      var available = has(lv, state.mode);
      if (!available) cls += ' unavailable';
      if (i === state.levelIndex) cls += ' current';
      if (solved[i]) cls += ' solved ' + solved[i];
      var mark = solved[i] === 'gold' ? '★' : (solved[i] ? '✓' : i + 1);
      var heading = lv.chapter ? '<span class="pill-chapter">' + esc(lv.chapter) + '</span>' : '';
      return heading + '<button class="' + cls + '" data-i="' + i + '" title="' +
        esc((i + 1) + '. ' + lv.title + (available ? '' : ' — not available in ' + modeName(state.mode))) +
        '">' + mark + '</button>';
    }).join('');
    el.pills.querySelectorAll('.pill').forEach(function (p) {
      p.addEventListener('click', function () { goToLevel(parseInt(p.dataset.i, 10)); });
    });

    el.progress.innerHTML = ['ra', 'sql'].map(function (mode) {
      return '<span class="' + (mode === state.mode ? 'now' : '') + '">' +
        countIn(mode) + ' / ' + totalIn(mode) + ' ' + (mode === 'sql' ? 'SQL' : 'algebra') + '</span>';
    }).join('<span class="sep">·</span>');
    el.barNow.textContent = (state.levelIndex + 1) + ' · ' + level().title;
  }

  /* Errors stay visible even when the result is hidden: "there is no attribute
     nope" is about whether the query is valid, not about what the answer is. */
  function setResultOpen(open) {
    state.resultOpen = open;
    el.resultToggle.setAttribute('aria-expanded', String(open));
    el.resultToggle.title = open ? 'Hide the live result' : 'Show the live result';
    el.resultToggle.classList.toggle('collapsed', !open);
    save();
    refreshOutput();
  }

  function setBarOpen(open) {
    state.barOpen = open;
    el.levelbar.classList.toggle('collapsed', !open);
    el.barToggle.setAttribute('aria-expanded', String(open));
    el.barToggle.title = open ? 'Hide the level list' : 'Show the level list';
    save();
  }

  function renderQuestion() {
    var lv = level(), shown = view();
    el.levelLabel.textContent = 'Level ' + (state.levelIndex + 1) + ' of ' + LEVELS.length;
    el.levelTitle.textContent = lv.title;
    el.question.innerHTML = shown.question;
    if (shown.tip) {
      el.tip.innerHTML = shown.tip;
      el.tip.hidden = false;
    } else {
      el.tip.hidden = true;
    }
  }

  function renderNav() {
    el.prev.disabled = state.levelIndex === 0;
    el.next.disabled = state.levelIndex >= LEVELS.length - 1;
    var hints = view().hints;
    el.hint.disabled = false;
    el.hint.textContent = state.hintsShown >= hints.length ? 'No hints left' : 'Hint (' +
      (hints.length - state.hintsShown) + ')';
  }

  function render() {
    renderMode();
    renderQuestion();
    renderPills();
    renderNav();
    renderTables();
    renderTools();
    if (state.mode === 'ra') renderTree();
    updateArmedUI();
    refreshOutput();
  }

  /* ---------- celebration ---------- */

  function celebrate() {
    var canvas = el.confetti;
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    var colors = ['#e79aa8', '#910029', '#d8a657', '#e8e6e2', '#4ea8d8'];
    var bits = [];
    for (var i = 0; i < 90; i++) {
      bits.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 220,
        y: canvas.height * 0.35 + (Math.random() - 0.5) * 60,
        vx: (Math.random() - 0.5) * 9,
        vy: -Math.random() * 9 - 3,
        size: 3 + Math.random() * 5,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: colors[i % colors.length]
      });
    }
    canvas.hidden = false;
    var frames = 0;
    (function step() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      bits.forEach(function (b) {
        b.x += b.vx; b.y += b.vy; b.vy += 0.28; b.rot += b.vr;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.size / 2, -b.size / 2, b.size, b.size * 0.6);
        ctx.restore();
      });
      frames++;
      if (frames < 110) requestAnimationFrame(step);
      else { ctx.clearRect(0, 0, canvas.width, canvas.height); canvas.hidden = true; }
    })();
  }

  /* ---------- boot ---------- */

  function init() {
    ['levelbar', 'barToggle', 'barNow', 'pills', 'progress', 'levelLabel', 'levelTitle', 'question', 'tip', 'dbName', 'dbBlurb',
     'tables', 'opBlock', 'palette', 'clauseBlock', 'clauses',
     'modeRA', 'modeSQL', 'modeNote', 'raSurface', 'sqlSurface',
     'canvas', 'formula', 'exprInput', 'exprError', 'exprSuggest', 'exprMirror',
     'sqlInput', 'sqlError', 'sqlSuggest', 'sqlMirror',
     'peekToggle', 'peek', 'btnUseSQL',
     'output', 'outputMeta', 'resultToggle', 'feedback', 'confetti'
    ].forEach(function (id) { el[id] = document.getElementById(id); });

    el.prev = document.getElementById('btnPrev');
    el.next = document.getElementById('btnNext');
    el.hint = document.getElementById('btnHint');

    surfaces.ra = {
      input: el.exprInput, menu: el.exprSuggest, mirror: el.exprMirror,
      candidates: raCandidates, place: placeInline,
      changed: function () { onExprInput({ noSuggest: true }); }
    };
    surfaces.sql = {
      input: el.sqlInput, menu: el.sqlSuggest, mirror: el.sqlMirror,
      candidates: sqlCandidates, place: placeBlock,
      changed: function () { onSqlInput({ noSuggest: true }); }
    };

    el.modeRA.addEventListener('click', function () { setMode('ra'); });
    el.modeSQL.addEventListener('click', function () { setMode('sql'); });
    el.peekToggle.addEventListener('click', function () { setPeekOpen(!state.peekOpen); });
    el.btnUseSQL.addEventListener('click', function () {
      var text = lastPeek;
      if (!text) return;
      setMode('sql');
      setSqlText(text);
      state.usedHelp = true;          // translating your own answer is still a leg-up
      setFeedback('info', 'Your algebra, written out as SQL. Read it, then press <b>Check answer</b>.');
    });
    el.feedback.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
      if (btn && btn.dataset.action === 'switch') setMode(otherMode());
    });

    el.sqlInput.addEventListener('input', function () { onSqlInput(); });
    el.sqlInput.addEventListener('blur', function () {
      closeSuggest();
      clearTimeout(sqlErrorTimer);
      var res = evaluateSQL();
      setSqlError(res.ok || res.error === 'incomplete' ? '' : res.error);
    });
    el.sqlInput.addEventListener('keydown', function (e) {
      if (suggest.open) {
        if (e.key === 'Tab' || e.key === 'Enter') {
          e.preventDefault();
          accept(suggest.items[suggest.index]);
          return;
        }
        if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggest(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggest(-1); return; }
        if (e.key === 'Escape') { e.preventDefault(); closeSuggest(); return; }
      }
      // A query is several lines, so Enter belongs to the text: ⌘/Ctrl checks.
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); check(); }
    });

    el.barToggle.addEventListener('click', function () { setBarOpen(!state.barOpen); });
    el.resultToggle.addEventListener('click', function () { setResultOpen(!state.resultOpen); });
    el.exprInput.addEventListener('input', function () { onExprInput(); });
    el.exprInput.addEventListener('blur', function () {
      closeSuggest();
      clearTimeout(errorTimer);
      setExprError('');
      refreshOutput();
    });
    el.exprInput.addEventListener('keydown', function (e) {
      // Typing a closer that is already there just steps over it.
      if (e.key === ')' || e.key === '}' || e.key === ']') {
        var at = el.exprInput.selectionStart;
        if (el.exprInput.selectionEnd === at && el.exprInput.value[at] === e.key) {
          e.preventDefault();
          el.exprInput.setSelectionRange(at + 1, at + 1);
          return;
        }
      }
      if (suggest.open) {
        if (e.key === 'Tab' || e.key === 'Enter') {
          e.preventDefault();
          accept(suggest.items[suggest.index]);
          return;
        }
        if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggest(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggest(-1); return; }
        if (e.key === 'Escape') { e.preventDefault(); closeSuggest(); return; }
      }
      // With no menu open, Tab steps to the next hole in the expression.
      if (e.key === 'Tab' && !e.shiftKey && jumpToNextHole()) { e.preventDefault(); return; }
      if (e.key === 'Enter') { e.preventDefault(); check(); }
    });
    document.getElementById('btnCheck').addEventListener('click', check);
    document.getElementById('btnClear').addEventListener('click', function () {
      state.tree = null;
      state.sql = '';
      state.armed = null;
      setSqlError('');
      render();
      clearFeedback();
    });
    el.hint.addEventListener('click', showHint);
    document.getElementById('btnSolution').addEventListener('click', showSolution);
    el.prev.addEventListener('click', function () { goToLevel(state.levelIndex - 1); });
    el.next.addEventListener('click', function () { goToLevel(state.levelIndex + 1); });
    document.getElementById('btnReset').addEventListener('click', function () {
      if (!confirm('Reset all progress and start from level 1?')) return;
      state.solved = { ra: {}, sql: {} };
      state.levelIndex = 0;
      state.usedHelp = false;
      state.hintsShown = 0;
      state.tree = null;
      state.sql = '';
      if (!has(level(), state.mode)) state.mode = otherMode();
      save();
      render();
      clearFeedback();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.armed) { state.armed = null; updateArmedUI(); clearFeedback(); }
    });
    document.body.addEventListener('dragend', endDrag);

    load();
    if (!has(level(), state.mode)) state.mode = otherMode();
    state.usedHelp = solvedIn(state.mode)[state.levelIndex] === 'silver';
    setBarOpen(state.barOpen);
    setResultOpen(state.resultOpen);
    setPeekOpen(state.peekOpen);
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
