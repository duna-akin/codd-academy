# Relational Algebra Playground

![The playground mid-puzzle: an operator palette and the Student and Course tables down the left, a query tree of π, ⋈, ÷ and σ nodes on the canvas, the same query rendered in standard notation beneath it, and the result table below that.](docs/screenshot.png)

<sub>Solving the division puzzle: every student who has taken every CS course.</sub>

An interactive game for learning relational algebra **and SQL**. You are shown a set of relations and
asked a question in English; you answer either by dragging operator symbols (π, σ, ρ, ∪, ∩, −, ×, ⋈,
÷) onto a canvas to build a query tree, or by writing the query in SQL. The query is evaluated for
real against the data as you type, and checked against the expected answer.

Most questions can be answered in either language, and the switch above the canvas changes the
language without changing the question — *answer this same thing the other way* is the exercise the
two halves of a database course exist to set up.

## Running it

Open `index.html` in a browser — double-click it, or:

    xdg-open index.html

`index.html` is fully self-contained (CSS and JS inlined, no external requests), so it also works
from a USB stick, over a file share, or in a sandboxed browser. If your browser is installed via
Flatpak or Snap, opening a file through the desktop portal grants access to *that one file only* —
which is why a page split across `styles.css` and `js/*.js` renders unstyled and inert there. The
single file sidesteps that entirely.

Serving it over HTTP also works, and is the other way around a sandboxed browser:

    npm run serve                # then visit http://localhost:8080

## How the game works

- **Build by dragging.** Drag a relation or an operator from the left panel into a slot on the
  canvas. Clicking a chip and then clicking a slot works too (handy on touch screens).
- **Dropping onto a filled node wraps it**, so you can build a query outside-in or inside-out.
- **Deleting an operator promotes its first input**, so you can peel layers off without starting over.
- **Operator parameters** are typed inline: the attribute list for π, the condition for σ, the new
  name for ρ, an optional theta condition for ⋈.
- The **expression** line shows the query in standard notation, and the **result** table updates on
  every keystroke, including a plain-English error when the query does not typecheck.
- **Check answer** compares your result to the expected relation. Column order does not matter
  (relations are unordered sets of attributes); the rename level additionally checks column names.
- **Type it instead, if you prefer.** The *Type it* box under the canvas accepts standard notation,
  and the two stay in sync: typing rebuilds the tree, dragging rewrites the text. See
  [Typing expressions](#typing-expressions).
- **Or answer in SQL.** The **Algebra / SQL** switch above the canvas swaps the editor: the operator
  palette becomes a palette of clauses, and you write a query instead of building a tree. Switching
  brings your query with you, translated, in either direction. Progress is kept per language, so
  every level can be earned twice. See [SQL](#sql).
- **Hide the result to work blind.** The live result table is a fine teaching aid and a bad crutch,
  so the **Result** header collapses it. Errors stay visible while it is hidden — whether a query is
  *valid* is not the same as what its answer is — but the table and the row count go away, and
  **Check answer** still works. The choice is remembered.
- **Every level is open from the start.** Nothing has to be unlocked — click any level in the bar at
  the top and go straight to it. Collapse that bar with the **Levels** header when you want the room;
  it remembers whether you left it open.
- Solving a level without hints earns ★; solving it after a hint or the solution earns ✓. Progress
  is kept in `localStorage`.

## The levels

Forty-three puzzles in seven chapters. Levels 1–37 can be answered in either language; 38–43 are SQL
only, because the algebra has no way to ask them.

| Chapter | Levels | What it teaches |
| --- | --- | --- |
| Basics | 1–6 | a bare relation, π, σ, compound conditions — `SELECT`, `FROM`, `WHERE` |
| Set operations | 7–10 | ρ, ∪, −, ∩ and union compatibility — `AS`, `UNION`, `EXCEPT`, `INTERSECT` |
| Joins | 11–13 | natural joins across three relations, filtering around them, and the first level where SQL needs a `DISTINCT` the algebra did not |
| Products and division | 14–16 | ρ + × to compare a relation with itself, ÷ for "for all" — and the `NOT EXISTS` inside a `NOT EXISTS` that SQL uses instead |
| Advanced | 17–25 | theta joins, self-joins for "at least two" and "exactly one", max without aggregation, "only", division by a derived relation, universal quantification by double negation |
| Aggregation | 26–37 | `ℱ` with and without grouping, several functions at once, WHERE vs HAVING, aggregating a join, and joining a grouped result back to find *which* row hit the maximum |
| SQL only | 38–43 | duplicate rows, `ORDER BY`, `LIMIT`, computed columns, `COUNT(DISTINCT …)` |

The advanced chapter is where relational algebra stops being a notation for SQL and starts being a
logic: with no aggregation and no counting, `MAX` becomes "nobody beats me", `only` becomes "has no
counterexample", and `for all` becomes either ÷ or a difference of two differences. Those levels are
worth doing in both languages, because SQL's shortcut and the logic underneath it are two different
lessons — the hints offer both, and either answer is accepted.

## Typing expressions

Anything you can drag, you can type — the text box and the canvas edit one tree, so switching
between them mid-query is fine. Unfilled slots show up as `?`.

### Tab completion

You never have to find the Greek keys. Type a few letters and press <kbd>Tab</kbd>:

| You type | Tab gives you |
| --- | --- |
| `proj` | `π_{}()` with the cursor between the braces |
| `sel` | `σ_{}()` |
| `ren` | `ρ_{}()` |
| `un`, `int`, `min`, `prod`, `div`, `join` | `∪ ∩ − × ÷ ⋈` |
| `group` | `ℱ_{}()` |
| `cou`, `su`, `av` … *inside* `{}` | `COUNT()`, `SUM()`, `AVG()` |

The menu knows where the cursor is: **inside** `{}` it offers attribute names, **outside** it offers
relation names and operators. With no menu open, <kbd>Tab</kbd> jumps to the next empty spot in the
expression, so the whole of level 2 is:

    proj ⇥ ena ⇥ ⇥ Emp ⇥          →  π_{ename}(Employee)

<kbd>↑</kbd>/<kbd>↓</kbd> move through the menu, <kbd>Esc</kbd> dismisses it, <kbd>Enter</kbd>
checks your answer. Typing a `)` or `}` that is already there steps over it rather than doubling it,
and a half-finished snippet such as `π_{}()` still draws on the canvas — the empty parentheses are
an unfilled slot, exactly like `?`. Syntax errors stay quiet until you stop typing.

    π_{ename}(σ_{salary > 60000}(Employee))
    π_{ename, pname}((Employee ⋈ WorksOn) ⋈ Project)
    Department ⋈_{head = eid} Employee

Every operator has an ASCII spelling, so no Greek keyboard is needed:

| Operator | Symbol | Also accepted |
| --- | --- | --- |
| project | `π` | `project`, `pi` |
| select | `σ` | `select`, `sigma` |
| rename | `ρ` | `rename`, `rho` |
| union | `∪` | `union` |
| intersect | `∩` | `intersect` |
| difference | `−` | `-`, `minus`, `difference`, `except` |
| product | `×` | `*`, `product`, `times`, `cross` |
| join | `⋈` | `join`, `\|><\|`, `\|x\|` |
| divide | `÷` | `/`, `divide` |
| aggregate | `ℱ` | `F`, `group`, `aggregate` |

Parameters go in `_{...}`, `{...}` or `[...]`; the bare form `π_ename(R)` works too, but a condition
containing parentheses needs the braces. Binary operators bind tighter for `× ⋈ ÷` than for
`∪ ∩ −`, and everything is left-associative — the canvas always shows exactly how your text was
grouped, which is the quickest way to check you meant what you wrote.

## SQL

The **SQL** half of the switch replaces the canvas with a query editor and the operator palette with
the clauses. The question does not change; only the language you answer it in does. Your answer is
checked by running it, so *any* query that returns the right table is right — there is no expected
text to match.

Two things are checked more strictly than in the algebra, because they are the two things SQL has
that a relation does not:

- **Duplicate rows count.** `SELECT sname FROM Student NATURAL JOIN Enrolled WHERE grade = 'A'`
  returns Nia twice, and the game says so: *the right rows, but 4 of them where the answer has 3 —
  some rows repeat. Did you mean SELECT DISTINCT?*
- **Row order counts, on the levels that ask for it.** Level 39 onwards check the rows in the order
  you return them, so an `ORDER BY` that sorts the wrong way is wrong.

Supported: `SELECT` / `DISTINCT`, `FROM` with aliases, `JOIN … ON`, `JOIN … USING`, `NATURAL JOIN`,
`CROSS JOIN` and the comma join, `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY … ASC/DESC`, `LIMIT` /
`OFFSET`, `UNION` / `UNION ALL` / `INTERSECT` / `EXCEPT`, subqueries in `FROM`, and subqueries in a
condition with `IN`, `NOT IN`, `EXISTS`, `NOT EXISTS` or as a single value — correlated to the outer
query or not. Conditions also take `BETWEEN`, `LIKE` (with `%` and `_`) and arithmetic. The aggregate
functions are `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, plus `COUNT(*)` and `COUNT(DISTINCT x)`.

Outer joins and `NULL` are deliberately absent: every join here is an inner join, and saying so
plainly beats a half-implemented three-valued logic.

<kbd>Tab</kbd> completes clauses, table names and column names the same way it does in the *Type it*
box. Since a query is several lines, <kbd>Enter</kbd> is a newline and
<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> checks your answer.

### Switching language carries the query with it

Toggle to SQL and the tree you built is written out as a query; toggle back and your query is read
back as a tree. `π_{ename}(σ_{salary > 60000}(Employee))` and

```sql
SELECT DISTINCT ename
FROM Employee
WHERE salary > 60000
```

are two views of one thing, and the switch moves you between them.

Nothing you wrote yourself is ever overwritten. A query only crosses when the other editor is empty
or still holds exactly what it was last handed, so editing one side and toggling updates the other,
while editing *both* leaves them alone and says so. A query that came across counts as help, so the
level is worth ✓ rather than ★ until you write it yourself.

Both directions are checked before you see them: the game runs the translation it just wrote and
compares it with the original's answer, so a translation that quietly disagreed is refused rather
than shown. `npm test` checks all 43 levels through both translations.

**Some queries cannot cross, and that refusal is the lesson.** The algebra has no `ORDER BY`, no
`LIMIT`, no computed columns, no `COUNT(DISTINCT …)`, and — the interesting one — no way to put a
subquery inside a condition:

> `EXISTS` has no counterpart in the algebra — σ only compares attributes and values, so this one
> has to be built out of ⋈, − or ÷.

That is exactly the boundary the advanced chapter is about. Thirty of the forty-three levels'
SQL answers read back as algebra; the thirteen that do not are 15, 16, 18, 21, 22, 23, 25 and 37
(all subqueries) and the SQL-only chapter.

Under the canvas, **The same query in SQL** shows the translation without leaving the algebra, and
**Write it in SQL ›** puts it in the editor even when the editor already has something in it.

## Colors

The interface uses Lafayette College's palette: PMS 202 maroon `#822433` with the web palette's
`#65001C`, `#910029`, light blue `#4EA8D8`, warm gray `#A2998B` and pale gray `#E8E6E2`. On the dark
ground the brand maroon is too dark to read as text, so `--accent` is a tint of it and the solid
maroons are used as fills behind white. All of it lives in the `:root` block of `src/styles.css`.

## Aggregation

`ℱ` is written with the grouping attributes on its **left** and the function list on its **right**,
following Elmasri & Navathe:

    dept ℱ_{COUNT(eid), AVG(salary)}(Employee)     one row per department
    ℱ_{MIN(salary), MAX(salary)}(Employee)         no grouping: one row for everything

`COUNT`, `SUM`, `AVG` (or `AVERAGE`), `MIN` and `MAX` are available, and `COUNT(*)` counts rows.
Output columns are named after the call — `COUNT(eid)` becomes `COUNT_eid`, and `COUNT(*)` becomes
`COUNT` — so they are ordinary attributes afterwards, which is how you filter groups:

    π_{dept}(σ_{COUNT_eid > 2}(dept ℱ_{COUNT(eid)}(Employee)))

That is the relational-algebra spelling of SQL's `HAVING`. Note that groups are built only from rows
that exist: a course nobody is enrolled in contributes no rows to `Enrolled`, so it has no group and
never appears in the result.

## Conditions

`salary > 60000`, `dept = 'Sales'`, `A.eid < B.eid`, combined with `AND` / `OR` / `NOT` and
parentheses. The symbols `∧ ∨ ¬ && || !` work too. Text values must be quoted. Comparisons are
`= <> != < <= > >=`.

## Layout

Edit the files in `src/`, then run `npm run build` to regenerate `index.html`.

    index.html               BUILT — do not edit by hand; regenerate with `npm run build`
    build.js                 inlines src/ into the single-file index.html
    src/index.template.html  markup, with placeholders for the inlined CSS and JS
    src/styles.css           all styling
    src/engine.js            relational algebra engine: relations, operators, condition parser, checking
    src/sql.js               SQL engine over the same relations, and the translation both ways
    src/levels.js            the two databases and the 43 puzzles (each with an algebra and/or a SQL answer)
    src/app.js               UI: drag and drop, tree editing, the SQL editor, live evaluation, progress
    test/sql.js              unit test for the SQL engine and every level's two answers
    test/smoke.js            end-to-end test that drives the real UI in jsdom

## Tests

    npm install      # jsdom, for the smoke test only — the game itself has no dependencies
    npm test         # builds, runs the SQL unit test, then drives the built index.html

`test/sql.js` runs the SQL engine against a battery of queries and error messages, renders all 37
algebra solutions as SQL, reads all 43 SQL answers back as algebra, checks that every translation
still returns the same table, and checks every level's SQL answer against its algebra twin row for
row — so a level can never mean two different things in its two languages. It prints the levels whose
SQL has no algebra form, with the reason, which is a useful map of where the two languages part.

The smoke test boots the page, places nodes by click and by drop, checks a wrong answer and a broken
condition, exercises tab completion in both editors, then solves every level through the UI in every
language it can be asked in — 37 in the algebra and 43 in SQL — and asserts there are no console
errors. Point it at any copy of the built file to prove that copy stands alone:

    node test/smoke.js /some/other/place/index.html

## Adding a level

Append to `LEVELS` in `src/levels.js`, then `npm run build`. Solutions are expression trees built with the `rel()` and
`op()` helpers, e.g.

```js
{
  db: 'company',
  title: 'Filter, then project',
  question: 'Return the names of employees who earn more than 60000.',
  focus: ['project'],              // marks the operator "new" in the palette
  chapter: 'Basics',               // optional: starts a new row in the level bar
  tip: 'Shown under the question.',
  hints: ['Revealed one at a time.'],
  checkNames: true,                // optional: require exact column names
  solution: op('project', 'ename', [op('select', 'salary > 60000', [rel('Employee')])]),
  sql: {
    tip: 'The same level told in SQL; question: overrides the English too, if it has to.',
    focus: ['WHERE'],              // marks the clause "new" in the palette
    ordered: true,                 // optional: check the rows in the order they come back
    hints: ['Its own hints.'],
    solution: 'SELECT ename\n' +
              'FROM Employee\n' +
              'WHERE salary > 60000'
  }
}
```

Both expected answers are computed by running the stored solutions, so a level can never drift out
of sync with its own answer. Leave out `sql` and the level is algebra-only; leave out `solution` and
it is SQL-only, and then `raNote:` explains to the reader why (`sqlNote:` does the same the other way
round). `npm test` will tell you if the two answers disagree.
