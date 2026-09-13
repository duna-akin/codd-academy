/* Databases and puzzles. Each solution is an expression tree, so the game can
   both compute the expected answer and drop the solution onto the canvas. */
(function (global) {
  'use strict';

  var R = global.RA.relation;

  function rel(name) { return { type: 'rel', name: name }; }
  function op(name, param, children, group) {
    return { type: 'op', op: name, param: param || '', group: group || '', children: children };
  }

  var DATABASES = {
    company: {
      label: 'Acme Corp',
      blurb: 'Employees, the departments they sit in, and the projects they bill hours to.',
      relations: [
        R('Employee', ['eid', 'ename', 'dept', 'salary', 'age'], [
          ['E1', 'Ada',  'Engineering', 95000, 34],
          ['E2', 'Bran', 'Sales',       52000, 28],
          ['E3', 'Cleo', 'Engineering', 72000, 45],
          ['E4', 'Dara', 'Marketing',   61000, 31],
          ['E5', 'Evan', 'Sales',       78000, 52],
          ['E6', 'Fay',  'Engineering', 58000, 26],
          ['E7', 'Gus',  'Marketing',   49000, 41]
        ]),
        R('Department', ['dept', 'head', 'floor'], [
          ['Engineering', 'E1', 3],
          ['Sales',       'E5', 2],
          ['Marketing',   'E4', 2],
          ['Research',    'E3', 4]
        ]),
        R('Project', ['pid', 'pname', 'budget'], [
          ['P1', 'Atlas',  120000],
          ['P2', 'Beacon',  45000],
          ['P3', 'Comet',  250000]
        ]),
        R('WorksOn', ['eid', 'pid', 'hours'], [
          ['E1', 'P1', 12],
          ['E1', 'P2',  8],
          ['E1', 'P3',  5],
          ['E3', 'P1', 20],
          ['E3', 'P3', 10],
          ['E4', 'P2', 15],
          ['E5', 'P1',  6],
          ['E5', 'P2',  9],
          ['E5', 'P3',  3],
          ['E6', 'P2',  4]
        ])
      ]
    },

    school: {
      label: 'Northfield University',
      blurb: 'Students, the courses on offer, and who is enrolled in what.',
      relations: [
        R('Student', ['sid', 'sname', 'major', 'year'], [
          ['S1', 'Nia',   'CS',      2],
          ['S2', 'Omar',  'Math',    1],
          ['S3', 'Pia',   'CS',      3],
          ['S4', 'Quinn', 'Physics', 2],
          ['S5', 'Rey',   'CS',      1]
        ]),
        R('Course', ['cid', 'title', 'cdept', 'credits'], [
          ['C1', 'Databases',  'CS',      4],
          ['C2', 'Algorithms', 'CS',      3],
          ['C3', 'Calculus',   'Math',    4],
          ['C4', 'Optics',     'Physics', 3],
          ['C5', 'Topology',   'Math',    3]
        ]),
        R('Enrolled', ['sid', 'cid', 'grade'], [
          ['S1', 'C1', 'A'],
          ['S1', 'C2', 'B'],
          ['S1', 'C3', 'A'],
          ['S2', 'C3', 'B'],
          ['S3', 'C1', 'B'],
          ['S3', 'C2', 'A'],
          ['S4', 'C4', 'C'],
          ['S4', 'C1', 'A'],
          ['S5', 'C2', 'C']
        ])
      ]
    }
  };

  var LEVELS = [
    {
      db: 'company',
      chapter: 'Basics',
      title: 'The whole table',
      question: 'Return every employee, with all of their details.',
      focus: [],
      tip: 'A bare relation is already a valid query. Drag <b>Employee</b> onto the canvas.',
      hints: [
        'You do not need an operator at all for this one.',
        'Relations live in the left panel — drag the Employee chip into the empty slot.',
        'Or type it: put Employee in the <i>Type it</i> box under the canvas.'
      ],
      solution: rel('Employee')
    },
    {
      db: 'company',
      title: 'Just the names',
      question: 'Return only the names of all employees.',
      focus: ['project'],
      tip: '<b>π</b> (project) keeps the columns you list and throws the rest away.',
      hints: [
        'Wrap Employee in a π.',
        'The attribute you want is called ename.',
        'π<sub>ename</sub>(Employee)'
      ],
      solution: op('project', 'ename', [rel('Employee')])
    },
    {
      db: 'company',
      title: 'Filtering rows',
      question: 'Return the full records of every employee in the Engineering department.',
      focus: ['select'],
      tip: "<b>σ</b> (select) keeps rows matching a condition. Text values need quotes: dept = 'Sales'.",
      hints: [
        'σ goes around Employee, and the condition compares dept to a quoted string.',
        "σ<sub>dept = 'Engineering'</sub>(Employee)"
      ],
      solution: op('select', "dept = 'Engineering'", [rel('Employee')])
    },
    {
      db: 'company',
      title: 'Filter, then project',
      question: 'Return the names of employees who earn more than 60000.',
      focus: [],
      tip: 'Operators nest: filter first, then project the result.',
      hints: [
        'You need both σ and π. Filter the rows before you drop the salary column.',
        'Drop π on the canvas first, then σ inside it, then Employee inside that.',
        'π<sub>ename</sub>(σ<sub>salary &gt; 60000</sub>(Employee))'
      ],
      solution: op('project', 'ename', [op('select', 'salary > 60000', [rel('Employee')])])
    },
    {
      db: 'company',
      title: 'Two conditions',
      question: 'Return the name and salary of every Engineering employee under 40.',
      focus: [],
      tip: 'Conditions combine with AND, OR and NOT — and with parentheses when you need them.',
      hints: [
        'One σ can hold both tests joined by AND.',
        "π<sub>ename, salary</sub>(σ<sub>dept = 'Engineering' AND age &lt; 40</sub>(Employee))"
      ],
      solution: op('project', 'ename, salary', [
        op('select', "dept = 'Engineering' AND age < 40", [rel('Employee')])
      ])
    },
    {
      db: 'company',
      title: 'Either one',
      question: 'Return the ids of employees who work in Sales or in Marketing.',
      focus: [],
      tip: 'OR inside a single σ is usually simpler than a union of two queries.',
      hints: [
        "A single σ with OR does it: dept = 'Sales' OR dept = 'Marketing'.",
        "π<sub>eid</sub>(σ<sub>dept = 'Sales' OR dept = 'Marketing'</sub>(Employee))"
      ],
      solution: op('project', 'eid', [
        op('select', "dept = 'Sales' OR dept = 'Marketing'", [rel('Employee')])
      ])
    },
    {
      db: 'company',
      chapter: 'Set operations',
      title: 'Renaming things',
      question: 'Build a relation called <b>Roster</b> whose two columns are named <b>id</b> and <b>person</b>, ' +
               'holding every employee id and name.',
      focus: ['rename'],
      tip: '<b>ρ</b> (rename) takes <code>NewName</code> or <code>NewName(a, b, …)</code>. This level checks column names.',
      checkNames: true,
      hints: [
        'Project the two columns first, then rename the result.',
        'ρ takes the form Roster(id, person) — the attribute list is positional.',
        'ρ<sub>Roster(id, person)</sub>(π<sub>eid, ename</sub>(Employee))'
      ],
      solution: op('rename', 'Roster(id, person)', [op('project', 'eid, ename', [rel('Employee')])])
    },
    {
      db: 'company',
      title: 'Pooling two relations',
      question: 'Return every department name that appears anywhere — whether it has employees in it, ' +
               'a row in Department, or both.',
      focus: ['union'],
      tip: '<b>∪</b> needs both sides to have the same shape, so project each side down to one column first.',
      hints: [
        'Project dept out of Employee, project dept out of Department, then union them.',
        'Research has no employees, so it can only come from Department.',
        'π<sub>dept</sub>(Employee) ∪ π<sub>dept</sub>(Department)'
      ],
      solution: op('union', '', [
        op('project', 'dept', [rel('Employee')]),
        op('project', 'dept', [rel('Department')])
      ])
    },
    {
      db: 'company',
      title: 'The ones that are missing',
      question: 'Return the ids of employees who are not working on any project.',
      focus: ['difference'],
      tip: '<b>−</b> is how relational algebra says "not". Take all ids, subtract the busy ones.',
      hints: [
        'Every employee id, minus every id that appears in WorksOn.',
        'Both sides must be a single eid column.',
        'π<sub>eid</sub>(Employee) − π<sub>eid</sub>(WorksOn)'
      ],
      solution: op('difference', '', [
        op('project', 'eid', [rel('Employee')]),
        op('project', 'eid', [rel('WorksOn')])
      ])
    },
    {
      db: 'company',
      title: 'In both lists',
      question: 'Return the departments that are on floor 2 <i>and</i> have at least one employee older than 40.',
      focus: ['intersect'],
      tip: '<b>∩</b> keeps rows present on both sides. Filter each side separately, then intersect.',
      hints: [
        'Left: departments on floor 2. Right: departments of employees over 40.',
        'Project both sides down to dept so they are union-compatible.',
        'π<sub>dept</sub>(σ<sub>floor = 2</sub>(Department)) ∩ π<sub>dept</sub>(σ<sub>age &gt; 40</sub>(Employee))'
      ],
      solution: op('intersect', '', [
        op('project', 'dept', [op('select', 'floor = 2', [rel('Department')])]),
        op('project', 'dept', [op('select', 'age > 40', [rel('Employee')])])
      ])
    },
    {
      db: 'company',
      chapter: 'Joins',
      title: 'Connecting relations',
      question: 'Return each employee name paired with the name of every project they work on.',
      focus: ['join'],
      tip: '<b>⋈</b> with no condition is a natural join: it matches rows on the attributes both sides share.',
      hints: [
        'Employee and WorksOn share eid; WorksOn and Project share pid.',
        'Join all three relations, then project the two name columns.',
        'π<sub>ename, pname</sub>((Employee ⋈ WorksOn) ⋈ Project)'
      ],
      solution: op('project', 'ename, pname', [
        op('join', '', [op('join', '', [rel('Employee'), rel('WorksOn')]), rel('Project')])
      ])
    },
    {
      db: 'company',
      title: 'Join and filter',
      question: 'Return the employee name and project name for every assignment of more than 10 hours.',
      focus: [],
      tip: 'You can filter before or after a join — the answer is the same, the work is not.',
      hints: [
        'Join the three relations, then σ on hours, then project.',
        'π<sub>ename, pname</sub>(σ<sub>hours &gt; 10</sub>((Employee ⋈ WorksOn) ⋈ Project))'
      ],
      solution: op('project', 'ename, pname', [
        op('select', 'hours > 10', [
          op('join', '', [op('join', '', [rel('Employee'), rel('WorksOn')]), rel('Project')])
        ])
      ])
    },
    {
      db: 'school',
      title: 'A new database',
      question: 'Return the names of students who earned an A in at least one course.',
      focus: [],
      tip: 'Same operators, new tables. Student and Enrolled share sid.',
      hints: [
        "Filter Enrolled on grade = 'A', join to Student, project the name.",
        "π<sub>sname</sub>(Student ⋈ σ<sub>grade = 'A'</sub>(Enrolled))"
      ],
      solution: op('project', 'sname', [
        op('join', '', [rel('Student'), op('select', "grade = 'A'", [rel('Enrolled')])])
      ])
    },
    {
      db: 'company',
      chapter: 'Products and division',
      title: 'Comparing a table to itself',
      question: 'Return every pair of distinct employee names who share a department. ' +
               'List each pair once, not twice.',
      focus: ['product', 'rename'],
      tip: 'To compare a relation with itself you must ρ it into two names first, then × them. ' +
           'Columns become A.eid, B.eid, and so on.',
      hints: [
        'Rename Employee to A on one side and B on the other, then take the product.',
        'A.eid < B.eid keeps one copy of each pair and rules out pairing someone with themselves.',
        "π<sub>A.ename, B.ename</sub>(σ<sub>A.dept = B.dept AND A.eid &lt; B.eid</sub>(ρ<sub>A</sub>(Employee) × ρ<sub>B</sub>(Employee)))"
      ],
      solution: op('project', 'A.ename, B.ename', [
        op('select', 'A.dept = B.dept AND A.eid < B.eid', [
          op('product', '', [
            op('rename', 'A', [rel('Employee')]),
            op('rename', 'B', [rel('Employee')])
          ])
        ])
      ])
    },
    {
      db: 'company',
      title: 'For all',
      question: 'Return the ids of employees who work on <i>every</i> project.',
      focus: ['divide'],
      tip: '<b>÷</b> answers "for all" questions. R ÷ S keeps the left-over columns of R whose value ' +
           'pairs with every row of S.',
      hints: [
        'The left side should be just (eid, pid) from WorksOn.',
        'The right side is every project id.',
        'π<sub>eid, pid</sub>(WorksOn) ÷ π<sub>pid</sub>(Project)'
      ],
      solution: op('divide', '', [
        op('project', 'eid, pid', [rel('WorksOn')]),
        op('project', 'pid', [rel('Project')])
      ])
    },
    {
      db: 'school',
      title: 'Every course in a department',
      question: 'Return the names of students who have taken every CS course.',
      focus: [],
      tip: 'Division finds the students; a join turns their ids into names.',
      hints: [
        'Right side: the cids of courses whose cdept is CS.',
        'Divide π(sid, cid) of Enrolled by that, then join the result back to Student.',
        "π<sub>sname</sub>(Student ⋈ (π<sub>sid, cid</sub>(Enrolled) ÷ π<sub>cid</sub>(σ<sub>cdept = 'CS'</sub>(Course))))"
      ],
      solution: op('project', 'sname', [
        op('join', '', [
          rel('Student'),
          op('divide', '', [
            op('project', 'sid, cid', [rel('Enrolled')]),
            op('project', 'cid', [op('select', "cdept = 'CS'", [rel('Course')])])
          ])
        ])
      ])
    },
    {
      db: 'company',
      chapter: 'Advanced',
      title: 'Matchmaking',
      question: 'Return each department together with the name of its head. ' +
               '(Department.head holds an employee id.)',
      focus: [],
      tip: 'A natural join is no help here: the columns to match are called <code>head</code> on one ' +
           'side and <code>eid</code> on the other. Type a condition into <b>⋈</b> to make it a theta join.',
      hints: [
        'Put Department on the left of ⋈ and Employee on the right, then fill in the condition box.',
        'The condition is head = eid. Both relations also have a dept column, so the result calls them ' +
          'Department.dept and Employee.dept.',
        'π<sub>Department.dept, ename</sub>(Department ⋈<sub>head = eid</sub> Employee)'
      ],
      solution: op('project', 'Department.dept, ename', [
        op('join', 'head = eid', [rel('Department'), rel('Employee')])
      ])
    },
    {
      db: 'school',
      title: 'Nobody signed up',
      question: 'Return the id and title of every course that no student is enrolled in.',
      focus: [],
      tip: 'Difference finds what is missing, but it can only return the columns you subtracted with. ' +
           'Join back to recover the rest.',
      hints: [
        'Start with π(cid) of Course minus π(cid) of Enrolled.',
        'That gives you bare ids — join the result back to Course to get titles.',
        'π<sub>cid, title</sub>(Course ⋈ (π<sub>cid</sub>(Course) − π<sub>cid</sub>(Enrolled)))'
      ],
      solution: op('project', 'cid, title', [
        op('join', '', [
          rel('Course'),
          op('difference', '', [
            op('project', 'cid', [rel('Course')]),
            op('project', 'cid', [rel('Enrolled')])
          ])
        ])
      ])
    },
    {
      db: 'company',
      title: 'At least two',
      question: 'Return the ids of employees who work on at least two different projects.',
      focus: [],
      tip: 'The basic algebra cannot count — ℱ only arrives in the Aggregation chapter. To say ' +
           '"two different" without it, pair WorksOn with itself and demand the two project ids differ.',
      hints: [
        'Rename WorksOn to A and B, take the product, and keep rows where A.eid = B.eid.',
        'A.pid < B.pid makes the two projects different and stops each pair being found twice.',
        'π<sub>A.eid</sub>(σ<sub>A.eid = B.eid AND A.pid &lt; B.pid</sub>(ρ<sub>A</sub>(WorksOn) × ρ<sub>B</sub>(WorksOn)))'
      ],
      solution: op('project', 'A.eid', [
        op('select', 'A.eid = B.eid AND A.pid < B.pid', [
          op('product', '', [
            op('rename', 'A', [rel('WorksOn')]),
            op('rename', 'B', [rel('WorksOn')])
          ])
        ])
      ])
    },
    {
      db: 'company',
      title: 'Exactly one',
      question: 'Return the ids of employees who work on exactly one project.',
      focus: [],
      tip: 'Exactly one = at least one, minus at least two. You built the second half in ' +
           '<i>At least two</i>.',
      hints: [
        'The left side is simply π<sub>eid</sub>(WorksOn) — everyone with at least one project.',
        'The right side is the whole query from <i>At least two</i>.',
        'π<sub>eid</sub>(WorksOn) − π<sub>A.eid</sub>(σ<sub>A.eid = B.eid AND A.pid &lt; B.pid</sub>' +
          '(ρ<sub>A</sub>(WorksOn) × ρ<sub>B</sub>(WorksOn)))'
      ],
      solution: op('difference', '', [
        op('project', 'eid', [rel('WorksOn')]),
        op('project', 'A.eid', [
          op('select', 'A.eid = B.eid AND A.pid < B.pid', [
            op('product', '', [
              op('rename', 'A', [rel('WorksOn')]),
              op('rename', 'B', [rel('WorksOn')])
            ])
          ])
        ])
      ])
    },
    {
      db: 'company',
      title: 'The biggest one',
      question: 'Return the id of the highest-paid employee, without using aggregation.',
      focus: [],
      tip: 'The basic algebra has no MAX — ℱ adds one later, but this trick is the reason the ' +
           'algebra does not need it. The maximum is the one nobody beats: find everyone who ' +
           '<i>is</i> beaten, then subtract them from everyone.',
      hints: [
        'Pair Employee with itself as A and B, and keep rows where A.salary < B.salary. ' +
          'Those A values are the losers.',
        'Subtract the losers from π<sub>eid</sub>(Employee).',
        'π<sub>eid</sub>(Employee) − π<sub>A.eid</sub>(σ<sub>A.salary &lt; B.salary</sub>' +
          '(ρ<sub>A</sub>(Employee) × ρ<sub>B</sub>(Employee)))'
      ],
      solution: op('difference', '', [
        op('project', 'eid', [rel('Employee')]),
        op('project', 'A.eid', [
          op('select', 'A.salary < B.salary', [
            op('product', '', [
              op('rename', 'A', [rel('Employee')]),
              op('rename', 'B', [rel('Employee')])
            ])
          ])
        ])
      ])
    },
    {
      db: 'school',
      title: 'Nothing but',
      question: 'Return the names of students who are enrolled only in CS courses ' +
               '(and are enrolled in at least one).',
      focus: [],
      tip: '"Only X" means "has no non-X". Find the students who break the rule, and subtract them.',
      hints: [
        'Join Enrolled to Course, then select the enrolments where cdept is not CS. ' +
          'Use &lt;&gt; for "not equal".',
        'Those sids are the students to exclude: π<sub>sid</sub>(Enrolled) minus them.',
        "π<sub>sname</sub>(Student ⋈ (π<sub>sid</sub>(Enrolled) − π<sub>sid</sub>(σ<sub>cdept &lt;&gt; 'CS'</sub>(Enrolled ⋈ Course))))"
      ],
      solution: op('project', 'sname', [
        op('join', '', [
          rel('Student'),
          op('difference', '', [
            op('project', 'sid', [rel('Enrolled')]),
            op('project', 'sid', [
              op('select', "cdept <> 'CS'", [op('join', '', [rel('Enrolled'), rel('Course')])])
            ])
          ])
        ])
      ])
    },
    {
      db: 'company',
      title: 'Keeping up with Cleo',
      question: 'Return the ids of employees who work on every project that Cleo (E3) works on.',
      focus: [],
      tip: 'Division again — but this time the divisor is itself a query, not a whole relation.',
      hints: [
        'The divisor is the set of project ids Cleo works on: filter WorksOn on eid, then project pid.',
        'Divide π<sub>eid, pid</sub>(WorksOn) by that.',
        "π<sub>eid, pid</sub>(WorksOn) ÷ π<sub>pid</sub>(σ<sub>eid = 'E3'</sub>(WorksOn))"
      ],
      solution: op('divide', '', [
        op('project', 'eid, pid', [rel('WorksOn')]),
        op('project', 'pid', [op('select', "eid = 'E3'", [rel('WorksOn')])])
      ])
    },
    {
      db: 'company',
      title: 'True of everyone',
      question: 'Return the departments in which <i>every</i> employee earns more than 55000.',
      focus: [],
      tip: 'Division is not the only way to say "for all". A statement is true of everyone exactly ' +
           'when there is no counterexample.',
      hints: [
        'The counterexamples are employees earning 55000 or less. Which departments do they sit in?',
        'Take every department that has employees, and subtract the departments that have a counterexample.',
        'π<sub>dept</sub>(Employee) − π<sub>dept</sub>(σ<sub>salary &lt;= 55000</sub>(Employee))'
      ],
      solution: op('difference', '', [
        op('project', 'dept', [rel('Employee')]),
        op('project', 'dept', [op('select', 'salary <= 55000', [rel('Employee')])])
      ])
    },
    {
      db: 'company',
      title: 'Everything at once',
      question: 'Return the names of employees who earn less than 90000 and work on ' +
               '<i>every</i> project with a budget over 100000.',
      focus: [],
      tip: 'Everything at once: a filter feeding a division, a join to recover names, and a second ' +
           'filter on the way out.',
      hints: [
        'Build the divisor first: the pids of projects with a budget over 100000.',
        'Divide π<sub>eid, pid</sub>(WorksOn) by it, then join the resulting ids back to Employee.',
        'Finish with σ on salary and π on ename.',
        'π<sub>ename</sub>(σ<sub>salary &lt; 90000</sub>(Employee ⋈ (π<sub>eid, pid</sub>(WorksOn) ÷ ' +
          'π<sub>pid</sub>(σ<sub>budget &gt; 100000</sub>(Project)))))'
      ],
      solution: op('project', 'ename', [
        op('select', 'salary < 90000', [
          op('join', '', [
            rel('Employee'),
            op('divide', '', [
              op('project', 'eid, pid', [rel('WorksOn')]),
              op('project', 'pid', [op('select', 'budget > 100000', [rel('Project')])])
            ])
          ])
        ])
      ])
    },
    {
      db: 'company',
      chapter: 'Aggregation',
      title: 'How many?',
      question: 'Return the number of employees.',
      focus: ['group'],
      tip: '<b>ℱ</b> collapses rows into one summary row. The functions go on the right of the ℱ; ' +
           'leave the box on its left empty to summarise the whole relation at once.',
      hints: [
        'Drop ℱ on the canvas and put Employee inside it.',
        'Write COUNT(eid) in the right-hand box, and leave the left one empty.',
        'ℱ<sub>COUNT(eid)</sub>(Employee)'
      ],
      solution: op('group', 'COUNT(eid)', [rel('Employee')], '')
    },
    {
      db: 'company',
      title: 'How many each?',
      question: 'Return the number of employees in each department.',
      focus: [],
      tip: 'Whatever you put to the <i>left</i> of the ℱ becomes the grouping: one output row ' +
           'per distinct value.',
      hints: [
        'Put dept in the left-hand box of the ℱ node.',
        'The result has one row per department, with the count beside it.',
        '<sub>dept</sub>ℱ<sub>COUNT(eid)</sub>(Employee)'
      ],
      solution: op('group', 'COUNT(eid)', [rel('Employee')], 'dept')
    },
    {
      db: 'company',
      title: 'Two at a time',
      question: 'Return the lowest and the highest salary in the company, in one row.',
      focus: [],
      tip: 'One ℱ can carry several functions, separated by commas: ' +
           '<code>MIN(salary), MAX(salary)</code>.',
      hints: [
        'No grouping attribute — you want a single row for the whole company.',
        'ℱ<sub>MIN(salary), MAX(salary)</sub>(Employee)'
      ],
      solution: op('group', 'MIN(salary), MAX(salary)', [rel('Employee')], '')
    },
    {
      db: 'company',
      title: 'On average',
      question: 'Return the average salary of each department.',
      focus: [],
      tip: 'The functions are COUNT, SUM, AVG, MIN and MAX. COUNT(*) counts rows.',
      hints: [
        'Group by dept, and AVG the salary.',
        '<sub>dept</sub>ℱ<sub>AVG(salary)</sub>(Employee)'
      ],
      solution: op('group', 'AVG(salary)', [rel('Employee')], 'dept')
    },
    {
      db: 'company',
      title: 'Filtering the groups',
      question: 'Return the departments that have more than two employees.',
      focus: [],
      tip: 'ℱ names its output columns after the function: COUNT(eid) becomes ' +
           '<code>COUNT_eid</code>. Once it is a column like any other, σ can filter on it — ' +
           'this is what SQL calls HAVING.',
      hints: [
        'First build the per-department counts, exactly as you did in <i>How many each?</i>.',
        'Then wrap that in σ with the condition COUNT_eid > 2, and project the department.',
        'π<sub>dept</sub>(σ<sub>COUNT_eid &gt; 2</sub>(<sub>dept</sub>ℱ<sub>COUNT(eid)</sub>(Employee)))'
      ],
      solution: op('project', 'dept', [
        op('select', 'COUNT_eid > 2', [op('group', 'COUNT(eid)', [rel('Employee')], 'dept')])
      ])
    },
    {
      db: 'company',
      title: 'Summing across a join',
      question: 'Return each employee name with the total number of hours they are billed for.',
      focus: [],
      tip: 'Aggregation takes any relation, including one you have just joined together.',
      hints: [
        'Join Employee to WorksOn first — hours lives in WorksOn, the name in Employee.',
        'Then group by ename and SUM the hours.',
        '<sub>ename</sub>ℱ<sub>SUM(hours)</sub>(Employee ⋈ WorksOn)'
      ],
      solution: op('group', 'SUM(hours)', [
        op('join', '', [rel('Employee'), rel('WorksOn')])
      ], 'ename')
    },
    {
      db: 'school',
      title: 'Enrolment counts',
      question: 'Return each course title together with the number of students enrolled in it.',
      focus: [],
      tip: 'Count first, then join to get the titles. A course nobody is enrolled in has no rows ' +
           'to group, so it will not appear at all — which is what <i>Nobody signed up</i> was about.',
      hints: [
        'Group Enrolled by cid and COUNT the students.',
        'That gives you cid and COUNT_sid; join it to Course to reach the titles.',
        'π<sub>title, COUNT_sid</sub>(Course ⋈ (<sub>cid</sub>ℱ<sub>COUNT(sid)</sub>(Enrolled)))'
      ],
      solution: op('project', 'title, COUNT_sid', [
        op('join', '', [rel('Course'), op('group', 'COUNT(sid)', [rel('Enrolled')], 'cid')])
      ])
    },
    {
      db: 'company',
      title: 'Two numbers at once',
      question: 'Return, for each department, how many employees it has and what they earn on average.',
      focus: [],
      tip: 'Grouping and several functions combine freely: everything left of the ℱ groups, ' +
           'everything right of it is computed per group.',
      hints: [
        'One ℱ does all of it — no need for two queries joined together.',
        '<sub>dept</sub>ℱ<sub>COUNT(eid), AVG(salary)</sub>(Employee)'
      ],
      solution: op('group', 'COUNT(eid), AVG(salary)', [rel('Employee')], 'dept')
    },
    {
      db: 'company',
      title: 'Before or after',
      question: 'Return the average salary of the under-40s in each department.',
      focus: [],
      tip: 'Where you put the σ decides what it means. <b>Before</b> the ℱ it throws away rows ' +
           'before they are counted — SQL calls that WHERE. <b>After</b> the ℱ it throws away whole ' +
           'groups — that is HAVING, which you did in <i>Filtering the groups</i>.',
      hints: [
        'Filter Employee down to the under-40s first, then group what is left.',
        'The σ goes inside the ℱ, not around it.',
        '<sub>dept</sub>ℱ<sub>AVG(salary)</sub>(σ<sub>age &lt; 40</sub>(Employee))'
      ],
      solution: op('group', 'AVG(salary)', [
        op('select', 'age < 40', [rel('Employee')])
      ], 'dept')
    },
    {
      db: 'company',
      title: 'Busy people',
      question: 'Return the names of employees billed for more than 20 hours in total across all ' +
               'their projects.',
      focus: [],
      tip: 'Join, then group, then filter the groups, then project — the order you say it in ' +
           'English is the order you build it in, from the inside out.',
      hints: [
        'Join Employee to WorksOn, then group by ename and SUM the hours.',
        'The summed column is called SUM_hours; filter on it with σ.',
        'π<sub>ename</sub>(σ<sub>SUM_hours &gt; 20</sub>(<sub>ename</sub>ℱ<sub>SUM(hours)</sub>(Employee ⋈ WorksOn)))'
      ],
      solution: op('project', 'ename', [
        op('select', 'SUM_hours > 20', [
          op('group', 'SUM(hours)', [op('join', '', [rel('Employee'), rel('WorksOn')])], 'ename')
        ])
      ])
    },
    {
      db: 'school',
      title: 'Course load',
      question: 'Return each student’s name together with the number of courses they are enrolled in.',
      focus: [],
      tip: 'The mirror image of <i>Enrolment counts</i>: group the same relation the other way round.',
      hints: [
        'Group Enrolled by sid and COUNT the courses.',
        'Join that back to Student to turn the ids into names.',
        'π<sub>sname, COUNT_cid</sub>(Student ⋈ (<sub>sid</sub>ℱ<sub>COUNT(cid)</sub>(Enrolled)))'
      ],
      solution: op('project', 'sname, COUNT_cid', [
        op('join', '', [rel('Student'), op('group', 'COUNT(cid)', [rel('Enrolled')], 'sid')])
      ])
    },
    {
      db: 'company',
      title: 'Final exam',
      question: 'Return each department together with the name of its highest-paid employee.',
      focus: [],
      tip: 'ℱ can tell you the maximum salary per department, but not <i>who</i> earns it — a ' +
           'group is not a row. Rename the result so its columns match Employee’s, and a natural ' +
           'join will find the people again.',
      hints: [
        'Start with the maximum salary in each department: <sub>dept</sub>ℱ<sub>MAX(salary)</sub>(Employee).',
        'That gives columns dept and MAX_salary. Rename them to dept and salary with ρ<sub>(dept, salary)</sub>.',
        'Now a natural join with Employee matches on both columns at once, keeping only the top earners.',
        'π<sub>dept, ename</sub>(Employee ⋈ ρ<sub>(dept, salary)</sub>(<sub>dept</sub>ℱ<sub>MAX(salary)</sub>(Employee)))'
      ],
      solution: op('project', 'dept, ename', [
        op('join', '', [
          rel('Employee'),
          op('rename', '(dept, salary)', [op('group', 'MAX(salary)', [rel('Employee')], 'dept')])
        ])
      ])
    }
  ];

  global.GAME = { DATABASES: DATABASES, LEVELS: LEVELS };
})(typeof window !== 'undefined' ? window : globalThis);
