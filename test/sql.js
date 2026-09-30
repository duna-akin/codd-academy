/* Unit test for the SQL engine and for the algebra -> SQL translation.
   Loads src/ directly (each file attaches itself to the global). */
'use strict';
require('../src/engine.js');
require('../src/sql.js');
require('../src/levels.js');

const { RA, SQL, GAME } = globalThis;
let failures = 0;

function db(name) {
  const out = {};
  GAME.DATABASES[name].relations.forEach(r => { out[r.name] = r; });
  return out;
}
const company = db('company'), school = db('school');

function show(rel) {
  return rel.rows.map(row => rel.attrs.map(a => row[a]).join('|')).join('  ');
}

function ok(label, cond, detail) {
  if (cond) return;
  failures++;
  console.log('  FAIL ' + label + (detail ? ': ' + detail : ''));
}

/* Each case: [label, sql, database, expected column names, expected rows as "a|b" strings] */
const CASES = [
  ['star', 'SELECT * FROM Project', company, 'pid,pname,budget', ['P1|Atlas|120000', 'P2|Beacon|45000', 'P3|Comet|250000']],
  ['projection keeps duplicates', 'SELECT dept FROM Employee', company,
   'dept', ['Engineering', 'Sales', 'Engineering', 'Marketing', 'Sales', 'Engineering', 'Marketing']],
  ['distinct', 'SELECT DISTINCT dept FROM Employee', company, 'dept', ['Engineering', 'Sales', 'Marketing']],
  ['where + and', "SELECT ename FROM Employee WHERE salary > 60000 AND dept = 'Engineering'", company,
   'ename', ['Ada', 'Cleo']],
  ['where + or + not', "SELECT ename FROM Employee WHERE NOT (dept = 'Sales' OR dept = 'Marketing')", company,
   'ename', ['Ada', 'Cleo', 'Fay']],
  ['between', 'SELECT ename FROM Employee WHERE age BETWEEN 30 AND 45', company, 'ename', ['Ada', 'Cleo', 'Dara', 'Gus']],
  ['like', "SELECT ename FROM Employee WHERE ename LIKE '%a%'", company, 'ename', ['Ada', 'Bran', 'Dara', 'Evan', 'Fay']],
  ['in list', "SELECT ename FROM Employee WHERE dept IN ('Sales', 'Marketing')", company,
   'ename', ['Bran', 'Dara', 'Evan', 'Gus']],
  ['arithmetic + alias', 'SELECT ename, salary / 1000 AS k FROM Employee WHERE salary >= 78000', company,
   'ename,k', ['Ada|95', 'Evan|78']],
  ['comma join', 'SELECT ename, pname FROM Employee, WorksOn, Project ' +
   'WHERE Employee.eid = WorksOn.eid AND WorksOn.pid = Project.pid AND hours > 12', company,
   'ename,pname', ['Cleo|Atlas', 'Dara|Beacon']],
  ['natural join', 'SELECT DISTINCT ename FROM Employee NATURAL JOIN WorksOn WHERE hours > 10', company,
   'ename', ['Ada', 'Cleo', 'Dara']],
  ['join on', 'SELECT Department.dept, ename FROM Department JOIN Employee ON head = eid', company,
   'dept,ename', ['Engineering|Ada', 'Sales|Evan', 'Marketing|Dara', 'Research|Cleo']],
  ['join using', 'SELECT DISTINCT title FROM Course JOIN Enrolled USING (cid) WHERE grade = \'A\'', school,
   'title', ['Databases', 'Algorithms', 'Calculus']],
  ['self join', 'SELECT A.ename, B.ename FROM Employee A, Employee B ' +
   'WHERE A.dept = B.dept AND A.eid < B.eid AND A.dept = \'Sales\'', company,
   'A.ename,B.ename', ['Bran|Evan']],
  ['group by + count', 'SELECT dept, COUNT(*) AS n FROM Employee GROUP BY dept', company,
   'dept,n', ['Engineering|3', 'Sales|2', 'Marketing|2']],
  ['aggregate over everything', 'SELECT MIN(salary), MAX(salary), COUNT(*) FROM Employee', company,
   'MIN(salary),MAX(salary),COUNT(*)', ['49000|95000|7']],
  ['having', 'SELECT dept FROM Employee GROUP BY dept HAVING COUNT(*) > 2', company, 'dept', ['Engineering']],
  ['where vs having', "SELECT dept, AVG(salary) AS avg FROM Employee WHERE age < 40 GROUP BY dept HAVING COUNT(*) > 1",
   company, 'dept,avg', ['Engineering|76500']],
  ['count distinct', 'SELECT COUNT(DISTINCT dept) AS n FROM Employee', company, 'n', ['3']],
  ['order by desc + limit', 'SELECT ename FROM Employee ORDER BY salary DESC LIMIT 3', company,
   'ename', ['Ada', 'Evan', 'Cleo']],
  ['order by two keys', 'SELECT ename, dept FROM Employee ORDER BY dept, ename DESC', company,
   'ename,dept', ['Fay|Engineering', 'Cleo|Engineering', 'Ada|Engineering', 'Gus|Marketing', 'Dara|Marketing',
                  'Evan|Sales', 'Bran|Sales']],
  ['order by an aggregate', 'SELECT dept, COUNT(*) AS n FROM Employee GROUP BY dept ORDER BY n DESC, dept',
   company, 'dept,n', ['Engineering|3', 'Marketing|2', 'Sales|2']],
  ['order by ordinal + offset', 'SELECT ename FROM Employee ORDER BY 1 LIMIT 2 OFFSET 2', company,
   'ename', ['Cleo', 'Dara']],
  ['union', "SELECT ename FROM Employee WHERE dept = 'Sales' UNION SELECT ename FROM Employee WHERE age > 50",
   company, 'ename', ['Bran', 'Evan']],
  ['union all keeps duplicates', "SELECT ename FROM Employee WHERE dept = 'Sales' " +
   'UNION ALL SELECT ename FROM Employee WHERE age > 50', company, 'ename', ['Bran', 'Evan', 'Evan']],
  ['intersect', "SELECT dept FROM Employee INTERSECT SELECT dept FROM Department WHERE floor = 2",
   company, 'dept', ['Sales', 'Marketing']],
  ['except', 'SELECT dept FROM Department EXCEPT SELECT dept FROM Employee', company, 'dept', ['Research']],
  ['scalar subquery', 'SELECT ename FROM Employee WHERE salary = (SELECT MAX(salary) FROM Employee)',
   company, 'ename', ['Ada']],
  ['in subquery', 'SELECT sname FROM Student WHERE sid IN (SELECT sid FROM Enrolled WHERE grade = \'A\')',
   school, 'sname', ['Nia', 'Pia', 'Quinn']],
  ['not in subquery', 'SELECT sname FROM Student WHERE sid NOT IN (SELECT sid FROM Enrolled WHERE grade = \'A\')',
   school, 'sname', ['Omar', 'Rey']],
  ['correlated exists', 'SELECT ename FROM Employee E WHERE EXISTS ' +
   '(SELECT * FROM WorksOn W WHERE W.eid = E.eid AND W.hours > 15)', company, 'ename', ['Cleo']],
  ['correlated not exists (for all)',
   'SELECT sname FROM Student S WHERE NOT EXISTS (SELECT * FROM Course C WHERE C.cdept = \'CS\' ' +
   'AND NOT EXISTS (SELECT * FROM Enrolled E WHERE E.sid = S.sid AND E.cid = C.cid))',
   school, 'sname', ['Nia', 'Pia']],
  ['derived table', 'SELECT dept FROM (SELECT dept, COUNT(*) AS n FROM Employee GROUP BY dept) AS g WHERE n > 2',
   company, 'dept', ['Engineering']],
  ['join a grouped result back', 'SELECT sname, n FROM Student NATURAL JOIN ' +
   '(SELECT sid, COUNT(*) AS n FROM Enrolled GROUP BY sid) AS c ORDER BY sname',
   school, 'sname,n', ['Nia|3', 'Omar|1', 'Pia|2', 'Quinn|2', 'Rey|1']],
  ['empty result', "SELECT ename FROM Employee WHERE dept = 'Legal'", company, 'ename', []],
  ['count over nothing', "SELECT COUNT(*) AS n FROM Employee WHERE dept = 'Legal'", company, 'n', ['0']],
  ['nested set ops keep their grouping',
   '(SELECT dept FROM Department EXCEPT SELECT dept FROM Employee) UNION SELECT dept FROM Employee WHERE age > 50',
   company, 'dept', ['Research', 'Sales']],
  ['with', 'WITH Pay AS (SELECT dept, AVG(salary) AS pay FROM Employee GROUP BY dept) ' +
   'SELECT dept FROM Pay WHERE pay > 60000', company, 'dept', ['Engineering', 'Sales']],
  ['with, named columns, read twice', 'WITH Load(pid, total) AS (SELECT pid, SUM(hours) FROM WorksOn GROUP BY pid) ' +
   'SELECT pid FROM Load WHERE total = (SELECT MAX(total) FROM Load)', company, 'pid', ['P1']],
  ['with, a later step reads an earlier one', 'WITH A AS (SELECT eid FROM WorksOn WHERE hours > 10), ' +
   'B AS (SELECT DISTINCT eid FROM A) SELECT ename FROM Employee NATURAL JOIN B', company, 'ename', ['Ada', 'Cleo', 'Dara']],
  ['with shadows a table', 'WITH Employee AS (SELECT ename FROM Employee WHERE age > 50) SELECT * FROM Employee',
   company, 'ename', ['Evan']],
  ['with inside a subquery', 'SELECT ename FROM Employee WHERE eid IN ' +
   '(WITH Big AS (SELECT eid FROM WorksOn WHERE hours > 15) SELECT eid FROM Big)', company, 'ename', ['Cleo']],
  ['view', "CREATE VIEW Directory AS SELECT eid, ename, dept FROM Employee; SELECT ename FROM Directory WHERE dept = 'Sales'",
   company, 'ename', ['Bran', 'Evan']],
  ['view over a view, then a cte', 'CREATE VIEW V1 AS SELECT eid, dept FROM Employee; ' +
   'CREATE VIEW V2 (d) AS SELECT DISTINCT dept FROM V1; WITH C AS (SELECT COUNT(*) AS n FROM V2) SELECT n FROM C',
   company, 'n', ['3']]
];

console.log('queries:');
CASES.forEach(([label, sql, database, attrs, rows]) => {
  let rel;
  try {
    rel = SQL.run(sql, database);
  } catch (e) {
    ok(label, false, 'threw "' + e.message + '"');
    return;
  }
  ok(label + ' (columns)', rel.attrs.join(',') === attrs, rel.attrs.join(',') + ' != ' + attrs);
  const got = rel.rows.map(row => rel.attrs.map(a => row[a]).join('|'));
  ok(label + ' (rows)', got.join('  ') === rows.join('  '), '\n      got ' + got.join('  ') + '\n      want ' + rows.join('  '));
});
console.log('  ' + CASES.length + ' cases');

/* Errors have to explain themselves: a student reads these more than the docs. */
const ERRORS = [
  ['no FROM table', 'SELECT * FROM Employes', company, /no table called "Employes"/],
  ['unknown column', 'SELECT enam FROM Employee', company, /no column "enam"/],
  ['ambiguous column', 'SELECT eid FROM Employee, WorksOn', company, /ambiguous/],
  ['same table twice', 'SELECT * FROM Employee, Employee', company, /used twice in FROM/],
  ['group by escapee', 'SELECT ename, COUNT(*) FROM Employee GROUP BY dept', company, /neither in GROUP BY/],
  ['aggregate in where', 'SELECT dept FROM Employee WHERE COUNT(*) > 2 GROUP BY dept', company, /that is what HAVING is for/],
  ['outer join', 'SELECT * FROM Employee LEFT JOIN WorksOn ON 1 = 1', company, /Outer joins are not part/],
  ['join without on', 'SELECT * FROM Employee JOIN WorksOn', company, /needs an ON condition/],
  ['missing select', 'FROM Employee', company, /starts with SELECT/],
  ['unclosed paren', 'SELECT * FROM (SELECT * FROM Employee AS e', company, /closing "\)"/],
  ['star with group by', 'SELECT * FROM Employee GROUP BY dept', company, /cannot be grouped/],
  ['multi-column subquery', 'SELECT * FROM Employee WHERE eid IN (SELECT eid, pid FROM WorksOn)', company,
   /must return exactly one/],
  ['unknown function', 'SELECT UPPER(ename) FROM Employee', company, /no function "UPPER"/],
  ['with without a body', 'WITH A AS (SELECT * FROM Employee)', company, /After the WITH comes the query/],
  ['with without parens', 'WITH A AS SELECT * FROM Employee SELECT * FROM A', company, /"\(" around the query/],
  ['cte column count', 'WITH A(x, y) AS (SELECT eid FROM Employee) SELECT * FROM A', company, /names 2 column/],
  ['cte column clash', 'WITH A AS (SELECT X.eid, Y.eid FROM Employee X, Employee Y) SELECT * FROM A', company,
   /two columns called "eid"/],
  ['view without semicolon', 'CREATE VIEW V AS SELECT eid FROM Employee SELECT * FROM V', company, /semicolon/],
  ['view on its own', 'CREATE VIEW V AS SELECT eid FROM Employee;', company, /follow it with a query/],
  ['view named like a table', 'CREATE VIEW Employee AS SELECT eid FROM Employee; SELECT * FROM Employee', company,
   /already a table called "Employee"/],
  ['create table', 'CREATE TABLE T AS SELECT eid FROM Employee; SELECT * FROM T', company, /Only CREATE VIEW/],
  ['view after the query', 'SELECT * FROM Employee; CREATE VIEW V AS SELECT eid FROM Employee;', company,
   /goes before the query/]
];

console.log('errors:');
ERRORS.forEach(([label, sql, database, pattern]) => {
  try {
    SQL.run(sql, database);
    ok(label, false, 'no error raised');
  } catch (e) {
    ok(label, pattern.test(e.message), 'message was "' + e.message + '"');
  }
});
console.log('  ' + ERRORS.length + ' messages');

/* Every level's algebra solution must translate into SQL that runs and gives
   the same answer — that is what makes the "As SQL" line trustworthy. */
console.log('translation:');
let translated = 0;
GAME.LEVELS.forEach((level, i) => {
  if (!level.solution) return;                 // a SQL-only level has no algebra to render
  const data = db(level.db);
  const expected = RA.evaluate(level.solution, data);
  const sql = SQL.fromTree(level.solution, data);
  if (!sql) { ok('level ' + (i + 1) + ' translates', false, 'fromTree returned null'); return; }
  let got;
  try {
    got = SQL.run(sql, data);
  } catch (e) {
    ok('level ' + (i + 1) + ' runs', false, e.message + '\n--- ' + sql.replace(/\n/g, '\n    '));
    return;
  }
  const verdict = RA.compare(got, expected, {});
  ok('level ' + (i + 1) + ' agrees', verdict.ok, (verdict.message || '') + '\n--- ' + sql.replace(/\n/g, '\n    '));
  translated++;
});
console.log('  ' + translated + '/' + GAME.LEVELS.filter(l => l.solution).length + ' algebra solutions rendered as SQL');

/* And every level's own SQL answer must run; where the level also has an
   algebra answer the two must agree, row for row. */
console.log('level SQL:');
let withSql = 0;
GAME.LEVELS.forEach((level, i) => {
  const label = 'level ' + (i + 1);
  if (!level.sql) {
    ok(label + ' has some answer', !!level.solution, 'neither an algebra nor a SQL solution');
    return;
  }
  withSql++;
  const data = db(level.db);
  let got;
  try {
    got = SQL.run(level.sql.solution, data);
  } catch (e) {
    ok(label + ' sql runs', false, e.message);
    return;
  }
  ok(label + ' sql returns rows', got.rows.length > 0, 'the reference answer is empty');
  ok(label + ' hints are strings', (level.sql.hints || []).every(h => typeof h === 'string'));
  ok(label + ' sql is ordered as declared', !!level.sql.ordered === !!got.ordered,
     level.sql.ordered ? 'declared ordered but the query has no ORDER BY' : 'has ORDER BY but is not declared ordered');
  if (!level.solution) return;
  const expected = RA.evaluate(level.solution, data);
  // multiset, not set: if the reference answer repeats a row the algebra cannot
  // match it, and the level would be unsolvable in one of the two languages.
  const verdict = RA.compare(got, expected, { multiset: true });
  ok(label + ' sql matches the algebra', verdict.ok, verdict.message);
});
console.log('  ' + withSql + '/' + GAME.LEVELS.length + ' levels carry a SQL answer');

/* And back the other way: a SQL answer with an algebra form must read back as a
   tree that answers the same question, and the rest must refuse with a reason
   rather than crash or — worse — quietly return the wrong tree. */
console.log('back to algebra:');
let readBack = 0;
const refused = [];
GAME.LEVELS.forEach((level, i) => {
  const data = db(level.db);
  let tree;
  try {
    tree = SQL.toTree(level.sql.solution, data);
  } catch (e) {
    ok('level ' + (i + 1) + ' refusal explains itself', !!e.noAlgebra, 'threw "' + e.message + '"');
    refused.push('  ' + (i + 1) + '. ' + level.title.padEnd(30) + e.message.replace(/ has no counterpart.*$/, ''));
    return;
  }
  readBack++;
  const verdict = RA.compare(RA.evaluate(tree, data), SQL.run(level.sql.solution, data), {});
  ok('level ' + (i + 1) + ' reads back', verdict.ok, verdict.message + ' — ' + RA.toText(tree));
});
console.log('  ' + readBack + '/' + GAME.LEVELS.length + ' SQL answers read back as algebra; the rest say why not:');
refused.forEach(line => console.log(line));

/* A level that rules a construction in or out must be solvable by its own answer,
   and the detector has to tell a subquery from a named query. */
console.log('rules:');
const FEATURES = [
  ['SELECT * FROM Employee', ''],
  ['SELECT ename FROM Employee WHERE eid IN (SELECT eid FROM WorksOn)', 'subquery'],
  ['SELECT * FROM (SELECT eid FROM Employee) AS t', 'subquery'],
  ['SELECT dept, (SELECT COUNT(*) FROM Employee) FROM Department', 'subquery'],
  ['SELECT * FROM Employee E JOIN Department D ON EXISTS (SELECT * FROM WorksOn)', 'subquery'],
  ['WITH A AS (SELECT eid FROM Employee) SELECT * FROM A', 'with'],
  ['WITH A AS (SELECT eid FROM Employee WHERE eid IN (SELECT eid FROM WorksOn)) SELECT * FROM A', 'subquery,with'],
  ['CREATE VIEW V AS SELECT eid FROM Employee; SELECT * FROM V', 'view'],
  ['CREATE VIEW V AS SELECT eid FROM Employee; WITH A AS (SELECT * FROM V) SELECT * FROM A', 'with,view']
];
FEATURES.forEach(([sql, want]) => {
  const f = SQL.features(sql);
  const got = Object.keys(f).filter(k => f[k]).join(',');
  ok('features of ' + sql, got === want, got + ' != ' + want);
});
let ruled = 0;
GAME.LEVELS.forEach((level, i) => {
  const sql = level.sql || {};
  if (!sql.require && !sql.forbid) return;
  ruled++;
  const f = SQL.features(sql.solution);
  (sql.require || []).forEach(k => ok('level ' + (i + 1) + ' answer uses ' + k, f[k]));
  (sql.forbid || []).forEach(k => ok('level ' + (i + 1) + ' answer avoids ' + k, !f[k]));
});
console.log('  ' + FEATURES.length + ' detections, ' + ruled + ' levels with rules');

/* The answer a student is checked against, in each language. */
console.log('shapes:');
GAME.LEVELS.forEach((level, i) => {
  const data = db(level.db);
  const rel = SQL.run(level.sql.solution, data);
  const name = (i + 1) + '. ' + level.title;
  console.log('  ' + name.padEnd(34) + rel.attrs.join(',').padEnd(26) +
              rel.rows.length + ' row' + (rel.rows.length === 1 ? '' : 's') +
              (level.sql.ordered ? ' (ordered)' : '') + (level.solution ? '' : ' [SQL only]'));
});

console.log(failures ? '\nSQL TEST FAILED (' + failures + ')' : '\nSQL TEST PASSED');
process.exit(failures ? 1 : 0);
