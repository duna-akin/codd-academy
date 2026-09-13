/* Databases and puzzles. Each solution is an expression tree, so the game can
   both compute the expected answer and drop the solution onto the canvas. */
(function (global) {
  'use strict';

  var R = global.RA.relation;

  function rel(name) { return { type: 'rel', name: name }; }
  function op(name, param, children) {
    return { type: 'op', op: name, param: param || '', children: children };
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
          ['C4', 'Optics',     'Physics', 3]
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
      title: 'The whole table',
      question: 'Return every employee, with all of their details.',
      focus: [],
      tip: 'A bare relation is already a valid query. Drag <b>Employee</b> onto the canvas.',
      hints: [
        'You do not need an operator at all for this one.',
        'Relations live in the left panel — drag the Employee chip into the empty slot.'
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
      title: 'Final exam',
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
    }
  ];

  global.GAME = { DATABASES: DATABASES, LEVELS: LEVELS };
})(typeof window !== 'undefined' ? window : globalThis);
