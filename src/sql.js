/* SQL: a teaching subset, evaluated over the same relations the algebra uses,
   so any level can be answered in either language.

   SELECT/DISTINCT, joins (comma, INNER ... ON, USING, NATURAL, CROSS), WHERE,
   GROUP BY/HAVING, ORDER BY/LIMIT, UNION/INTERSECT/EXCEPT, and subqueries —
   IN, EXISTS and scalar, correlated or not. Unlike the algebra it keeps
   duplicate rows, because knowing when to write DISTINCT is half of what SQL
   has to teach. */
(function (global) {
  'use strict';

  var RA = global.RA;
  var err = RA.error;

  /* ---------- tokens ---------- */

  var KEYWORDS = ('SELECT DISTINCT ALL AS FROM WHERE GROUP BY HAVING ORDER ASC DESC LIMIT OFFSET ' +
    'JOIN INNER LEFT RIGHT FULL OUTER NATURAL CROSS ON USING UNION INTERSECT EXCEPT ' +
    'AND OR NOT IN EXISTS BETWEEN LIKE IS NULL TRUE FALSE').split(' ');
  var KW = Object.create(null);
  KEYWORDS.forEach(function (k) { KW[k] = true; });

  var AGGREGATES = { COUNT: 1, SUM: 1, AVG: 1, AVERAGE: 1, MIN: 1, MAX: 1 };
  var PUNCT = ['<>', '!=', '<=', '>=', '(', ')', ',', '.', '*', '+', '-', '/', '=', '<', '>', ';'];

  function tokenize(src) {
    var out = [], i = 0;
    while (i < src.length) {
      var c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '-' && src[i + 1] === '-') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') {
        var end = src.indexOf('*/', i + 2);
        i = end === -1 ? src.length : end + 2;
        continue;
      }
      var at = i;
      if (/[0-9]/.test(c)) {
        var num = '';
        while (i < src.length && /[0-9]/.test(src[i])) num += src[i++];
        if (src[i] === '.' && /[0-9]/.test(src[i + 1] || '')) {
          num += src[i++];
          while (i < src.length && /[0-9]/.test(src[i])) num += src[i++];
        }
        out.push({ t: 'lit', v: parseFloat(num), at: at });
        continue;
      }
      if (c === "'") {
        var str = '';
        i++;
        for (;;) {
          if (i >= src.length) throw err('Unclosed quote — a text value needs a closing \'.');
          if (src[i] === "'") {
            if (src[i + 1] === "'") { str += "'"; i += 2; continue; }   // '' is an escaped quote
            i++;
            break;
          }
          str += src[i++];
        }
        out.push({ t: 'lit', v: str, at: at });
        continue;
      }
      if (/[A-Za-z_"]/.test(c)) {
        var id = readNamePart(), dotted = false;
        // A qualified name is one token: "E.salary" behaves like an attribute.
        while (src[i] === '.' && /[A-Za-z_"]/.test(src[i + 1] || '')) {
          i++;
          id += '.' + readNamePart();
          dotted = true;
        }
        var up = id.toUpperCase();
        if (!dotted && src[at] !== '"' && KW[up]) out.push({ t: 'kw', v: up, at: at });
        else out.push({ t: 'id', v: id, at: at });
        continue;
      }
      var p = PUNCT.filter(function (s) { return src.substr(i, s.length) === s; })[0];
      if (p) { out.push({ t: p, at: at }); i += p.length; continue; }
      throw err('I do not understand "' + c + '" here.');
    }
    out.push({ t: 'end', at: src.length });
    return out;

    function readNamePart() {
      if (src[i] === '"') {
        var q = '';
        i++;
        while (i < src.length && src[i] !== '"') q += src[i++];
        if (src[i] !== '"') throw err('Unclosed " around a column name.');
        i++;
        return q;
      }
      var name = '';
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) name += src[i++];
      return name;
    }
  }

  /* ---------- parser ---------- */

  function parse(text) {
    var tokens = tokenize(String(text == null ? '' : text)), pos = 0;

    function peek(k) { return tokens[pos + (k || 0)]; }
    function at(t, v) {
      var tk = peek();
      return tk.t === t && (v === undefined || tk.v === v);
    }
    function atKw() {
      var want = Array.prototype.slice.call(arguments);
      return peek().t === 'kw' && want.indexOf(peek().v) !== -1;
    }
    function next() { return tokens[pos++]; }
    function show(tk) {
      if (tk.t === 'end') return 'the end of the query';
      if (tk.t === 'lit') return typeof tk.v === 'string' ? "'" + tk.v + "'" : String(tk.v);
      return '"' + (tk.v || tk.t) + '"';
    }
    function want(t, v, what) {
      if (!at(t, v)) throw err('Expected ' + (what || (v || t)) + ' but found ' + show(peek()) + '.');
      return next();
    }
    function eatKw() {
      if (atKw.apply(null, arguments)) { next(); return true; }
      return false;
    }

    // Parentheses are ambiguous: "(" may open a subquery or just a group of
    // joins, so the parser tries one reading and rewinds if it does not fit.
    function attempt(fn) {
      var save = pos;
      try { return fn(); } catch (e) { pos = save; return null; }
    }

    /* queryExpr := queryTerm ((UNION [ALL] | INTERSECT | EXCEPT) queryTerm)* [ORDER BY ...] [LIMIT n] */
    function queryExpr() {
      var node = queryTerm();
      while (atKw('UNION', 'INTERSECT', 'EXCEPT')) {
        var op = next().v.toLowerCase();
        var all = eatKw('ALL');
        if (!all) eatKw('DISTINCT');
        node = { kind: 'setop', op: op, all: all, left: node, right: queryTerm() };
      }
      tail(node);
      return node;
    }

    function queryTerm() {
      if (at('(')) {
        var inner = attempt(function () {
          next();
          var q = queryExpr();
          want(')', undefined, 'a closing ")"');
          return q;
        });
        if (inner) return inner;
      }
      return selectStmt();
    }

    function tail(node) {
      if (atKw('ORDER')) {
        next();
        if (!eatKw('BY')) throw err('ORDER must be followed by BY.');
        node.order = [];
        do {
          var key = expression();
          var dir = eatKw('DESC') ? 'desc' : (eatKw('ASC') ? 'asc' : 'asc');
          node.order.push({ expr: key, dir: dir });
        } while (at(',') && next());
      }
      if (atKw('LIMIT')) {
        next();
        node.limit = numberValue('LIMIT');
        if (atKw('OFFSET')) { next(); node.offset = numberValue('OFFSET'); }
      }
      if (at(';')) next();
    }

    function numberValue(what) {
      var tk = peek();
      if (tk.t !== 'lit' || typeof tk.v !== 'number') {
        throw err(what + ' needs a number, but found ' + show(tk) + '.');
      }
      next();
      return tk.v;
    }

    function selectStmt() {
      if (!atKw('SELECT')) {
        throw err(peek().t === 'end'
          ? 'A query starts with SELECT.'
          : 'A query starts with SELECT, but this one starts with ' + show(peek()) + '.');
      }
      next();
      var node = { kind: 'select', distinct: false, items: [], from: [], where: null, group: null, having: null };
      if (eatKw('DISTINCT')) node.distinct = true;
      else eatKw('ALL');
      node.items = selectList();
      if (eatKw('FROM')) node.from = fromClause();
      if (eatKw('WHERE')) node.where = expression();
      if (atKw('GROUP')) {
        next();
        if (!eatKw('BY')) throw err('GROUP must be followed by BY.');
        node.group = [];
        do { node.group.push(expression()); } while (at(',') && next());
      }
      if (eatKw('HAVING')) {
        node.having = expression();
        if (!node.group) node.group = [];       // HAVING without GROUP BY: one group
      }
      return node;
    }

    function selectList() {
      var items = [];
      do {
        if (at('*')) { next(); items.push({ star: true }); continue; }
        // "E.*" arrives as the id "E" followed by "." and "*".
        if (at('id') && peek(1).t === '.' && peek(2).t === '*') {
          var q = next().v;
          next(); next();
          items.push({ star: true, qualifier: q });
          continue;
        }
        var e = expression(), alias = null;
        if (eatKw('AS')) alias = want('id', undefined, 'a name after AS').v;
        else if (at('id') && !atKw()) alias = next().v;
        items.push({ expr: e, alias: alias });
      } while (at(',') && next());
      if (!items.length) throw err('SELECT needs at least one column.');
      return items;
    }

    /* FROM item [, item]*, where each item may be a chain of joins. */
    function fromClause() {
      var items = [];
      do { items.push(joinChain()); } while (at(',') && next());
      return items;
    }

    function joinChain() {
      var node = fromItem();
      for (;;) {
        if (atKw('LEFT', 'RIGHT', 'FULL', 'OUTER')) {
          throw err('Outer joins are not part of this playground — every join here is an inner join.');
        }
        var natural = false, cross = false;
        if (atKw('NATURAL')) { next(); natural = true; }
        else if (atKw('CROSS')) { next(); cross = true; }
        else if (!atKw('INNER', 'JOIN')) break;
        eatKw('INNER');
        if (!eatKw('JOIN')) throw err('Expected JOIN but found ' + show(peek()) + '.');
        var right = fromItem();
        var on = null, using = null;
        if (eatKw('ON')) on = expression();
        else if (eatKw('USING')) {
          want('(', undefined, '"(" after USING');
          using = [];
          do { using.push(want('id', undefined, 'a column name').v); } while (at(',') && next());
          want(')', undefined, 'a closing ")"');
        }
        if (natural && (on || using)) throw err('A NATURAL JOIN already knows its columns — drop the ON.');
        if (!natural && !cross && !on && !using) {
          throw err('This JOIN needs an ON condition (or write NATURAL JOIN / CROSS JOIN).');
        }
        node = { kind: 'join', left: node, right: right, natural: natural, on: on, using: using };
      }
      return node;
    }

    function fromItem() {
      if (at('(')) {
        var derived = function () {
          next();
          var sub = queryExpr();
          want(')', undefined, 'a closing ")"');
          var alias = aliasName();
          if (!alias) throw err('A subquery in FROM needs a name: (SELECT ...) AS t.');
          return { kind: 'derived', query: sub, alias: alias };
        };
        if (peek(1).t === 'kw' && peek(1).v === 'SELECT') return derived();
        var maybe = attempt(derived);
        if (maybe) return maybe;
        next();
        var inner = joinChain();
        want(')', undefined, 'a closing ")"');
        return inner;
      }
      var name = want('id', undefined, 'a table name').v;
      return { kind: 'table', name: name, alias: aliasName() };
    }

    function aliasName() {
      if (eatKw('AS')) return want('id', undefined, 'a name after AS').v;
      if (at('id')) return next().v;
      return null;
    }

    /* ---------- expressions ---------- */

    function expression() { return orExpr(); }

    function orExpr() {
      var node = andExpr();
      while (atKw('OR')) { next(); node = { k: 'or', l: node, r: andExpr() }; }
      return node;
    }
    function andExpr() {
      var node = notExpr();
      while (atKw('AND')) { next(); node = { k: 'and', l: node, r: notExpr() }; }
      return node;
    }
    function notExpr() {
      if (atKw('NOT')) { next(); return { k: 'not', l: notExpr() }; }
      return predicate();
    }

    function predicate() {
      if (atKw('EXISTS')) {
        next();
        return { k: 'exists', sub: parenSubquery('EXISTS') };
      }
      var left = additive();
      var negated = false;
      if (atKw('NOT') && peek(1).t === 'kw' && (peek(1).v === 'IN' || peek(1).v === 'BETWEEN' || peek(1).v === 'LIKE')) {
        next();
        negated = true;
      }
      if (atKw('IN')) {
        next();
        want('(', undefined, '"(" after IN');
        var node;
        if (atKw('SELECT')) {
          node = { k: 'in', l: left, sub: queryExpr(), negated: negated };
        } else {
          var list = [];
          do { list.push(expression()); } while (at(',') && next());
          node = { k: 'in', l: left, list: list, negated: negated };
        }
        want(')', undefined, 'a closing ")"');
        return node;
      }
      if (atKw('BETWEEN')) {
        next();
        var lo = additive();
        if (!eatKw('AND')) throw err('BETWEEN needs an AND: BETWEEN 1 AND 10.');
        return { k: 'between', l: left, lo: lo, hi: additive(), negated: negated };
      }
      if (atKw('LIKE')) {
        next();
        return { k: 'like', l: left, r: additive(), negated: negated };
      }
      if (atKw('IS')) {
        next();
        var isNot = eatKw('NOT');
        if (!eatKw('NULL')) throw err('IS must be followed by NULL or NOT NULL.');
        return { k: 'isnull', l: left, negated: isNot };
      }
      if (negated) throw err('NOT here needs IN, BETWEEN or LIKE after it.');
      var cmp = ['=', '<>', '!=', '<', '<=', '>', '>='].filter(function (o) { return at(o); })[0];
      if (cmp) {
        next();
        return { k: 'cmp', op: cmp === '!=' ? '<>' : cmp, l: left, r: additive() };
      }
      return left;
    }

    function parenSubquery(what) {
      want('(', undefined, '"(" after ' + what);
      if (!atKw('SELECT')) throw err(what + ' needs a subquery: ' + what + ' (SELECT ...).');
      var sub = queryExpr();
      want(')', undefined, 'a closing ")"');
      return sub;
    }

    function additive() {
      var node = multiplicative();
      for (;;) {
        if (at('+')) { next(); node = { k: 'bin', op: '+', l: node, r: multiplicative() }; }
        else if (at('-')) { next(); node = { k: 'bin', op: '-', l: node, r: multiplicative() }; }
        else return node;
      }
    }
    function multiplicative() {
      var node = unary();
      for (;;) {
        if (at('*')) { next(); node = { k: 'bin', op: '*', l: node, r: unary() }; }
        else if (at('/')) { next(); node = { k: 'bin', op: '/', l: node, r: unary() }; }
        else return node;
      }
    }
    function unary() {
      if (at('-')) { next(); return { k: 'neg', l: unary() }; }
      if (at('+')) { next(); return unary(); }
      return primary();
    }

    function primary() {
      var tk = peek();
      if (tk.t === 'lit') { next(); return { k: 'lit', v: tk.v }; }
      if (tk.t === 'kw' && (tk.v === 'TRUE' || tk.v === 'FALSE')) { next(); return { k: 'lit', v: tk.v === 'TRUE' }; }
      if (tk.t === 'kw' && tk.v === 'NULL') { next(); return { k: 'lit', v: null }; }
      if (tk.t === '(') {
        if (peek(1).t === 'kw' && peek(1).v === 'SELECT') {
          next();
          var sub = queryExpr();
          want(')', undefined, 'a closing ")"');
          return { k: 'sub', query: sub };
        }
        next();
        var inner = expression();
        want(')', undefined, 'a closing ")"');
        return inner;
      }
      if (tk.t === 'id') {
        next();
        if (at('(')) return call(tk.v);
        return { k: 'col', name: tk.v };
      }
      throw err('Expected a column, a value or "(" but found ' + show(tk) + '.');
    }

    function call(name) {
      var fn = name.toUpperCase();
      want('(', undefined, '"("');
      if (!AGGREGATES[fn]) {
        throw err('There is no function "' + name + '" here. Available: COUNT, SUM, AVG, MIN, MAX.');
      }
      if (fn === 'AVERAGE') fn = 'AVG';
      var distinct = eatKw('DISTINCT');
      var arg;
      if (at('*')) {
        next();
        if (fn !== 'COUNT') throw err(fn + '(*) is not allowed — name a column.');
        arg = '*';
      } else {
        arg = expression();
      }
      want(')', undefined, 'a closing ")"');
      return { k: 'agg', fn: fn, arg: arg, distinct: distinct };
    }

    var tree = queryExpr();
    if (!at('end')) throw err('Unexpected ' + show(peek()) + ' after the end of the query.');
    return tree;
  }

  /* ---------- expression text ---------- */

  /* Renders an expression back to SQL. Used for column names, for matching
     ORDER BY keys against the select list, and for the GROUP BY check. */
  function exprText(n) {
    switch (n.k) {
      case 'col': return n.name;
      case 'lit': return n.v === null ? 'NULL' : (typeof n.v === 'string' ? "'" + n.v.replace(/'/g, "''") + "'" : String(n.v));
      case 'agg': return n.fn + '(' + (n.distinct ? 'DISTINCT ' : '') + (n.arg === '*' ? '*' : exprText(n.arg)) + ')';
      case 'bin': return exprText(n.l) + ' ' + n.op + ' ' + exprText(n.r);
      case 'neg': return '-' + exprText(n.l);
      case 'cmp': return exprText(n.l) + ' ' + n.op + ' ' + exprText(n.r);
      case 'and': return exprText(n.l) + ' AND ' + exprText(n.r);
      case 'or': return '(' + exprText(n.l) + ' OR ' + exprText(n.r) + ')';
      case 'not': return 'NOT ' + exprText(n.l);
      case 'in': return exprText(n.l) + (n.negated ? ' NOT IN' : ' IN') + ' (...)';
      case 'exists': return 'EXISTS (...)';
      case 'between': return exprText(n.l) + ' BETWEEN ' + exprText(n.lo) + ' AND ' + exprText(n.hi);
      case 'like': return exprText(n.l) + ' LIKE ' + exprText(n.r);
      case 'isnull': return exprText(n.l) + (n.negated ? ' IS NOT NULL' : ' IS NULL');
      case 'sub': return '(SELECT ...)';
    }
    return '?';
  }

  function bareName(name) {
    var dot = name.lastIndexOf('.');
    return dot === -1 ? name : name.slice(dot + 1);
  }

  /* ---------- values ---------- */

  function coerce(a, b) {
    if (typeof a === 'number' && typeof b === 'string' && b.trim() !== '' && !isNaN(Number(b))) return [a, Number(b)];
    if (typeof b === 'number' && typeof a === 'string' && a.trim() !== '' && !isNaN(Number(a))) return [Number(a), b];
    return [a, b];
  }

  function isNull(v) { return v === null || v === undefined; }

  function compareValues(a, b) {
    var pair = coerce(a, b);
    if (pair[0] === pair[1]) return 0;
    return pair[0] < pair[1] ? -1 : 1;
  }

  function keyOf(v) {
    if (isNull(v)) return 'null';
    return (typeof v === 'number' ? 'n:' : typeof v === 'boolean' ? 'b:' : 's:') + v;
  }

  function rowKey(row, attrs) {
    return JSON.stringify(attrs.map(function (a) { return keyOf(row[a]); }));
  }

  function dedupe(attrs, rows) {
    var seen = Object.create(null), out = [];
    rows.forEach(function (r) {
      var k = rowKey(r, attrs);
      if (!(k in seen)) { seen[k] = true; out.push(r); }
    });
    return out;
  }

  /* Resolves a written name against a scope: "salary" finds "E.salary" when
     that is the only candidate, exactly as SQL does. Returns null if absent,
     so the caller can look in the enclosing query instead. */
  function findAttr(attrs, name) {
    if (attrs.indexOf(name) !== -1) return name;
    var suffix = '.' + name;
    var hits = attrs.filter(function (a) { return a.length > suffix.length && a.slice(-suffix.length) === suffix; });
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      throw err('"' + name + '" is ambiguous — it could mean ' + hits.join(' or ') + '. Qualify it.');
    }
    var low = name.toLowerCase();
    var ci = attrs.filter(function (a) {
      return a.toLowerCase() === low || (a.length > suffix.length && a.toLowerCase().slice(-suffix.length) === suffix.toLowerCase());
    });
    return ci.length === 1 ? ci[0] : null;
  }

  /* ---------- evaluation ---------- */

  function truthy(v) { return v === true || (!isNull(v) && v !== false && v !== 0 && v !== ''); }

  function evalScalar(n, env) {
    switch (n.k) {
      case 'lit': return n.v;
      case 'col': {
        for (var scope = env; scope; scope = scope.outer) {
          if (!scope.attrs) continue;
          var hit = findAttr(scope.attrs, n.name);
          if (hit) return scope.row ? scope.row[hit] : undefined;
        }
        throw err('There is no column "' + n.name + '" here. Available: ' +
          (env.attrs && env.attrs.length ? env.attrs.join(', ') : 'none — did you forget the FROM clause?') + '.' +
          // The classic: dept = Sales, or dept = "Sales" in a dialect that
          // would have taken it. Both arrive here looking like a column.
          (n.name.indexOf('.') === -1 ? ' If you meant the text value, quote it: \'' + n.name + '\'.' : ''));
      }
      case 'agg': return aggregate(n, env);
      case 'and': return truthy(evalScalar(n.l, env)) && truthy(evalScalar(n.r, env));
      case 'or': return truthy(evalScalar(n.l, env)) || truthy(evalScalar(n.r, env));
      case 'not': return !truthy(evalScalar(n.l, env));
      case 'cmp': {
        var a = evalScalar(n.l, env), b = evalScalar(n.r, env);
        if (isNull(a) || isNull(b)) return false;
        var c = compareValues(a, b);
        switch (n.op) {
          case '=': return c === 0;
          case '<>': return c !== 0;
          case '<': return c < 0;
          case '<=': return c <= 0;
          case '>': return c > 0;
          case '>=': return c >= 0;
        }
        throw err('Unknown comparison "' + n.op + '".');
      }
      case 'bin': {
        var x = numeric(evalScalar(n.l, env), n.op), y = numeric(evalScalar(n.r, env), n.op);
        if (n.op === '/' && y === 0) throw err('Division by zero.');
        return n.op === '+' ? x + y : n.op === '-' ? x - y : n.op === '*' ? x * y : x / y;
      }
      case 'neg': return -numeric(evalScalar(n.l, env), '-');
      case 'between': {
        var v = evalScalar(n.l, env);
        if (isNull(v)) return false;
        var inRange = compareValues(v, evalScalar(n.lo, env)) >= 0 && compareValues(v, evalScalar(n.hi, env)) <= 0;
        return n.negated ? !inRange : inRange;
      }
      case 'like': {
        var text = evalScalar(n.l, env), pattern = evalScalar(n.r, env);
        if (isNull(text) || isNull(pattern)) return false;
        var hit = likeRegex(String(pattern)).test(String(text));
        return n.negated ? !hit : hit;
      }
      case 'isnull': return n.negated ? !isNull(evalScalar(n.l, env)) : isNull(evalScalar(n.l, env));
      case 'exists': {
        var rel = evalQuery(n.sub, env.db, env);
        return rel.rows.length > 0;
      }
      case 'in': {
        var needle = evalScalar(n.l, env);
        var values;
        if (n.sub) {
          var sub = evalQuery(n.sub, env.db, env);
          if (sub.attrs.length !== 1) {
            throw err('The subquery after IN returns ' + sub.attrs.length + ' columns; it must return exactly one.');
          }
          values = sub.rows.map(function (row) { return row[sub.attrs[0]]; });
        } else {
          values = n.list.map(function (item) { return evalScalar(item, env); });
        }
        var found = values.some(function (v) { return !isNull(v) && !isNull(needle) && compareValues(needle, v) === 0; });
        return n.negated ? !found : found;
      }
      case 'sub': {
        var one = evalQuery(n.query, env.db, env);
        if (one.attrs.length !== 1) {
          throw err('A subquery used as a value returns ' + one.attrs.length + ' columns; it must return exactly one.');
        }
        if (one.rows.length > 1) {
          throw err('A subquery used as a value returned ' + one.rows.length + ' rows; it must return at most one.');
        }
        return one.rows.length ? one.rows[0][one.attrs[0]] : null;
      }
    }
    throw err('Malformed expression.');
  }

  function numeric(v, what) {
    if (typeof v === 'number') return v;
    var n = Number(v);
    if (isNull(v) || v === '' || isNaN(n)) throw err('"' + v + '" is not a number, so ' + what + ' cannot be applied to it.');
    return n;
  }

  function likeRegex(pattern) {
    var out = '';
    for (var i = 0; i < pattern.length; i++) {
      var c = pattern[i];
      if (c === '%') out += '[\\s\\S]*';
      else if (c === '_') out += '[\\s\\S]';
      else out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp('^' + out + '$', 'i');
  }

  function hasAggregate(n) {
    if (!n || typeof n !== 'object') return false;
    if (n.k === 'agg') return true;
    if (n.k === 'sub' || n.k === 'exists' || n.sub) return false;   // an inner query has its own groups
    return ['l', 'r', 'lo', 'hi'].some(function (f) { return hasAggregate(n[f]); }) ||
      (n.list || []).some(hasAggregate);
  }

  function aggregate(n, env) {
    if (!env.rows) throw err(n.fn + '(...) needs a group — put it in the SELECT list of a query, not in WHERE.');
    var rows = env.rows;
    if (n.arg === '*') return rows.length;
    var inner = { attrs: env.attrs, row: null, rows: null, db: env.db, outer: env.outer };
    var values = [];
    rows.forEach(function (row) {
      inner.row = row;
      var v = evalScalar(n.arg, inner);
      if (!isNull(v)) values.push(v);
    });
    if (n.distinct) {
      var seen = Object.create(null);
      values = values.filter(function (v) {
        var k = keyOf(v);
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      });
    }
    var label = n.arg === '*' ? '*' : exprText(n.arg);
    switch (n.fn) {
      case 'COUNT': return values.length;
      case 'SUM': case 'AVG': {
        if (!values.length) return null;
        var total = values.reduce(function (acc, v) { return acc + numericFor(v, n.fn, label); }, 0);
        return n.fn === 'SUM' ? total : total / values.length;
      }
      case 'MIN': case 'MAX': {
        if (!values.length) return null;
        return values.reduce(function (best, v) {
          var take = n.fn === 'MIN' ? compareValues(v, best) < 0 : compareValues(v, best) > 0;
          return take ? v : best;
        });
      }
    }
    throw err('Unknown function "' + n.fn + '".');
  }

  function numericFor(v, fn, label) {
    if (typeof v === 'number') return v;
    var n = Number(v);
    if (v === '' || isNaN(n)) throw err(fn + ' needs numbers, but ' + label + ' holds "' + v + '".');
    return n;
  }

  /* ---------- FROM ---------- */

  function qualifyRelation(rel, alias) {
    var attrs = rel.attrs.map(function (a) { return alias + '.' + a; });
    var rows = rel.rows.map(function (row) {
      var o = {};
      rel.attrs.forEach(function (a, i) { o[attrs[i]] = row[a]; });
      return o;
    });
    return { name: alias, attrs: attrs, rows: rows };
  }

  function crossJoin(a, b) {
    var clash = b.attrs.filter(function (x) { return a.attrs.indexOf(x) !== -1; });
    if (clash.length) {
      throw err('"' + clash[0].split('.')[0] + '" is used twice in FROM. Give each one a name, ' +
        'e.g. FROM Employee A, Employee B.');
    }
    var attrs = a.attrs.concat(b.attrs), rows = [];
    a.rows.forEach(function (x) {
      b.rows.forEach(function (y) {
        var o = {};
        a.attrs.forEach(function (k) { o[k] = x[k]; });
        b.attrs.forEach(function (k) { o[k] = y[k]; });
        rows.push(o);
      });
    });
    return { name: a.name + '×' + b.name, attrs: attrs, rows: rows };
  }

  function evalFrom(items, db, outer) {
    var rel = null;
    items.forEach(function (item) {
      var r = evalFromItem(item, db, outer);
      rel = rel ? crossJoin(rel, r) : r;
    });
    return rel;
  }

  function lookupTable(db, name) {
    if (db[name]) return db[name];
    var low = name.toLowerCase();
    var hit = Object.keys(db).filter(function (k) { return k.toLowerCase() === low; })[0];
    if (hit) return db[hit];
    throw err('There is no table called "' + name + '". Available: ' + Object.keys(db).join(', ') + '.');
  }

  function evalFromItem(item, db, outer) {
    if (item.kind === 'table') {
      var base = lookupTable(db, item.name);
      return qualifyRelation(base, item.alias || base.name);
    }
    if (item.kind === 'derived') {
      var sub = evalQuery(item.query, db, outer);
      return qualifyRelation(sub, item.alias);
    }
    var left = evalFromItem(item.left, db, outer);
    var right = evalFromItem(item.right, db, outer);

    if (item.natural || item.using) {
      var common;
      if (item.using) {
        common = item.using.map(function (name) {
          var l = findAttr(left.attrs, name), r = findAttr(right.attrs, name);
          if (!l || !r) throw err('USING names "' + name + '", which is not on both sides of the join.');
          return [l, r];
        });
      } else {
        var rightBare = {};
        right.attrs.forEach(function (a) { rightBare[bareName(a)] = a; });
        common = left.attrs
          .filter(function (a) { return Object.prototype.hasOwnProperty.call(rightBare, bareName(a)); })
          .map(function (a) { return [a, rightBare[bareName(a)]]; });
        if (!common.length) {
          throw err('NATURAL JOIN found no column name in common — use JOIN ... ON instead.');
        }
      }
      // The shared columns are kept once, on the left, exactly as SQL does.
      var dropped = {};
      common.forEach(function (pair) { dropped[pair[1]] = true; });
      var keptRight = right.attrs.filter(function (a) { return !dropped[a]; });
      var joined = { name: left.name, attrs: left.attrs.concat(keptRight), rows: [] };
      left.rows.forEach(function (x) {
        right.rows.forEach(function (y) {
          var match = common.every(function (pair) {
            return !isNull(x[pair[0]]) && !isNull(y[pair[1]]) && compareValues(x[pair[0]], y[pair[1]]) === 0;
          });
          if (!match) return;
          var o = {};
          left.attrs.forEach(function (k) { o[k] = x[k]; });
          keptRight.forEach(function (k) { o[k] = y[k]; });
          joined.rows.push(o);
        });
      });
      return joined;
    }

    var product = crossJoin(left, right);
    if (!item.on) return product;
    var env = { attrs: product.attrs, row: null, rows: null, db: db, outer: outer };
    return {
      name: product.name, attrs: product.attrs,
      rows: product.rows.filter(function (row) {
        env.row = row;
        return truthy(evalScalar(item.on, env));
      })
    };
  }

  /* ---------- SELECT ---------- */

  function canonical(n, attrs) {
    if (n.k === 'col') {
      var hit = findAttr(attrs, n.name);
      return hit || n.name;
    }
    return exprText(n);
  }

  /* Everything in the select list must be a grouping key, or inside an
     aggregate, or a constant — a group is not a row. */
  function covered(n, groupTexts, attrs) {
    if (!n || typeof n !== 'object') return true;
    if (n.k === 'agg' || n.k === 'lit') return true;
    if (groupTexts.indexOf(canonical(n, attrs)) !== -1) return true;
    if (n.k === 'col') return false;
    if (n.k === 'sub' || n.k === 'exists') return true;
    return ['l', 'r', 'lo', 'hi'].every(function (f) { return covered(n[f], groupTexts, attrs); }) &&
      (n.list || []).every(function (x) { return covered(x, groupTexts, attrs); });
  }

  function expandItems(items, src) {
    var out = [];
    items.forEach(function (item) {
      if (!item.star) {
        out.push({ expr: item.expr, name: item.alias || (item.expr.k === 'col' ? bareName(item.expr.name) : exprText(item.expr)),
                   fallback: item.alias || exprText(item.expr) });
        return;
      }
      var attrs = src.attrs;
      if (item.qualifier) {
        var prefix = item.qualifier.toLowerCase() + '.';
        attrs = attrs.filter(function (a) { return a.toLowerCase().indexOf(prefix) === 0; });
        if (!attrs.length) throw err('There is nothing called "' + item.qualifier + '" in the FROM clause.');
      }
      attrs.forEach(function (a) {
        out.push({ expr: { k: 'col', name: a }, name: bareName(a), fallback: a });
      });
    });
    return out;
  }

  // Two columns may legitimately share a bare name (a self-join selects both
  // A.ename and B.ename); the qualified name breaks the tie.
  function nameColumns(cols) {
    var counts = Object.create(null);
    cols.forEach(function (c) { counts[c.name] = (counts[c.name] || 0) + 1; });
    var used = Object.create(null);
    cols.forEach(function (c) {
      if (counts[c.name] > 1) c.name = c.fallback;
      var base = c.name, n = 2;
      while (used[c.name]) c.name = base + '_' + n++;
      used[c.name] = true;
    });
    return cols;
  }

  function evalSelect(node, db, outer) {
    var src = node.from.length ? evalFrom(node.from, db, outer) : { name: 'dual', attrs: [], rows: [{}] };
    var env = { attrs: src.attrs, row: null, rows: null, db: db, outer: outer };
    var rows = src.rows;

    if (node.where) {
      if (hasAggregate(node.where)) {
        throw err('WHERE cannot use an aggregate function — that is what HAVING is for.');
      }
      rows = rows.filter(function (row) {
        env.row = row;
        return truthy(evalScalar(node.where, env));
      });
    }

    var aggregated = !!node.group ||
      node.items.some(function (i) { return !i.star && hasAggregate(i.expr); }) ||
      hasAggregate(node.having);
    var cols = nameColumns(expandItems(node.items, src));
    var out = [];

    var sources = [];

    if (!aggregated) {
      cols.forEach(function (c) {
        if (hasAggregate(c.expr)) throw err('An aggregate function cannot be mixed with plain columns here.');
      });
      rows.forEach(function (row) {
        env.row = row;
        env.rows = null;
        var o = {};
        cols.forEach(function (c) { o[c.name] = evalScalar(c.expr, env); });
        out.push(o);
        sources.push({ row: row, rows: null });
      });
    } else {
      var keys = node.group || [];
      if (node.items.some(function (i) { return i.star; })) {
        throw err('SELECT * cannot be grouped — list the grouping columns and the aggregates instead.');
      }
      var groupTexts = keys.map(function (g) { return canonical(g, src.attrs); });
      cols.forEach(function (c) {
        if (covered(c.expr, groupTexts, src.attrs)) return;
        throw err('"' + exprText(c.expr) + '" is neither in GROUP BY nor inside an aggregate function, ' +
          'so SQL cannot tell which row of the group you mean.');
      });

      var order = [], groups = Object.create(null);
      rows.forEach(function (row) {
        env.row = row;
        env.rows = null;
        var key = JSON.stringify(keys.map(function (g) { return keyOf(evalScalar(g, env)); }));
        if (!groups[key]) { groups[key] = []; order.push(key); }
        groups[key].push(row);
      });
      // No GROUP BY means one group over everything — even over no rows at all.
      var members = keys.length ? order.map(function (k) { return groups[k]; }) : [rows];

      members.forEach(function (group) {
        env.row = group[0] || {};
        env.rows = group;
        if (node.having && !truthy(evalScalar(node.having, env))) return;
        var o = {};
        cols.forEach(function (c) { o[c.name] = evalScalar(c.expr, env); });
        out.push(o);
        sources.push({ row: env.row, rows: group });
      });
    }

    var attrs = cols.map(function (c) { return c.name; });
    if (node.distinct) {
      var seen = Object.create(null), kept = [], keptSources = [];
      out.forEach(function (row, i) {
        var k = rowKey(row, attrs);
        if (k in seen) return;
        seen[k] = true;
        kept.push(row);
        keptSources.push(sources[i]);
      });
      out = kept;
      sources = keptSources;
    }
    return finish({ name: 'result', attrs: attrs, rows: out, sources: sources, srcAttrs: src.attrs },
                  node, db, outer);
  }

  function evalSetOp(node, db, outer) {
    var left = evalQuery(node.left, db, outer), right = evalQuery(node.right, db, outer);
    if (left.attrs.length !== right.attrs.length) {
      throw err(node.op.toUpperCase() + ' needs both queries to return the same number of columns (' +
        left.attrs.length + ' vs ' + right.attrs.length + ').');
    }
    // SQL matches the two sides by position, not by name.
    var mapped = right.rows.map(function (row) {
      var o = {};
      left.attrs.forEach(function (a, i) { o[a] = row[right.attrs[i]]; });
      return o;
    });
    var inRight = Object.create(null), inLeft = Object.create(null);
    mapped.forEach(function (row) { inRight[rowKey(row, left.attrs)] = true; });
    left.rows.forEach(function (row) { inLeft[rowKey(row, left.attrs)] = true; });

    var rows;
    if (node.op === 'union') rows = left.rows.concat(mapped);
    else if (node.op === 'intersect') rows = left.rows.filter(function (r) { return inRight[rowKey(r, left.attrs)]; });
    else rows = left.rows.filter(function (r) { return !inRight[rowKey(r, left.attrs)]; });
    if (!node.all) rows = dedupe(left.attrs, rows);

    return finish({ name: 'result', attrs: left.attrs, rows: rows }, node, db, outer);
  }

  /* ORDER BY and LIMIT apply to the finished table, so they can only see the
     columns the query actually selected. */
  function finish(rel, node, db, outer) {
    if (node.order && node.order.length) {
      var env = { attrs: rel.attrs, row: null, rows: null, db: db, outer: outer };
      var keys = node.order.map(function (key) {
        var e = key.expr;
        if (e.k === 'lit' && typeof e.v === 'number') {
          var idx = Math.round(e.v) - 1;
          if (idx < 0 || idx >= rel.attrs.length) {
            throw err('ORDER BY ' + e.v + ' — the query only has ' + rel.attrs.length + ' column(s).');
          }
          return { expr: { k: 'col', name: rel.attrs[idx] }, dir: key.dir };
        }
        var text = exprText(e).toLowerCase();
        var match = rel.attrs.filter(function (a) { return a.toLowerCase() === text; })[0];
        if (match) return { expr: { k: 'col', name: match }, dir: key.dir };
        if (e.k === 'col' && findAttr(rel.attrs, e.name)) return { expr: e, dir: key.dir };
        // "ORDER BY salary" over "SELECT ename" still works: sort by the row
        // the answer came from, as SQL does.
        if (rel.sources) return { expr: e, dir: key.dir, source: true };
        throw err('ORDER BY can only sort by something the query selected' +
          (e.k === 'col' ? '; "' + e.name + '" is not one of its columns (' + rel.attrs.join(', ') + ')' : '') + '.');
      });
      var srcEnv = { attrs: rel.srcAttrs, row: null, rows: null, db: db, outer: outer };
      var decorated = rel.rows.map(function (row, i) {
        env.row = row;
        return { row: row, i: i, keys: keys.map(function (k) {
          if (!k.source) return evalScalar(k.expr, env);
          srcEnv.row = rel.sources[i].row;
          srcEnv.rows = rel.sources[i].rows;
          return evalScalar(k.expr, srcEnv);
        }) };
      });
      decorated.sort(function (a, b) {
        for (var i = 0; i < keys.length; i++) {
          var c = isNull(a.keys[i]) || isNull(b.keys[i])
            ? (isNull(a.keys[i]) ? (isNull(b.keys[i]) ? 0 : -1) : 1)
            : compareValues(a.keys[i], b.keys[i]);
          if (c) return keys[i].dir === 'desc' ? -c : c;
        }
        return a.i - b.i;                      // a stable sort keeps ties predictable
      });
      rel = { name: rel.name, attrs: rel.attrs, rows: decorated.map(function (d) { return d.row; }), ordered: true };
    } else if (rel.sources) {
      rel = { name: rel.name, attrs: rel.attrs, rows: rel.rows };
    }
    if (node.limit != null) {
      var from = node.offset || 0;
      rel = { name: rel.name, attrs: rel.attrs, rows: rel.rows.slice(from, from + node.limit), ordered: rel.ordered };
    }
    return rel;
  }

  function evalQuery(node, db, outer) {
    return node.kind === 'setop' ? evalSetOp(node, db, outer) : evalSelect(node, db, outer);
  }

  function run(text, db) {
    if (!String(text == null ? '' : text).trim()) throw err('incomplete');
    return evalQuery(parse(text), db, null);
  }

  /* ---------- rendering an algebra tree as SQL ---------- */

  var PLAIN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

  function idSQL(name) {
    return String(name).split('.').map(function (part) {
      return PLAIN_NAME.test(part) ? part : '"' + part + '"';
    }).join('.');
  }

  function litSQL(v) {
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return "'" + String(v).replace(/'/g, "''") + "'";
  }

  function splitList(text) {
    return String(text || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function splitTop(text) {
    var out = [], depth = 0, current = '';
    for (var i = 0; i < String(text || '').length; i++) {
      var c = text[i];
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === ',' && depth === 0) { out.push(current); current = ''; continue; }
      current += c;
    }
    out.push(current);
    return out.map(function (t) { return t.trim(); }).filter(Boolean);
  }

  /* An algebra condition is nearly SQL already; aggMap turns the algebra's
     COUNT_eid back into the COUNT(eid) that SQL wants in a HAVING. */
  function condSQL(n, aggMap) {
    switch (n.k) {
      case 'and': return condSQL(n.l, aggMap) + ' AND ' + condSQL(n.r, aggMap);
      case 'or': return '(' + condSQL(n.l, aggMap) + ' OR ' + condSQL(n.r, aggMap) + ')';
      case 'not': return 'NOT (' + condSQL(n.l, aggMap) + ')';
      case 'cmp': return operandSQL(n.l, aggMap) + ' ' + n.op + ' ' + operandSQL(n.r, aggMap);
      case 'lit': return n.value ? 'TRUE' : 'FALSE';
    }
    throw err('Cannot translate this condition.');
  }

  function operandSQL(n, aggMap) {
    if (n.k === 'lit') return litSQL(n.value);
    if (aggMap && aggMap[n.name]) return aggMap[n.name];
    return idSQL(n.name);
  }

  function Q() {
    return { distinct: false, cols: null, from: [], where: [], group: null, having: [],
             grouped: false, aggMap: null, outMap: null, raw: null };
  }

  function indent(text) {
    return text.split('\n').map(function (l) { return '  ' + l; }).join('\n');
  }

  function render(q) {
    if (q.raw) return q.raw;
    var lines = ['SELECT ' + (q.distinct ? 'DISTINCT ' : '') + (q.cols ? q.cols.join(', ') : '*')];
    if (q.from.length) lines.push('FROM ' + q.from.join(', '));
    if (q.where.length) lines.push('WHERE ' + q.where.join(' AND '));
    if (q.group && q.group.length) lines.push('GROUP BY ' + q.group.join(', '));
    if (q.having.length) lines.push('HAVING ' + q.having.join(' AND '));
    return lines.join('\n');
  }

  // A query that is nothing but "FROM X" can be inlined wherever a table can.
  function simpleTable(q) {
    return !q.raw && !q.cols && !q.grouped && !q.where.length && q.from.length === 1 ? q.from[0] : null;
  }

  function parenthesized(q) {
    return '(\n' + indent(render(q)) + '\n)';
  }

  function asFrom(q, alias) {
    var plain = simpleTable(q);
    if (plain) return plain;
    return parenthesized(q) + ' AS ' + alias;
  }

  function wrap(q, ctx) {
    var out = Q();
    out.from = [parenthesized(q) + ' AS ' + ctx.alias()];
    return out;
  }

  /* Translates the tree the canvas edits into the SQL that answers the same
     question. One way only: the point is to show a student the correspondence,
     not to keep two editors in sync. */
  function fromTree(node, db) {
    var ctx = {
      db: db,
      n: 0,
      alias: function () { return 't' + (++this.n); },
      attrsOf: function (sub) { return RA.evaluate(sub, db).attrs; },
      nameOf: function (sub) {
        var name = RA.evaluate(sub, db).name;
        return PLAIN_NAME.test(name) ? name : this.alias();
      }
    };
    try {
      return render(build(node, ctx));
    } catch (e) {
      return null;
    }
  }

  function build(node, ctx) {
    if (!node) throw err('incomplete');
    if (node.type === 'rel') {
      var q = Q();
      q.from = [idSQL(node.name)];
      return q;
    }
    var kids = node.children || [];
    switch (node.op) {
      case 'project': return buildProject(node, ctx, build(kids[0], ctx));
      case 'select': return buildSelect(node, ctx, build(kids[0], ctx));
      case 'rename': return buildRename(node, ctx, kids[0], build(kids[0], ctx));
      case 'group': return buildGroup(node, ctx, build(kids[0], ctx));
      case 'union': case 'intersect': case 'difference': return buildSetOp(node, ctx, kids);
      case 'product': case 'join': return buildJoin(node, ctx, kids);
      case 'divide': return buildDivide(node, ctx, kids);
    }
    throw err('Cannot translate "' + node.op + '".');
  }

  function buildProject(node, ctx, child) {
    var wanted = splitList(node.param);
    if (!wanted.length) throw err('incomplete');
    if (child.grouped) {
      var mapped = wanted.map(function (name) { return child.outMap[name]; });
      if (mapped.every(Boolean)) {
        child.cols = mapped;
        child.distinct = (child.group || []).some(function (g) { return mapped.indexOf(g) === -1; });
        return child;
      }
      child = wrap(child, ctx);
    } else if (child.cols !== null || child.raw) {
      child = wrap(child, ctx);
    }
    child.cols = wanted.map(idSQL);
    child.distinct = true;
    return child;
  }

  function buildSelect(node, ctx, child) {
    var cond = RA.parseCondition(node.param);
    if (child.grouped) {
      child.having.push(condSQL(cond, child.aggMap));
      return child;
    }
    if (child.cols !== null || child.raw) child = wrap(child, ctx);
    child.where.push(condSQL(cond, null));
    return child;
  }

  function buildRename(node, ctx, kidNode, child) {
    var m = /^([A-Za-z_][A-Za-z0-9_]*)?\s*(?:\(([^)]*)\))?$/.exec(String(node.param || '').trim());
    if (!m || (!m[1] && !m[2])) throw err('Cannot translate this ρ.');
    if (m[2] === undefined) {
      // ρ_{E1}: an alias on a table, or on a subquery.
      var plain = simpleTable(child);
      var out = Q();
      out.from = [plain && PLAIN_NAME.test(plain) ? plain + ' AS ' + m[1] : parenthesized(child) + ' AS ' + m[1]];
      return out;
    }
    var names = splitList(m[2]);
    var attrs = ctx.attrsOf(kidNode);
    if (attrs.length !== names.length) throw err('Cannot translate this ρ.');
    // Renaming the columns of a grouped query is just a different AS on the
    // same select list; anything else needs a SELECT of its own.
    var sources = child.grouped && child.colExprs && child.colExprs.length === names.length
      ? child.colExprs
      : null;
    if (!sources) {
      if (child.cols !== null || child.raw || child.grouped) child = wrap(child, ctx);
      sources = attrs.map(idSQL);
    }
    child.cols = sources.map(function (expr, i) {
      return expr === idSQL(names[i]) ? expr : expr + ' AS ' + idSQL(names[i]);
    });
    if (m[1]) {
      var renamed = Q();
      renamed.from = [parenthesized(child) + ' AS ' + m[1]];
      return renamed;
    }
    return child;
  }

  function buildGroup(node, ctx, child) {
    if (child.cols !== null || child.raw || child.grouped) child = wrap(child, ctx);
    var grouping = splitList(node.group);
    child.group = grouping.length ? grouping.map(idSQL) : null;
    child.grouped = true;
    child.cols = grouping.map(idSQL);
    child.colExprs = grouping.map(idSQL);
    child.outMap = {};
    child.aggMap = {};
    grouping.forEach(function (g) { child.outMap[g] = idSQL(g); });

    splitTop(node.param).forEach(function (item) {
      var m = /^([A-Za-z]+)\s*\(\s*(\*|[A-Za-z_][A-Za-z0-9_.]*)\s*\)$/.exec(item);
      if (!m) throw err('Cannot translate "' + item + '".');
      var fn = m[1].toUpperCase(), arg = m[2];
      if (fn === 'AVERAGE') fn = 'AVG';
      var out = arg === '*' ? 'COUNT' : fn + '_' + arg;
      var call = fn + '(' + (arg === '*' ? '*' : idSQL(arg)) + ')';
      var col = call + ' AS ' + idSQL(out);
      child.cols.push(col);
      child.colExprs.push(call);
      child.outMap[out] = col;
      child.aggMap[out] = call;
    });
    return child;
  }

  function buildSetOp(node, ctx, kids) {
    var keyword = { union: 'UNION', intersect: 'INTERSECT', difference: 'EXCEPT' }[node.op];
    var left = build(kids[0], ctx), right = build(kids[1], ctx);
    var q = Q();
    q.raw = side(left) + '\n' + keyword + '\n' + side(right);
    return q;

    // Nested set operations need their own parentheses to keep their grouping.
    function side(sub) { return sub.raw ? parenthesized(sub) : render(sub); }
  }

  var PLAIN_SOURCE = /^[A-Za-z_][A-Za-z0-9_]*( AS [A-Za-z_][A-Za-z0-9_]*)?$/;

  function buildJoin(node, ctx, kids) {
    var left = build(kids[0], ctx), right = build(kids[1], ctx);
    var q = Q();
    var l = joinSide(left, ctx.nameOf(kids[0]), q), r = joinSide(right, ctx.nameOf(kids[1]), q);
    if (node.op === 'product') {
      q.from = [l, r];
      return q;
    }
    var cond = String(node.param || '').trim();
    q.from = [cond ? l + ' JOIN ' + r + ' ON ' + condSQL(RA.parseCondition(cond), null)
                   : l + ' NATURAL JOIN ' + r];
    return q;
  }

  function joinSide(q, alias, target) {
    if (!q.raw && !q.cols && !q.grouped && q.from.length === 1 && PLAIN_SOURCE.test(q.from[0])) {
      target.where = target.where.concat(q.where);
      return q.from[0];
    }
    return asFrom(q, alias);
  }

  /* R ÷ S has no SQL keyword: it becomes "no counterexample survives", which
     is the double NOT EXISTS every textbook shows. */
  function buildDivide(node, ctx, kids) {
    var rAttrs = ctx.attrsOf(kids[0]), sAttrs = ctx.attrsOf(kids[1]);
    var quotient = rAttrs.filter(function (a) { return sAttrs.indexOf(a) === -1; });
    if (!quotient.length) throw err('Cannot translate this ÷.');
    var outer = 'd1', inner = 'd2', sAlias = 's1';
    var rFrom = asFrom(build(kids[0], ctx), outer);
    var rAgain = asFrom(build(kids[0], ctx), inner);
    var sFrom = asFrom(build(kids[1], ctx), sAlias);
    if (!/ AS /.test(rFrom)) rFrom += ' AS ' + outer;
    if (!/ AS /.test(rAgain)) rAgain += ' AS ' + inner;
    if (!/ AS /.test(sFrom)) sFrom += ' AS ' + sAlias;

    var match = quotient.map(function (a) { return inner + '.' + idSQL(a) + ' = ' + outer + '.' + idSQL(a); })
      .concat(sAttrs.map(function (a) { return inner + '.' + idSQL(a) + ' = ' + sAlias + '.' + idSQL(a); }));

    var innermost = ['SELECT *', 'FROM ' + rAgain, 'WHERE ' + match.join(' AND ')].join('\n');
    var middle = ['SELECT *', 'FROM ' + sFrom,
                  'WHERE NOT EXISTS (\n' + indent(innermost) + '\n)'].join('\n');
    var q = Q();
    q.distinct = true;
    q.cols = quotient.map(function (a) { return outer + '.' + idSQL(a); });
    q.from = [rFrom];
    q.where = ['NOT EXISTS (\n' + indent(middle) + '\n)'];
    return q;
  }

  /* ---------- reading SQL back as an algebra tree ---------- */

  function relNode(name) { return { type: 'rel', name: name }; }
  function opNode(name, param, children, group) {
    return { type: 'op', op: name, param: param || '', group: group || '', children: children };
  }

  // Flagged, so the caller can tell "the algebra cannot say this" apart from
  // "you have not finished typing".
  function noAlgebra(what, why) {
    var e = err(what + ' has no counterpart in the algebra' + (why ? ' — ' + why : '') + '.');
    e.noAlgebra = true;
    throw e;
  }

  /* Resolves a name written in SQL against the attributes the algebra actually
     has. SQL qualifies every column; the algebra only qualifies the clashes. */
  function algebraAttr(attrs, written) {
    var hit = findAttr(attrs, written);
    if (hit) return hit;
    hit = findAttr(attrs, bareName(written));
    if (hit) return hit;
    throw err('There is no attribute "' + written + '" in ' + attrs.join(', ') + '.');
  }

  function litText(v) {
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (v === null) noAlgebra('NULL', 'every attribute here has a value');
    if (String(v).indexOf("'") !== -1) noAlgebra('a quote inside a text value', 'the algebra cannot escape one');
    return "'" + v + "'";
  }

  /* A SQL condition as the text σ takes. The pieces σ has no word for are
     rewritten where that is exact, and refused where it is not. */
  function condText(n, attrs, aggMap) {
    switch (n.k) {
      case 'and': return condText(n.l, attrs, aggMap) + ' AND ' + condText(n.r, attrs, aggMap);
      case 'or': return '(' + condText(n.l, attrs, aggMap) + ' OR ' + condText(n.r, attrs, aggMap) + ')';
      case 'not': return 'NOT (' + condText(n.l, attrs, aggMap) + ')';
      case 'lit': return n.v ? 'TRUE' : 'FALSE';
      case 'cmp':
        return operandText(n.l, attrs, aggMap) + ' ' + n.op + ' ' + operandText(n.r, attrs, aggMap);
      case 'between': {
        var v = operandText(n.l, attrs, aggMap);
        var range = v + ' >= ' + operandText(n.lo, attrs, aggMap) +
                    ' AND ' + v + ' <= ' + operandText(n.hi, attrs, aggMap);
        return n.negated ? 'NOT (' + range + ')' : '(' + range + ')';
      }
      case 'in': {
        if (n.sub) {
          noAlgebra('a subquery inside a condition',
            'σ only compares attributes and values, so this one has to be built out of ⋈, − or ÷');
        }
        var left = operandText(n.l, attrs, aggMap);
        var any = n.list.map(function (item) {
          return left + ' = ' + operandText(item, attrs, aggMap);
        }).join(' OR ');
        return n.negated ? 'NOT (' + any + ')' : '(' + any + ')';
      }
      case 'exists':
        noAlgebra('EXISTS',
          'σ only compares attributes and values, so this one has to be built out of ⋈, − or ÷');
        break;
      case 'like': noAlgebra('LIKE', 'σ compares whole values, not patterns'); break;
      case 'isnull': noAlgebra('IS NULL', 'every attribute here has a value'); break;
    }
    noAlgebra('this condition');
  }

  function operandText(n, attrs, aggMap) {
    if (n.k === 'lit') return litText(n.v);
    if (n.k === 'col') return algebraAttr(attrs, n.name);
    if (n.k === 'agg' && aggMap && aggMap[exprText(n)]) return aggMap[exprText(n)];
    if (n.k === 'agg') noAlgebra('an aggregate outside HAVING');
    if (n.k === 'bin' || n.k === 'neg') noAlgebra('arithmetic in a condition', 'σ compares what is already there');
    if (n.k === 'sub') {
      noAlgebra('a subquery inside a condition',
        'σ only compares attributes and values, so this one has to be built out of ⋈, − or ÷');
    }
    noAlgebra('this value');
  }

  function collectAggs(n, out) {
    if (!n || typeof n !== 'object') return;
    if (n.k === 'sub' || n.k === 'exists') return;       // an inner query has its own groups
    if (n.k === 'agg') { out.push(n); return; }
    ['l', 'r', 'lo', 'hi'].forEach(function (f) { collectAggs(n[f], out); });
    (n.list || []).forEach(function (x) { collectAggs(x, out); });
  }

  function queryToTree(node, db) {
    if (node.order) noAlgebra('ORDER BY', 'a relation has no row order to set');
    if (node.limit != null) noAlgebra('LIMIT', 'with no order there is no first row to take');
    if (node.kind === 'setop') {
      if (node.all) noAlgebra('UNION ALL', 'the algebra has no duplicate rows to keep');
      var kind = { union: 'union', intersect: 'intersect', except: 'difference' }[node.op];
      return opNode(kind, '', [queryToTree(node.left, db), queryToTree(node.right, db)]);
    }
    return selectToTree(node, db);
  }

  function selectToTree(n, db) {
    if (!n.from.length) noAlgebra('a query with no FROM', 'every expression starts from a relation');
    var tree = n.from.map(function (item) { return fromItemToTree(item, db); })
      .reduce(function (a, b) { return opNode('product', '', [a, b]); });

    if (n.where) {
      if (collectHas(n.where)) noAlgebra('an aggregate in WHERE');
      tree = opNode('select', condText(n.where, attrsOf(tree, db), null), [tree]);
    }

    var star = n.items.some(function (i) { return i.star; });
    if (n.items.some(function (i) { return i.star && i.qualifier; })) {
      noAlgebra('a qualified star', 'list the columns you want instead');
    }

    var aggs = [];
    n.items.forEach(function (i) { if (!i.star) collectAggs(i.expr, aggs); });
    collectAggs(n.having, aggs);

    var aggMap = {};
    if (aggs.length) {
      if (star) noAlgebra('SELECT * with an aggregate', 'name the columns you are grouping by');
      var srcAttrs = attrsOf(tree, db);
      var grouping = (n.group || []).map(function (g) {
        if (g.k !== 'col') noAlgebra('grouping by an expression', 'ℱ groups by attributes');
        return algebraAttr(srcAttrs, g.name);
      });
      var calls = [];
      aggs.forEach(function (a) {
        if (a.distinct) noAlgebra('COUNT(DISTINCT …)', 'ℱ counts the rows of a group as it finds them');
        var arg;
        if (a.arg === '*') arg = '*';
        else if (a.arg.k === 'col') arg = algebraAttr(srcAttrs, a.arg.name);
        else noAlgebra('an aggregate over an expression', 'ℱ takes one attribute');
        var call = a.fn + '(' + arg + ')';
        if (calls.indexOf(call) === -1) calls.push(call);
        // ℱ names its output after the call, and that name is what σ and π use.
        aggMap[exprText(a)] = arg === '*' ? 'COUNT' : a.fn + '_' + arg;
      });
      tree = opNode('group', calls.join(', '), [tree], grouping.join(', '));
    }

    if (n.having) tree = opNode('select', condText(n.having, attrsOf(tree, db), aggMap), [tree]);

    if (!star) {
      var current = attrsOf(tree, db);
      var keep = [], named = [], renamed = false;
      n.items.forEach(function (item) {
        var name;
        if (item.expr.k === 'col') name = algebraAttr(current, item.expr.name);
        else if (item.expr.k === 'agg') name = aggMap[exprText(item.expr)];
        else noAlgebra('a computed column', 'π can keep a column, but it cannot make one');
        keep.push(name);
        named.push(item.alias || name);
        if (item.alias && item.alias !== name) renamed = true;
      });
      if (keep.join(', ') !== current.join(', ')) tree = opNode('project', keep.join(', '), [tree]);
      if (renamed) tree = opNode('rename', '(' + named.join(', ') + ')', [tree]);
    }
    return tree;
  }

  function collectHas(n) {
    var found = [];
    collectAggs(n, found);
    return found.length > 0;
  }

  function attrsOf(tree, db) { return RA.evaluate(tree, db).attrs; }

  function fromItemToTree(item, db) {
    if (item.kind === 'table') {
      var base = lookupTable(db, item.name);
      var node = relNode(base.name);
      return item.alias && item.alias !== base.name ? opNode('rename', item.alias, [node]) : node;
    }
    if (item.kind === 'derived') return opNode('rename', item.alias, [queryToTree(item.query, db)]);

    var left = fromItemToTree(item.left, db), right = fromItemToTree(item.right, db);
    if (item.natural) return opNode('join', '', [left, right]);
    if (item.using) {
      var shared = attrsOf(left, db).map(bareName).filter(function (a) {
        return attrsOf(right, db).map(bareName).indexOf(a) !== -1;
      });
      var asked = item.using.map(bareName);
      if (shared.slice().sort().join(',') !== asked.slice().sort().join(',')) {
        noAlgebra('USING on only some of the shared columns', '⋈ always joins on all of them');
      }
      return opNode('join', '', [left, right]);
    }
    if (item.on) {
      var attrs = attrsOf(opNode('product', '', [left, right]), db);
      return opNode('join', condText(item.on, attrs, null), [left, right]);
    }
    return opNode('product', '', [left, right]);
  }

  /* The other direction. Like fromTree it is checked before it is handed back:
     a tree that answered a different question would teach the wrong thing. */
  function toTree(text, db) {
    if (!String(text == null ? '' : text).trim()) throw err('incomplete');
    var query = parse(text);
    var tree = queryToTree(query, db);
    var want = evalQuery(query, db, null);
    if (!RA.compare(RA.evaluate(tree, db), want, {}).ok) {
      noAlgebra('that query', 'at least not one that comes out the same — build it by hand');
    }
    return tree;
  }

  /* The left-hand palette in SQL mode: the clauses, in the order a query is
     written, with what each one is for. */
  var CLAUSES = [
    { word: 'SELECT', kind: 'clause', insert: 'SELECT ', hint: 'the columns you want back' },
    { word: 'DISTINCT', kind: 'clause', insert: 'DISTINCT ', hint: 'throw duplicate rows away' },
    { word: 'FROM', kind: 'clause', insert: 'FROM ', hint: 'the tables to read' },
    { word: 'WHERE', kind: 'clause', insert: 'WHERE ', hint: 'keep only the rows that match' },
    { word: 'AS', kind: 'clause', insert: 'AS ', hint: 'name a column or a table' },
    { word: 'JOIN', kind: 'join', insert: 'JOIN ', hint: 'pair rows from two tables — needs ON' },
    { word: 'ON', kind: 'join', insert: 'ON ', hint: 'the condition a JOIN pairs on' },
    { word: 'NATURAL JOIN', kind: 'join', insert: 'NATURAL JOIN ', hint: 'pair on the columns they share' },
    { word: 'GROUP BY', kind: 'group', insert: 'GROUP BY ', hint: 'one row per group' },
    { word: 'HAVING', kind: 'group', insert: 'HAVING ', hint: 'keep only the groups that match' },
    { word: 'COUNT', kind: 'fn', insert: 'COUNT(', hint: 'how many rows in the group' },
    { word: 'SUM', kind: 'fn', insert: 'SUM(', hint: 'total of a column' },
    { word: 'AVG', kind: 'fn', insert: 'AVG(', hint: 'average of a column' },
    { word: 'MIN', kind: 'fn', insert: 'MIN(', hint: 'smallest value' },
    { word: 'MAX', kind: 'fn', insert: 'MAX(', hint: 'largest value' },
    { word: 'ORDER BY', kind: 'sort', insert: 'ORDER BY ', hint: 'sort the answer' },
    { word: 'LIMIT', kind: 'sort', insert: 'LIMIT ', hint: 'keep only the first few rows' },
    { word: 'UNION', kind: 'set', insert: 'UNION\n', hint: 'the rows of either query' },
    { word: 'INTERSECT', kind: 'set', insert: 'INTERSECT\n', hint: 'the rows of both queries' },
    { word: 'EXCEPT', kind: 'set', insert: 'EXCEPT\n', hint: 'the rows of the first, minus the second' },
    { word: 'IN', kind: 'sub', insert: 'IN (', hint: 'is the value one of these?' },
    { word: 'EXISTS', kind: 'sub', insert: 'EXISTS (', hint: 'does the subquery find anything?' },
    { word: 'NOT EXISTS', kind: 'sub', insert: 'NOT EXISTS (', hint: 'does it find nothing at all?' }
  ];

  global.SQL = {
    run: run,
    CLAUSES: CLAUSES,
    parse: parse,
    fromTree: fromTree,
    toTree: toTree,
    KEYWORDS: KEYWORDS,
    AGGREGATES: Object.keys(AGGREGATES).filter(function (f) { return f !== 'AVERAGE'; }),
    error: err
  };
})(typeof window !== 'undefined' ? window : globalThis);
