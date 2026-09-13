#!/usr/bin/env node
/* Inlines src/ into a single self-contained index.html.
   One file means no relative fetches, so the game works from file:// even in a
   sandboxed browser (Flatpak/Snap), from a USB stick, or as an email attachment. */
'use strict';
const fs = require('fs');
const path = require('path');

const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const scripts = ['engine.js', 'levels.js', 'app.js'];

const css = src('styles.css');
const js = scripts.map(f => '/* ===== src/' + f + ' ===== */\n' + src(f)).join('\n\n');

// An inlined "</script>" or "</style>" would end the tag early and break the page.
for (const [name, body, tag] of [['CSS', css, '</style'], ['JS', js, '</script']]) {
  if (new RegExp(tag, 'i').test(body)) {
    console.error('Refusing to build: ' + name + ' contains a literal "' + tag + '>".');
    process.exit(1);
  }
}

const html = src('index.template.html')
  .replace('/*{{STYLES}}*/', () => '\n' + css + '\n')
  .replace('/*{{SCRIPTS}}*/', () => '\n' + js + '\n');

const out = path.join(__dirname, 'index.html');
fs.writeFileSync(out, html);
console.log('built index.html  (' + (html.length / 1024).toFixed(1) + ' KB, self-contained)');
