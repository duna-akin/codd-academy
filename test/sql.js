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
   company, 'dept', ['Research', 'Sales']]
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
  ['unknown function', 'SELECT UPPER(ename) FROM Employee', company, /no function "UPPER"/]
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
