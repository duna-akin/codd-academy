# Relational Algebra Playground
![demo](image.png)

An interactive game for learning relational algebra. You are shown a set of relations and asked a
question in English; you answer by dragging operator symbols (π, σ, ρ, ∪, ∩, −, ×, ⋈, ÷) onto a
canvas to build a query tree. The query is evaluated for real against the data as you build it, and
checked against the expected answer.

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
- Solving a level without hints earns ★; solving it after a hint or the solution earns ✓. Progress
  is kept in `localStorage`.

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
    src/levels.js            the two databases and the 16 puzzles (each solution is an expression tree)
    src/app.js               UI: drag and drop, tree editing, live evaluation, progress
    test/smoke.js            end-to-end test that drives the real UI in jsdom

## Tests

    npm install      # jsdom, for the smoke test only — the game itself has no dependencies
    npm test         # builds, then drives the built index.html

The smoke test boots the page, places nodes by click and by drop, checks a wrong answer and a
broken condition, then solves all 16 levels through the UI and asserts there are no console errors.
Point it at any copy of the built file to prove that copy stands alone:

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
  tip: 'Shown under the question.',
  hints: ['Revealed one at a time.'],
  checkNames: true,                // optional: require exact column names
  solution: op('project', 'ename', [op('select', 'salary > 60000', [rel('Employee')])])
}
```

The expected answer is computed by running that tree through the engine, so a level can never drift
out of sync with its own solution.
