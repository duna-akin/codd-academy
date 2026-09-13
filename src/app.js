/* Game UI: drag-and-drop expression tree, live evaluation, answer checking. */
(function () {
  'use strict';

  var RA = window.RA, GAME = window.GAME;
  var LEVELS = GAME.LEVELS, DATABASES = GAME.DATABASES, OPS = RA.OPS;
  var STORE_KEY = 'relational-algebra-game-v1';
  var MAX_PREVIEW_ROWS = 40;

  var state = {
    levelIndex: 0,
    tree: null,
    hintsShown: 0,
    usedHelp: false,
    solved: {},          // levelIndex -> 'gold' | 'silver'
    armed: null,         // {kind:'op'|'rel', value:string} for click-to-place
    barOpen: true        // is the level bar expanded?
  };

  var el = {};

  /* ---------- persistence ---------- */

  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (saved && saved.solved) state.solved = saved.solved;
      if (typeof saved.levelIndex === 'number') {
        state.levelIndex = Math.min(Math.max(saved.levelIndex, 0), LEVELS.length - 1);
      }
      if (typeof saved.barOpen === 'boolean') state.barOpen = saved.barOpen;
    } catch (e) { /* fresh start */ }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        solved: state.solved, levelIndex: state.levelIndex, barOpen: state.barOpen
      }));
    } catch (e) { /* private mode: progress simply will not persist */ }
  }

  /* ---------- helpers ---------- */

  function level() { return LEVELS[state.levelIndex]; }

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
      type: 'op', op: node.op, param: node.param || '',
      children: (node.children || []).map(clone)
    };
  }

  function newOpNode(opName) {
    var arity = OPS[opName].arity;
    return { type: 'op', op: opName, param: '', children: new Array(arity).fill(null) };
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
    el.dbName.textContent = info.label;
    el.dbBlurb.textContent = info.blurb;
    el.tables.innerHTML = info.relations.map(function (r) {
      return '<div class="table-card">' +
        '<div class="table-head" draggable="true" data-rel="' + esc(r.name) + '" ' +
             'title="Drag me into the query canvas">' +
          '<span class="grip">⠿</span><span class="rel-name">' + esc(r.name) + '</span>' +
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
        arm({ kind: 'rel', value: head.dataset.rel }, head);
      });
    });
  }

  /* ---------- rendering: palette ---------- */

  function renderPalette() {
    var focus = level().focus || [];
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
      head.innerHTML = '<span class="node-sym" title="' + esc(meta.name) + '">' + meta.symbol + '</span>';
      if (meta.param !== 'none') {
        var input = document.createElement('input');
        input.className = 'param-input';
        input.type = 'text';
        input.value = node.param || '';
        input.placeholder = meta.placeholder || meta.paramLabel;
        input.dataset.path = JSON.stringify(path);
        input.setAttribute('aria-label', meta.name + ' ' + meta.paramLabel);
        input.addEventListener('input', function () {
          node.param = input.value;
          refreshOutput();
        });
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); check(); }
        });
        // Typing must not be hijacked by the node's own drag handlers.
        input.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        head.appendChild(input);
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

  function setExprError(msg) {
    el.exprError.textContent = msg || '';
    el.exprError.hidden = !msg;
  }

  // Typing edits the same tree the canvas does; whichever one you are not
  // touching follows along.
  function onExprInput() {
    try {
      state.tree = RA.parseExpression(el.exprInput.value);
      setExprError('');
      renderTree();
      refreshOutput();
    } catch (e) {
      setExprError(e.message);
    }
  }

  function refreshOutput() {
    el.formula.innerHTML = RA.toHTML(state.tree);
    if (document.activeElement !== el.exprInput) {
      el.exprInput.value = state.tree ? RA.toText(state.tree) : '';
      setExprError('');
    }
    var res = evaluateTree();
    if (res.ok) {
      el.outputMeta.textContent = res.relation.attrs.length + ' column' +
        (res.relation.attrs.length === 1 ? '' : 's') + ' · ' +
        res.relation.rows.length + ' row' + (res.relation.rows.length === 1 ? '' : 's');
      el.output.className = 'output';
      el.output.innerHTML = tableHTML(res.relation);
    } else if (res.error === 'incomplete') {
      el.outputMeta.textContent = '';
      el.output.className = 'output output-muted';
      el.output.innerHTML = '<p class="placeholder">Fill in the empty slots to see a result.</p>';
    } else {
      el.outputMeta.textContent = '';
      el.output.className = 'output output-error';
      el.output.innerHTML = '<p class="error-msg">' + esc(res.error) + '</p>';
    }
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
    return RA.evaluate(level().solution, currentDB());
  }

  function check() {
    var res = evaluateTree();
    if (!res.ok) {
      setFeedback('bad', res.error === 'incomplete'
        ? 'Your query still has empty slots — fill them in first.'
        : '<b>That query does not run:</b> ' + esc(res.error));
      return;
    }
    var verdict = RA.compare(res.relation, expectedRelation(), { checkNames: !!level().checkNames });
    if (verdict.ok) {
      var grade = state.usedHelp ? 'silver' : 'gold';
      if (state.solved[state.levelIndex] !== 'gold') state.solved[state.levelIndex] = grade;
      save();
      setFeedback('good', (grade === 'gold' ? '★ ' : '✓ ') + '<b>Correct!</b> ' +
        (state.levelIndex + 1 < LEVELS.length
          ? 'Next up — level ' + (state.levelIndex + 2) + ': ' + esc(LEVELS[state.levelIndex + 1].title) + '.'
          : 'That was the last level — you have the whole algebra.'));
      celebrate();
      renderPills();
      renderNav();
    } else {
      setFeedback('bad', '<b>Not quite.</b> ' + esc(verdict.message));
    }
  }

  function showHint() {
    var hints = level().hints || [];
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
    state.tree = clone(level().solution);
    render();
    setFeedback('info', 'This is one correct answer. Press <b>Check answer</b> to record it, ' +
      'then try rebuilding it yourself.');
  }

  /* ---------- level navigation ---------- */

  function goToLevel(i) {
    if (i < 0 || i >= LEVELS.length) return;
    state.levelIndex = i;
    state.tree = null;
    state.hintsShown = 0;
    state.usedHelp = !!state.solved[i] && state.solved[i] === 'silver';
    state.armed = null;
    save();
    render();
    clearFeedback();
  }

  function renderPills() {
    el.pills.innerHTML = LEVELS.map(function (lv, i) {
      var cls = 'pill';
      if (i === state.levelIndex) cls += ' current';
      if (state.solved[i]) cls += ' solved ' + state.solved[i];
      var mark = state.solved[i] === 'gold' ? '★' : (state.solved[i] ? '✓' : i + 1);
      var heading = lv.chapter ? '<span class="pill-chapter">' + esc(lv.chapter) + '</span>' : '';
      return heading + '<button class="' + cls + '" data-i="' + i + '" title="' +
        esc((i + 1) + '. ' + lv.title) + '">' + mark + '</button>';
    }).join('');
    el.pills.querySelectorAll('.pill').forEach(function (p) {
      p.addEventListener('click', function () { goToLevel(parseInt(p.dataset.i, 10)); });
    });

    var solvedCount = Object.keys(state.solved).length;
    el.progress.textContent = solvedCount + ' / ' + LEVELS.length + ' solved';
    el.barNow.textContent = (state.levelIndex + 1) + ' · ' + level().title;
  }

  function setBarOpen(open) {
    state.barOpen = open;
    el.levelbar.classList.toggle('collapsed', !open);
    el.barToggle.setAttribute('aria-expanded', String(open));
    el.barToggle.title = open ? 'Hide the level list' : 'Show the level list';
    save();
  }

  function renderQuestion() {
    var lv = level();
    el.levelLabel.textContent = 'Level ' + (state.levelIndex + 1) + ' of ' + LEVELS.length;
    el.levelTitle.textContent = lv.title;
    el.question.innerHTML = lv.question;
    if (lv.tip) {
      el.tip.innerHTML = lv.tip;
      el.tip.hidden = false;
    } else {
      el.tip.hidden = true;
    }
  }

  function renderNav() {
    el.prev.disabled = state.levelIndex === 0;
    el.next.disabled = state.levelIndex >= LEVELS.length - 1;
    var hints = level().hints || [];
    el.hint.disabled = false;
    el.hint.textContent = state.hintsShown >= hints.length ? 'No hints left' : 'Hint (' +
      (hints.length - state.hintsShown) + ')';
  }

  function render() {
    renderQuestion();
    renderPills();
    renderNav();
    renderTables();
    renderPalette();
    renderTree();
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
     'tables', 'palette', 'canvas', 'formula', 'exprInput', 'exprError',
     'output', 'outputMeta', 'feedback', 'confetti'
    ].forEach(function (id) { el[id] = document.getElementById(id); });

    el.prev = document.getElementById('btnPrev');
    el.next = document.getElementById('btnNext');
    el.hint = document.getElementById('btnHint');

    el.barToggle.addEventListener('click', function () { setBarOpen(!state.barOpen); });
    el.exprInput.addEventListener('input', onExprInput);
    el.exprInput.addEventListener('blur', function () { setExprError(''); refreshOutput(); });
    el.exprInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); check(); }
    });
    document.getElementById('btnCheck').addEventListener('click', check);
    document.getElementById('btnClear').addEventListener('click', function () {
      state.tree = null;
      state.armed = null;
      render();
      clearFeedback();
    });
    el.hint.addEventListener('click', showHint);
    document.getElementById('btnSolution').addEventListener('click', showSolution);
    el.prev.addEventListener('click', function () { goToLevel(state.levelIndex - 1); });
    el.next.addEventListener('click', function () { goToLevel(state.levelIndex + 1); });
    document.getElementById('btnReset').addEventListener('click', function () {
      if (!confirm('Reset all progress and start from level 1?')) return;
      state.solved = {};
      state.levelIndex = 0;
      state.usedHelp = false;
      state.hintsShown = 0;
      state.tree = null;
      save();
      render();
      clearFeedback();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.armed) { state.armed = null; updateArmedUI(); clearFeedback(); }
    });
    document.body.addEventListener('dragend', endDrag);

    load();
    state.usedHelp = state.solved[state.levelIndex] === 'silver';
    setBarOpen(state.barOpen);
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
