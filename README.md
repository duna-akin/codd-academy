# Relational Algebra Playground

An interactive game for learning relational algebra. You are shown a set of relations and asked a
question in English; you answer by dragging operator symbols (π, σ, ρ, ∪, ∩, −, ×, ⋈, ÷) onto a
canvas to build a query tree. The query is evaluated for real against the data as you build it, and
checked against the expected answer.

## Running it

Open `index.html` in a browser. There is no build step and no server required.

    xdg-open index.html          # or just double-click the file

To run it over HTTP instead: `npm run serve`, then visit http://localhost:8080.

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
- Solving a level without hints earns ★; solving it after a hint or the solution earns ✓. Progress
  is kept in `localStorage`.

## Conditions

`salary > 60000`, `dept = 'Sales'`, `A.eid < B.eid`, combined with `AND` / `OR` / `NOT` and
parentheses. The symbols `∧ ∨ ¬ && || !` work too. Text values must be quoted. Comparisons are
`= <> != < <= > >=`.

## Layout

    index.html       markup
    styles.css       all styling
    js/engine.js     relational algebra engine: relations, operators, condition parser, answer checking
    js/levels.js     the two databases and the 16 puzzles (each solution is an expression tree)
    js/app.js        UI: drag and drop, tree editing, live evaluation, progress
    test/smoke.js    end-to-end test that drives the real UI in jsdom

## Tests

    npm install      # jsdom, for the smoke test only — the game itself has no dependencies
    npm test

The smoke test boots the page, places nodes by click and by drop, checks a wrong answer and a
broken condition, then solves all 16 levels through the UI and asserts there are no console errors.

## Adding a level

Append to `LEVELS` in `js/levels.js`. Solutions are expression trees built with the `rel()` and
`op()` helpers, e.g.

```js
{
  db: 'company',
  title: 'Filter, then project',
  question: 'Return the names of employees who earn more than 60000.',
  focus: ['project'],              // marks the operator "new" in the palette
  tip: 'Shown under the question.',
  hints: ['Revealed one at a time.'],
  checkNames: true,                // optional: require exact column names
  solution: op('project', 'ename', [op('select', 'salary > 60000', [rel('Employee')])])
}
```

The expected answer is computed by running that tree through the engine, so a level can never drift
out of sync with its own solution.
