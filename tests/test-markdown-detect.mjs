import assert from "node:assert/strict";
import { looksLikeMultiBlockMarkdown } from "../dist/markdown/detect.js";

const shouldDetect = [
  ["heading + text", "### Items in BOTH Inventories\n\nSome text here."],
  ["real table", "| Variety | Pkts |\n|---------|------|\n| Carrot | 1 |"],
  ["fenced code", "Intro line\n```js\nconst a = 1;\n```"],
  ["thematic break", "Above the line\n\n---\n\nBelow the line"],
  ["blockquote", "Normal line\n> quoted line"],
  ["two bullets", "- first item\n- second item"],
  ["ordered list", "1. first\n2. second"],
  ["the real seed-order doc", "### ✅ Items in BOTH Inventories (no reorder needed)\n\n| Variety | July Pkts | Winter Pkts | Notes |\n|---------|-----------|-------------|-------|\n| Carrot – Rainbow Mixed | 1 (Egmont) | 2 (Egmont) | Well stocked |\n\n### 🆕 NEW in July Inventory\n\n| Variety | Brand |\n|---------|-------|\n| **Zucchini – Zephyr F1** | Kings |"],
];

const shouldNotDetect = [
  ["empty", ""],
  ["single line", "Just a simple sentence."],
  ["single line with bold", "This has **bold** and [a link](http://x.com) inline."],
  ["multi-line prose", "First sentence here.\nSecond sentence here."],
  ["C include (no space after #)", "#include <stdio.h>\nint main() { return 0; }"],
  ["hashtag no space", "#1 priority\nship it"],
  ["one bullet only", "Reminder\n- check the notes"],
  ["single-line heading only", "### Just a heading"],
  ["pipes but no delimiter row", "a | b | c\nd | e | f"],
];

let failures = 0;
for (const [name, input] of shouldDetect) {
  const got = looksLikeMultiBlockMarkdown(input);
  if (got !== true) { console.error(`FAIL (want detect):   ${name}`); failures += 1; }
}
for (const [name, input] of shouldNotDetect) {
  const got = looksLikeMultiBlockMarkdown(input);
  if (got !== false) { console.error(`FAIL (want NO detect): ${name}`); failures += 1; }
}

assert.equal(failures, 0, `${failures} markdown-detect case(s) failed`);
console.log(`Markdown detect tests passed (${shouldDetect.length} detect, ${shouldNotDetect.length} no-detect)`);
