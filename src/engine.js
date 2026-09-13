/* Relational Algebra engine: set-semantics relations + the classic operators. */
(function (global) {
  'use strict';

  function RAError(message) {
    var e = new Error(message);
    e.name = 'RAError';
    e.isRAError = true;
    return e;
  }

  /* ---------- relations ---------- */

  function rowKey(row, attrs) {
    return JSON.stringify(attrs.map(function (a) { return [typeof row[a], row[a]]; }));
  }

  function dedupe(attrs, rows) {
    var seen = Object.create(null), out = [];
    rows.forEach(function (r) {
      var k = rowKey(r, attrs);
      if (!(k in seen)) { seen[k] = true; out.push(r); }
    });
    return out;
  }

  // rows may be given as arrays (positional) or objects (keyed by attribute).
  function relation(name, attrs, rows) {
    var normalized = (rows || []).map(function (r) {
      if (Array.isArray(r)) {
        if (r.length !== attrs.length) {
          throw RAError('Row ' + JSON.stringify(r) + ' does not match schema of ' + name);
        }
        var o = {};
        attrs.forEach(function (a, i) { o[a] = r[i]; });
        return o;
      }
      var copy = {};
      attrs.forEach(function (a) { copy[a] = r[a]; });
      return copy;
    });
    return { name: name, attrs: attrs.slice(), rows: dedupe(attrs, normalized) };
  }

  function sameAttrSet(a, b) {
    if (a.length !== b.length) return false;
    var sa = a.slice().sort(), sb = b.slice().sort();
    return sa.every(function (x, i) { return x === sb[i]; });
  }

  /* Resolve a user-written attribute name against a schema.
     "name" matches "name" or a uniquely-qualified "E1.name". */
  function resolveAttr(attrs, ident) {
    if (attrs.indexOf(ident) !== -1) return ident;
    var suffix = '.' + ident;
    var hits = attrs.filter(function (a) { return a.slice(-suffix.length) === suffix; });
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      throw RAError('"' + ident + '" is ambiguous — it could mean ' + hits.join(' or ') + '.');
    }
    var lower = attrs.filter(function (a) {
      return a.toLowerCase() === ident.toLowerCase() ||
             a.toLowerCase().slice(-suffix.length) === suffix.toLowerCase();
    });
    if (lower.length === 1) return lower[0];
    throw RAError('There is no attribute "' + ident + '". Available: ' + attrs.join(', ') + '.');
  }

  /* ---------- condition language ---------- */

  var CMP = ['>=', '<=', '<>', '!=', '==', '=', '>', '<'];

  function tokenize(src) {
    var tokens = [], i = 0;
    while (i < src.length) {
      var c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '(' || c === ')') { tokens.push({ t: c }); i++; continue; }
      if (c === "'" || c === '"') {
        var quote = c, val = '';
        i++;
        while (i < src.length && src[i] !== quote) { val += src[i++]; }
        if (i >= src.length) throw RAError('Unclosed quote in condition — did you forget a closing ' + quote + ' ?');
        i++;
        tokens.push({ t: 'lit', v: val });
        continue;
      }
      if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] || '') && lastIsOperand(tokens) === false)) {
        var num = '';
        if (c === '-') { num = '-'; i++; }
        while (i < src.length && /[0-9.]/.test(src[i])) { num += src[i++]; }
        tokens.push({ t: 'lit', v: parseFloat(num) });
        continue;
      }
      var cmp = matchCmp(src, i);
      if (cmp) { tokens.push({ t: 'cmp', v: cmp === '==' ? '=' : cmp }); i += cmp.length; continue; }
      if (c === '∧' || c === '&') { tokens.push({ t: 'and' }); i += (src[i + 1] === '&' ? 2 : 1); continue; }
      if (c === '∨' || c === '|') { tokens.push({ t: 'or' }); i += (src[i + 1] === '|' ? 2 : 1); continue; }
      if (c === '¬' || c === '!') { tokens.push({ t: 'not' }); i++; continue; }
      if (/[A-Za-z_]/.test(c)) {
        var id = '';
        while (i < src.length && /[A-Za-z0-9_.]/.test(src[i])) { id += src[i++]; }
        var up = id.toUpperCase();
        if (up === 'AND') tokens.push({ t: 'and' });
        else if (up === 'OR') tokens.push({ t: 'or' });
        else if (up === 'NOT') tokens.push({ t: 'not' });
        else if (up === 'TRUE' || up === 'FALSE') tokens.push({ t: 'lit', v: up === 'TRUE' });
        else tokens.push({ t: 'id', v: id });
        continue;
      }
      throw RAError('I do not understand "' + c + '" in the condition.');
    }
    return tokens;
  }

  function lastIsOperand(tokens) {
    var last = tokens[tokens.length - 1];
    return !!last && (last.t === 'id' || last.t === 'lit' || last.t === ')');
  }

  function matchCmp(src, i) {
    for (var k = 0; k < CMP.length; k++) {
      if (src.substr(i, CMP[k].length) === CMP[k]) return CMP[k];
    }
    return null;
  }

  function parseCondition(src) {
    var tokens = tokenize(src), pos = 0;

    function peek() { return tokens[pos]; }
    function eat(t) {
      if (!peek() || peek().t !== t) throw RAError('Condition is incomplete near position ' + pos + '.');
      return tokens[pos++];
    }

    function parseOr() {
      var node = parseAnd();
      while (peek() && peek().t === 'or') { pos++; node = { k: 'or', l: node, r: parseAnd() }; }
      return node;
    }
    function parseAnd() {
      var node = parseNot();
      while (peek() && peek().t === 'and') { pos++; node = { k: 'and', l: node, r: parseNot() }; }
      return node;
    }
    function parseNot() {
      if (peek() && peek().t === 'not') { pos++; return { k: 'not', l: parseNot() }; }
      return parsePrimary();
    }
    function parsePrimary() {
      if (peek() && peek().t === '(') {
        pos++;
        var inner = parseOr();
        eat(')');
        return inner;
      }
      var left = parseOperand();
      if (!peek() || peek().t !== 'cmp') {
        throw RAError('Expected a comparison such as =, <, > after "' + describe(left) + '".');
      }
      var op = tokens[pos++].v;
      var right = parseOperand();
      return { k: 'cmp', op: op, l: left, r: right };
    }
    function parseOperand() {
      var tk = peek();
      if (!tk) throw RAError('The condition ends unexpectedly.');
      if (tk.t === 'id') { pos++; return { k: 'attr', name: tk.v }; }
      if (tk.t === 'lit') { pos++; return { k: 'lit', value: tk.v }; }
      throw RAError('Expected an attribute or a value in the condition.');
    }
    function describe(n) { return n.k === 'attr' ? n.name : String(n.value); }

    if (!tokens.length) throw RAError('The condition is empty.');
    var tree = parseOr();
    if (pos < tokens.length) throw RAError('Unexpected extra text at the end of the condition.');
    return tree;
  }

  function coerce(a, b) {
    if (typeof a === 'number' && typeof b === 'string' && b.trim() !== '' && !isNaN(Number(b))) return [a, Number(b)];
    if (typeof b === 'number' && typeof a === 'string' && a.trim() !== '' && !isNaN(Number(a))) return [Number(a), b];
    return [a, b];
  }

  function evalCondition(node, row, attrs) {
    switch (node.k) {
      case 'and': return evalCondition(node.l, row, attrs) && evalCondition(node.r, row, attrs);
      case 'or': return evalCondition(node.l, row, attrs) || evalCondition(node.r, row, attrs);
      case 'not': return !evalCondition(node.l, row, attrs);
      case 'cmp': {
        var pair = coerce(operandValue(node.l, row, attrs), operandValue(node.r, row, attrs));
        var a = pair[0], b = pair[1];
        switch (node.op) {
          case '=': return a === b;
          case '<>': case '!=': return a !== b;
          case '<': return a < b;
          case '<=': return a <= b;
          case '>': return a > b;
          case '>=': return a >= b;
        }
        throw RAError('Unknown comparison "' + node.op + '".');
      }
      case 'lit': return !!node.value;
      default: throw RAError('Malformed condition.');
    }
  }

  function operandValue(node, row, attrs) {
    if (node.k === 'lit') return node.value;
    try {
      return row[resolveAttr(attrs, node.name)];
    } catch (e) {
      if (e.isRAError && /no attribute/.test(e.message)) {
        throw RAError(e.message + ' If you meant the text value, quote it: \'' + node.name + '\'.');
      }
      throw e;
    }
  }

  /* ---------- operators ---------- */

  function splitList(text) {
    return String(text || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function project(r, param) {
    var wanted = splitList(param);
    if (!wanted.length) throw RAError('π needs a list of attributes, e.g. ' + r.attrs.slice(0, 2).join(', ') + '.');
    var attrs = wanted.map(function (w) { return resolveAttr(r.attrs, w); });
    attrs.forEach(function (a, i) {
      if (attrs.indexOf(a) !== i) throw RAError('π lists "' + a + '" twice.');
    });
    return relation('π(' + r.name + ')', attrs, r.rows.map(function (row) {
      var o = {};
      attrs.forEach(function (a) { o[a] = row[a]; });
      return o;
    }));
  }

  function select(r, param) {
    if (!String(param || '').trim()) throw RAError('σ needs a condition, e.g. salary > 60000.');
    var cond = parseCondition(param);
    return relation('σ(' + r.name + ')', r.attrs, r.rows.filter(function (row) {
      return evalCondition(cond, row, r.attrs);
    }));
  }

  function rename(r, param) {
    var spec = String(param || '').trim();
    if (!spec) throw RAError('ρ needs a new name, e.g. E  or  E(a, b, c).');
    var m = /^([A-Za-z_][A-Za-z0-9_]*)?\s*(?:\(([^)]*)\))?$/.exec(spec);
    if (!m || (!m[1] && !m[2])) throw RAError('ρ expects  NewName  or  NewName(a, b, c)  or  (a, b, c).');
    var newName = m[1] || r.name;
    var attrs = r.attrs.slice();

    if (m[2] !== undefined) {
      var list = splitList(m[2]);
      if (list.length !== r.attrs.length) {
        throw RAError('ρ renames ' + list.length + ' attribute(s) but the relation has ' + r.attrs.length + '.');
      }
      attrs = list;
    } else if (m[1]) {
      // Re-qualify attributes that were tagged with the old relation name.
      attrs = attrs.map(function (a) {
        return a.indexOf(r.name + '.') === 0 ? newName + '.' + a.slice(r.name.length + 1) : a;
      });
    }
    var rows = r.rows.map(function (row) {
      var o = {};
      r.attrs.forEach(function (a, i) { o[attrs[i]] = row[a]; });
      return o;
    });
    return relation(newName, attrs, rows);
  }

  function setOp(kind, r, s) {
    if (r.attrs.length !== s.attrs.length) {
      throw RAError(symbolOf(kind) + ' needs both sides to have the same number of attributes (' +
        r.attrs.length + ' vs ' + s.attrs.length + ').');
    }
    var byName = sameAttrSet(r.attrs, s.attrs);
    var mapped = s.rows.map(function (row) {
      var o = {};
      r.attrs.forEach(function (a, i) { o[a] = byName ? row[a] : row[s.attrs[i]]; });
      return o;
    });
    var inR = {}, inS = {};
    r.rows.forEach(function (row) { inR[rowKey(row, r.attrs)] = true; });
    mapped.forEach(function (row) { inS[rowKey(row, r.attrs)] = true; });

    var rows;
    if (kind === 'union') rows = r.rows.concat(mapped);
    else if (kind === 'intersect') rows = r.rows.filter(function (row) { return inS[rowKey(row, r.attrs)]; });
    else rows = r.rows.filter(function (row) { return !inS[rowKey(row, r.attrs)]; });

    return relation('(' + r.name + ' ' + symbolOf(kind) + ' ' + s.name + ')', r.attrs, rows);
  }

  function qualify(r, other) {
    var clash = r.attrs.filter(function (a) { return other.attrs.indexOf(a) !== -1; });
    if (!clash.length) return r;
    var attrs = r.attrs.map(function (a) { return clash.indexOf(a) !== -1 ? r.name + '.' + a : a; });
    var rows = r.rows.map(function (row) {
      var o = {};
      r.attrs.forEach(function (a, i) { o[attrs[i]] = row[a]; });
      return o;
    });
    return { name: r.name, attrs: attrs, rows: rows };
  }

  function product(r, s) {
    if (r.name === s.name) {
      throw RAError('Both sides of × are called "' + r.name + '". Rename one with ρ first.');
    }
    var lr = qualify(r, s), rs = qualify(s, r);
    var attrs = lr.attrs.concat(rs.attrs);
    var dup = attrs.filter(function (a, i) { return attrs.indexOf(a) !== i; });
    if (dup.length) throw RAError('× would produce two columns named "' + dup[0] + '". Use ρ to rename.');
    var rows = [];
    lr.rows.forEach(function (a) {
      rs.rows.forEach(function (b) {
        var o = {};
        lr.attrs.forEach(function (k) { o[k] = a[k]; });
        rs.attrs.forEach(function (k) { o[k] = b[k]; });
        rows.push(o);
      });
    });
    return relation('(' + r.name + ' × ' + s.name + ')', attrs, rows);
  }

  function naturalJoin(r, s) {
    var common = r.attrs.filter(function (a) { return s.attrs.indexOf(a) !== -1; });
    if (!common.length) return product(r, s);
    var extra = s.attrs.filter(function (a) { return common.indexOf(a) === -1; });
    var attrs = r.attrs.concat(extra);
    var rows = [];
    r.rows.forEach(function (a) {
      s.rows.forEach(function (b) {
        var match = common.every(function (c) {
          var pair = coerce(a[c], b[c]);
          return pair[0] === pair[1];
        });
        if (!match) return;
        var o = {};
        r.attrs.forEach(function (k) { o[k] = a[k]; });
        extra.forEach(function (k) { o[k] = b[k]; });
        rows.push(o);
      });
    });
    return relation('(' + r.name + ' ⋈ ' + s.name + ')', attrs, rows);
  }

  function join(r, s, param) {
    if (!String(param || '').trim()) return naturalJoin(r, s);
    return select(product(r, s), param);
  }

  var AGGREGATES = {
    COUNT: 1, SUM: 1, AVG: 1, AVERAGE: 1, MIN: 1, MAX: 1
  };

  function splitTop(text) {
    var out = [], depth = 0, current = '';
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === ',' && depth === 0) { out.push(current); current = ''; continue; }
      current += c;
    }
    out.push(current);
    return out.map(function (t) { return t.trim(); }).filter(Boolean);
  }

  function numeric(v, fn, attr) {
    var n = typeof v === 'number' ? v : Number(v);
    if (typeof v !== 'number' && (v === '' || isNaN(n))) {
      throw RAError(fn + ' needs numbers, but ' + attr + ' holds "' + v + '".');
    }
    return n;
  }

  /* Elmasri-style aggregation: <grouping attributes> ℱ <function list> (R) */
  function aggregate(r, funcSpec, groupSpec) {
    var specs = splitTop(funcSpec).map(function (item) {
      var m = /^([A-Za-z]+)\s*\(\s*(\*|[A-Za-z_][A-Za-z0-9_.]*)\s*\)$/.exec(item);
      if (!m) {
        throw RAError('"' + item + '" is not a function call. Write them like COUNT(eid) or AVG(salary).');
      }
      var fn = m[1].toUpperCase(), arg = m[2];
      if (!AGGREGATES[fn]) {
        throw RAError('There is no aggregate function "' + m[1] + '". Available: ' +
          Object.keys(AGGREGATES).join(', ') + '.');
      }
      if (fn === 'AVERAGE') fn = 'AVG';
      if (arg === '*' && fn !== 'COUNT') throw RAError(fn + '(*) is not allowed — name an attribute.');
      var attr = arg === '*' ? null : resolveAttr(r.attrs, arg);
      return { fn: fn, attr: attr, out: arg === '*' ? 'COUNT' : fn + '_' + arg };
    });
    if (!specs.length) throw RAError('ℱ needs at least one function, e.g. COUNT(eid).');

    var grouping = splitList(groupSpec).map(function (g) { return resolveAttr(r.attrs, g); });
    var attrs = grouping.concat(specs.map(function (s2) { return s2.out; }));
    var dup = attrs.filter(function (a, idx) { return attrs.indexOf(a) !== idx; });
    if (dup.length) throw RAError('ℱ would produce two columns named "' + dup[0] + '".');

    var order = [], groups = Object.create(null);
    r.rows.forEach(function (row) {
      var key = JSON.stringify(grouping.map(function (g) { return row[g]; }));
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(row);
    });

    var rows = order.map(function (key) {
      var members = groups[key], out = {};
      grouping.forEach(function (g) { out[g] = members[0][g]; });
      specs.forEach(function (spec) {
        var values = spec.attr === null ? [] : members.map(function (row) { return row[spec.attr]; });
        switch (spec.fn) {
          case 'COUNT': out[spec.out] = members.length; break;
          case 'SUM': case 'AVG': {
            var total = values.reduce(function (acc, v) { return acc + numeric(v, spec.fn, spec.attr); }, 0);
            out[spec.out] = spec.fn === 'SUM' ? total : total / members.length;
            break;
          }
          case 'MIN': case 'MAX': {
            out[spec.out] = values.reduce(function (best, v) {
              if (best === undefined) return v;
              var pair = coerce(best, v);
              var takeV = spec.fn === 'MIN' ? pair[1] < pair[0] : pair[1] > pair[0];
              return takeV ? v : best;
            }, undefined);
            break;
          }
        }
      });
      return out;
    });
    return relation('ℱ(' + r.name + ')', attrs, rows);
  }

  function divide(r, s) {
    var missing = s.attrs.filter(function (a) { return r.attrs.indexOf(a) === -1; });
    if (missing.length) {
      throw RAError('÷ needs the right side’s attributes to appear on the left. Missing: ' + missing.join(', ') + '.');
    }
    var quotient = r.attrs.filter(function (a) { return s.attrs.indexOf(a) === -1; });
    if (!quotient.length) throw RAError('÷ leaves no attributes on the left side.');
    var present = Object.create(null);
    r.rows.forEach(function (row) { present[rowKey(row, r.attrs)] = true; });

    var candidates = dedupe(quotient, r.rows.map(function (row) {
      var o = {};
      quotient.forEach(function (a) { o[a] = row[a]; });
      return o;
    }));
    var rows = candidates.filter(function (cand) {
      return s.rows.every(function (sRow) {
        var probe = {};
        quotient.forEach(function (a) { probe[a] = cand[a]; });
        s.attrs.forEach(function (a) { probe[a] = sRow[a]; });
        return present[rowKey(probe, r.attrs)];
      });
    });
    return relation('(' + r.name + ' ÷ ' + s.name + ')', quotient, rows);
  }

  /* ---------- operator metadata ---------- */

  var OPS = {
    project:    { symbol: 'π', name: 'Project',    arity: 1, param: 'required', paramLabel: 'attributes',
                  hint: 'Keep only these columns (duplicates disappear).', placeholder: 'ename, salary' },
    select:     { symbol: 'σ', name: 'Select',     arity: 1, param: 'required', paramLabel: 'condition',
                  hint: 'Keep only rows matching the condition.', placeholder: "salary > 60000 AND dept = 'Sales'" },
    rename:     { symbol: 'ρ', name: 'Rename',     arity: 1, param: 'required', paramLabel: 'new name',
                  hint: 'Rename the relation, and optionally its attributes.', placeholder: 'E1  or  E1(a, b)' },
    union:      { symbol: '∪', name: 'Union',      arity: 2, param: 'none',
                  hint: 'Rows in either relation.' },
    intersect:  { symbol: '∩', name: 'Intersect',  arity: 2, param: 'none',
                  hint: 'Rows in both relations.' },
    difference: { symbol: '−', name: 'Difference', arity: 2, param: 'none',
                  hint: 'Rows in the left relation but not the right.' },
    product:    { symbol: '×', name: 'Product',    arity: 2, param: 'none',
                  hint: 'Every pairing of left and right rows.' },
    join:       { symbol: '⋈', name: 'Join',       arity: 2, param: 'optional', paramLabel: 'condition',
                  hint: 'Natural join on shared attributes; add a condition for a theta join.',
                  placeholder: 'optional — empty = natural' },
    divide:     { symbol: '÷', name: 'Divide',     arity: 2, param: 'none',
                  hint: 'Left rows matching every row of the right relation.' },
    group:      { symbol: 'ℱ', name: 'Aggregate',  arity: 1, param: 'required', paramLabel: 'functions',
                  pre: true, preLabel: 'grouping attributes',
                  hint: 'One row per group: COUNT, SUM, AVG, MIN, MAX.',
                  placeholder: 'COUNT(eid), AVG(salary)', prePlaceholder: 'group by… (optional)' }
  };

  function symbolOf(op) { return OPS[op] ? OPS[op].symbol : op; }

  /* ---------- expression trees ---------- */

  function evaluate(node, db) {
    if (!node) throw RAError('incomplete');
    if (node.type === 'rel') {
      var r = db[node.name];
      if (!r) throw RAError('There is no relation called "' + node.name + '".');
      return relation(r.name, r.attrs, r.rows);
    }
    var meta = OPS[node.op];
    if (!meta) throw RAError('Unknown operator "' + node.op + '".');
    var kids = (node.children || []).slice(0, meta.arity).map(function (c) { return evaluate(c, db); });
    if (kids.length < meta.arity) throw RAError('incomplete');

    switch (node.op) {
      case 'project': return project(kids[0], node.param);
      case 'select': return select(kids[0], node.param);
      case 'rename': return rename(kids[0], node.param);
      case 'union': return setOp('union', kids[0], kids[1]);
      case 'intersect': return setOp('intersect', kids[0], kids[1]);
      case 'difference': return setOp('difference', kids[0], kids[1]);
      case 'product': return product(kids[0], kids[1]);
      case 'join': return join(kids[0], kids[1], node.param);
      case 'divide': return divide(kids[0], kids[1]);
      case 'group': return aggregate(kids[0], node.param, node.group);
    }
    throw RAError('Unknown operator "' + node.op + '".');
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Renders an expression tree as HTML (with <sub> for operator parameters).
  function toHTML(node) {
    if (!node) return '<span class="f-slot">?</span>';
    if (node.type === 'rel') return '<span class="f-rel">' + esc(node.name) + '</span>';
    var meta = OPS[node.op], kids = node.children || [];
    var sym = '<span class="f-op">' + meta.symbol + '</span>';
    if (meta.arity === 1) {
      var sub = String(node.param || '').trim();
      var pre = meta.pre ? String(node.group || '').trim() : '';
      return (pre ? '<sub class="f-sub">' + esc(pre) + '</sub>' : '') + sym +
        (sub ? '<sub class="f-sub">' + esc(sub) + '</sub>' : '') +
        '<span class="f-paren">(</span>' + toHTML(kids[0]) + '<span class="f-paren">)</span>';
    }
    var subB = String(node.param || '').trim();
    return '<span class="f-paren">(</span>' + toHTML(kids[0]) + ' ' + sym +
      (subB ? '<sub class="f-sub">' + esc(subB) + '</sub>' : '') + ' ' +
      toHTML(kids[1]) + '<span class="f-paren">)</span>';
  }

  /* ---------- typing an expression ---------- */

  var UNARY_WORDS = {
    'π': 'project', 'pi': 'project', 'project': 'project',
    'σ': 'select', 'sigma': 'select', 'select': 'select',
    'ρ': 'rename', 'rho': 'rename', 'rename': 'rename'
  };
  var BINARY_SYMBOLS = {
    '∪': 'union', '∩': 'intersect', '−': 'difference', '-': 'difference',
    '×': 'product', '*': 'product', '⋈': 'join', '÷': 'divide', '/': 'divide'
  };
  var BINARY_WORDS = {
    'union': 'union', 'intersect': 'intersect',
    'minus': 'difference', 'difference': 'difference', 'except': 'difference',
    'product': 'product', 'times': 'product', 'cross': 'product',
    'join': 'join', 'divide': 'divide'
  };
  var LOW_PRECEDENCE = { union: 1, intersect: 1, difference: 1 };
  var HIGH_PRECEDENCE = { product: 1, join: 1, divide: 1 };
  var IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;
  var IDENT_DOT = /^[A-Za-z_][A-Za-z0-9_.]*/;
  // Operator words are matched letters-only: "_" is a legal identifier
  // character, so IDENT would swallow the "_" of "join_{...}".
  var WORD = /^[A-Za-z]+/;

  /* Parses standard notation into the same tree the canvas edits, so typing and
     dragging are two views of one model. "?" stands for an unfilled slot. */
  function parseExpression(text) {
    var s = String(text == null ? '' : text);
    var i = 0;

    function fail(msg) { throw RAError(msg + ' (position ' + (i + 1) + ')'); }
    function ws() { while (i < s.length && /\s/.test(s[i])) i++; }
    function ident() { var m = IDENT.exec(s.slice(i)); return m ? m[0] : null; }
    function word() { var m = WORD.exec(s.slice(i)); return m ? m[0] : null; }

    function delimited(open, close) {
      var depth = 0, start = ++i;
      while (i < s.length) {
        if (s[i] === open) depth++;
        else if (s[i] === close) {
          if (depth === 0) return s.slice(start, i++).trim();
          depth--;
        }
        i++;
      }
      i = start;
      fail('Missing a closing "' + close + '"');
    }

    // A parameter is _{...}, {...}, [...], or bare text after _ up to the "(".
    function param() {
      var save = i;
      ws();
      var underscore = s[i] === '_';
      if (underscore) { i++; ws(); }
      if (s[i] === '{') return delimited('{', '}');
      if (s[i] === '[') return delimited('[', ']');
      if (underscore) {
        var start = i;
        while (i < s.length && s[i] !== '(') i++;
        var bare = s.slice(start, i).trim();
        if (!bare) { i = save; fail('Expected a parameter after "_"'); }
        return bare;
      }
      i = save;
      return null;
    }

    function binaryOp() {
      var save = i;
      ws();
      if (s.substr(i, 4) === '|><|') { i += 4; return 'join'; }
      if (s.substr(i, 3) === '|x|' || s.substr(i, 3) === '|X|') { i += 3; return 'join'; }
      if (BINARY_SYMBOLS[s[i]]) return BINARY_SYMBOLS[s[i++]];
      var w = word();
      if (w && BINARY_WORDS[w.toLowerCase()]) { i += w.length; return BINARY_WORDS[w.toLowerCase()]; }
      i = save;
      return null;
    }

    function level(allowed, next) {
      var node = next();
      for (;;) {
        var save = i, op = binaryOp();
        if (!op || !allowed[op]) { i = save; break; }
        var p = param();
        if (p !== null && op !== 'join') {
          fail(OPS[op].symbol + ' does not take a condition');
        }
        node = { type: 'op', op: op, param: p || '', group: '', children: [node, next()] };
      }
      return node;
    }

    function expression() { return level(LOW_PRECEDENCE, term); }
    function term() { return level(HIGH_PRECEDENCE, factor); }

    /* <grouping attributes> ℱ_{functions}(R) — the grouping attributes come
       before the symbol, so this has to be tried before a plain relation name. */
    function aggregation() {
      var save = i;
      ws();

      // "F", "group" and "aggregate" are also legal relation names, so they only
      // count as the operator when a parameter follows them.
      function readF() {
        var mark = i;
        ws();
        if (s[i] === 'ℱ') { i++; return true; }
        var w = s[i] === 'F' ? 'F' : word();
        if (w && (w === 'F' || w.toLowerCase() === 'group' || w.toLowerCase() === 'aggregate')) {
          var after = i + w.length;
          while (after < s.length && /\s/.test(s[after])) after++;
          if (s[after] === '_' || s[after] === '{' || s[after] === '[') { i += w.length; return true; }
        }
        i = mark;
        return false;
      }

      var grouping = null;
      if (!readF()) {
        if (s[i] === '{') grouping = delimited('{', '}');
        else if (s[i] === '[') grouping = delimited('[', ']');
        else if (IDENT_DOT.test(s.slice(i))) {
          var list = [];
          for (;;) {
            var m = IDENT_DOT.exec(s.slice(i));
            if (!m) { i = save; return null; }
            list.push(m[0]);
            i += m[0].length;
            ws();
            if (s[i] === ',') { i++; ws(); continue; }
            break;
          }
          grouping = list.join(', ');
        } else { i = save; return null; }
        if (!readF()) { i = save; return null; }
      }

      var funcs = param();
      if (funcs === null) fail('ℱ must be written ℱ_{COUNT(eid)}(...)');
      ws();
      if (s[i] !== '(') fail('Expected "(" after ℱ_{' + funcs + '}');
      i++;
      ws();
      var child = null;
      if (s[i] !== ')') { child = expression(); ws(); }
      if (s[i] !== ')') fail('Missing a closing ")"');
      i++;
      return { type: 'op', op: 'group', param: funcs, group: grouping || '', children: [child] };
    }

    function factor() {
      ws();
      if (i >= s.length) fail('The expression is incomplete');
      if (s[i] === '?') { i++; return null; }              // an empty slot
      var agg = aggregation();
      if (agg) return agg;
      if (s[i] === '(') {
        i++;
        ws();
        if (s[i] === ')') { i++; return null; }   // "()" is an empty slot
        var inner = expression();
        ws();
        if (s[i] !== ')') fail('Missing a closing ")"');
        i++;
        return inner;
      }

      var opName = UNARY_WORDS[s[i]];
      if (opName) i++;
      else {
        var w = word();
        // "Project" the relation vs "project_{...}" the operator: only the one
        // carrying a parameter is an operator.
        if (w && UNARY_WORDS[w.toLowerCase()]) {
          var after = i + w.length;
          while (after < s.length && /\s/.test(s[after])) after++;
          if (s[after] === '_' || s[after] === '{' || s[after] === '[') {
            opName = UNARY_WORDS[w.toLowerCase()];
            i += w.length;
          }
        }
      }

      if (opName) {
        var p = param();
        if (p === null) {
          fail(OPS[opName].symbol + ' must be written ' + OPS[opName].symbol +
               '_{' + OPS[opName].paramLabel + '}(...)');
        }
        ws();
        if (s[i] !== '(') fail('Expected "(" after ' + OPS[opName].symbol + '_{' + p + '}');
        i++;
        ws();
        var child = null;
        if (s[i] !== ')') { child = expression(); ws(); }   // "()" is an empty slot
        if (s[i] !== ')') fail('Missing a closing ")"');
        i++;
        return { type: 'op', op: opName, param: p, group: '', children: [child] };
      }

      var name = ident();
      if (name) { i += name.length; return { type: 'rel', name: name }; }
      fail('Expected a relation name, an operator, or "("');
    }

    ws();
    if (!s.trim()) return null;
    var tree = expression();
    ws();
    if (i < s.length) fail('Unexpected "' + s[i] + '"');
    return tree;
  }

  // The canonical form parseExpression round-trips; always brace-delimited.
  function toText(node, asOperand) {
    if (!node) return '?';
    if (node.type === 'rel') return node.name;
    var meta = OPS[node.op];
    var p = String(node.param || '').trim();
    if (meta.arity === 1) {
      var child = node.children[0];
      var inner = toText(child);
      // A binary child already brackets itself; don't double up.
      var bracketed = child && child.type === 'op' && OPS[child.op].arity === 2;
      var pre = meta.pre && String(node.group || '').trim() ? String(node.group).trim() + ' ' : '';
      var text = pre + meta.symbol + '_{' + p + '}' + (bracketed ? inner : '(' + inner + ')');
      // "A ⋈ dept ℱ_{...}(B)" reads as if dept belonged to the ⋈.
      return pre && asOperand ? '(' + text + ')' : text;
    }
    return '(' + toText(node.children[0], true) + ' ' + meta.symbol + (p ? '_{' + p + '}' : '') +
           ' ' + toText(node.children[1], true) + ')';
  }

  /* ---------- answer checking ---------- */

  function permutations(n) {
    if (n === 0) return [[]];
    var out = [];
    permutations(n - 1).forEach(function (p) {
      for (var i = 0; i <= p.length; i++) {
        out.push(p.slice(0, i).concat([n - 1], p.slice(i)));
      }
    });
    return out;
  }

  function rowSet(rel, order) {
    var set = Object.create(null);
    rel.rows.forEach(function (row) {
      set[JSON.stringify(order.map(function (i) {
        var v = row[rel.attrs[i]];
        return typeof v === 'number' ? 'n:' + v : 's:' + v;
      }))] = true;
    });
    return set;
  }

  function sameKeys(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(function (k) { return k in b; });
  }

  /* Relations are unordered sets of attributes, so any column permutation that
     reproduces the expected rows counts as correct — unless the level asks for
     exact attribute names (rename puzzles). */
  function compare(actual, expected, options) {
    options = options || {};
    if (actual.attrs.length !== expected.attrs.length) {
      return { ok: false, reason: 'arity',
        message: 'Your result has ' + actual.attrs.length + ' column(s); the answer needs ' + expected.attrs.length + '.' };
    }
    if (options.checkNames) {
      if (!sameAttrSet(actual.attrs, expected.attrs)) {
        return { ok: false, reason: 'names',
          message: 'The columns should be named ' + expected.attrs.join(', ') + ' — yours are ' + actual.attrs.join(', ') + '.' };
      }
      var order = expected.attrs.map(function (a) { return actual.attrs.indexOf(a); });
      var identity = expected.attrs.map(function (_, i) { return i; });
      if (sameKeys(rowSet(actual, order), rowSet(expected, identity))) return { ok: true };
      return { ok: false, reason: 'rows', message: rowMessage(actual, expected) };
    }
    var target = rowSet(expected, expected.attrs.map(function (_, i) { return i; }));
    var perms = permutations(Math.min(actual.attrs.length, 6));
    if (actual.attrs.length <= 6) {
      for (var i = 0; i < perms.length; i++) {
        if (sameKeys(rowSet(actual, perms[i]), target)) return { ok: true };
      }
    } else if (sameKeys(rowSet(actual, actual.attrs.map(function (_, k) { return k; })), target)) {
      return { ok: true };
    }
    return { ok: false, reason: 'rows', message: rowMessage(actual, expected) };
  }

  function rowMessage(actual, expected) {
    if (actual.rows.length !== expected.rows.length) {
      return 'Your result has ' + actual.rows.length + ' row(s); the answer has ' + expected.rows.length + '.';
    }
    return 'You have the right number of rows, but not the right ones.';
  }

  global.RA = {
    relation: relation,
    evaluate: evaluate,
    compare: compare,
    toHTML: toHTML,
    toText: toText,
    parseExpression: parseExpression,
    OPS: OPS,
    parseCondition: parseCondition,
    error: RAError
  };
})(typeof window !== 'undefined' ? window : globalThis);
