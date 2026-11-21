hunspell-asm 4.0.2 (MIT, https://github.com/kwonoj/hunspell-asm) — Hunspell compiled to WebAssembly.
hunspell.iife.js: esbuild --bundle --format=iife --minify of dist/cjs/index.js, exposing self.HunspellAsm.loadModule
(a classic script: the spell worker is a blob made of this file + ../../spell-worker.js).
Hunspell itself: MPL 1.1 / GPL 2.0 / LGPL 2.1. The dictionaries are not in the extension: they are
downloaded on first use from https://docxmd.pp.ua/models/dict/<lang>/ (licences in models/README.txt there).
