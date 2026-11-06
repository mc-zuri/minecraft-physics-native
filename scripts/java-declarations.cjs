// The methods a Java source declares, read by structure rather than by a pattern over its text: a
// call, a string, a comment, an anonymous class's method and a constructor are never taken for a
// declaration, overloads stay apart and a signature may span lines.
const crypto = require("node:crypto");
const { javaCode, matchingBracket, splitTopLevel } = require("./java-source.cjs");

const CLASS_HEADER = /(?:^|[^\w$.])(?:class|enum|interface|record)\s+([A-Za-z_$][\w$]*)/;
const NOT_A_TYPE = new Set(["return", "new", "throw", "else", "case", "assert", "if", "for", "while", "switch", "catch", "do", "try"]);

/** A parameter list's types, as written less generics, annotations, `final` and the names. */
function parameterTypes(parameters) {
  const erased = (text) => {
    const inner = text.replace(/<[^<>]*>/g, "");
    return inner === text ? text : erased(inner);
  };
  // generics first: a comma inside them does not end a parameter
  return splitTopLevel(erased(parameters)).map((parameter) => parameter
    .replace(/@[\w$.]+(?:\([^)]*\))?\s*/g, "")
    .replace(/\bfinal\s+/g, "")
    .replace(/\s+[\w$]+(\s*\[\s*\])*\s*$/, "$1")
    .replace(/\s+/g, ""));
}

/** The method a member's text before its `{` declares, null for anything else. */
function methodHeader(code, from, to, className) {
  const open = code.indexOf("(", from);
  if (open < 0 || open >= to) return null;
  // annotations carry brackets of their own, and come first
  let cursor = from;
  for (;;) {
    while (/\s/.test(code[cursor])) cursor += 1;
    if (code[cursor] !== "@") break;
    const name = /^@[\w$.]+\s*/.exec(code.slice(cursor, to));
    if (!name) return null;
    cursor += name[0].length;
    if (code[cursor] === "(") cursor = matchingBracket(code, cursor) + 1;
  }
  const paren = code.indexOf("(", cursor);
  if (paren < 0 || paren >= to) return null;
  const close = matchingBracket(code, paren);
  if (close < 0 || close >= to || !/^\s*(?:throws\s[\w$.,\s]+)?$/.test(code.slice(close + 1, to))) return null;
  const head = /^([\s\S]*?)([A-Za-z_$][\w$]*)\s*$/.exec(code.slice(cursor, paren));
  if (!head) return null;
  const type = head[1].trim();
  // a type must come before the name; a bare name is a constructor or an enum constant
  if (type.length === 0 || /[,=]/.test(type.replace(/<[^>]*>/g, "")) || head[2] === className) return null;
  if (NOT_A_TYPE.has(type.split(/\s+/).at(-1))) return null;
  return { name: head[2], start: cursor, parameters: { open: paren, close } };
}

/** The members of the class body `[open, close]`: its methods, and those of its named classes. */
function membersOf(source, code, open, close, className, found) {
  let segment = open + 1;
  let inField = false;
  for (let index = open + 1; index < close; index += 1) {
    const current = code[index];
    if (current === "(" || current === "[") {
      index = matchingBracket(code, index);
      if (index < 0) return;
    } else if (current === "=" && !inField) {
      inField = true;
    } else if (current === ";") {
      inField = false;
      segment = index + 1;
    } else if (current === "{") {
      const end = matchingBracket(code, index);
      if (end < 0) return;
      if (!inField) {
        const nested = CLASS_HEADER.exec(code.slice(segment, index));
        const header = nested ? null : methodHeader(code, segment, index, className.split(".").at(-1));
        if (nested) {
          membersOf(source, code, index, end, `${className}.${nested[1]}`, found);
        } else if (header) {
          const lineStart = source.lastIndexOf("\n", header.start) + 1;
          const parameters = source.slice(header.parameters.open + 1, header.parameters.close);
          const text = source.slice(lineStart, end + 1);
          found.push({
            declaringClass: className,
            name: header.name,
            signature: `(${parameterTypes(parameters).join(",")})`,
            line: source.slice(0, lineStart).split("\n").length,
            start: lineStart,
            end: end + 1,
            bodyStart: index,
            sha256: crypto.createHash("sha256").update(text).digest("hex"),
            source: text,
          });
        }
        segment = end + 1;
      }
      index = end;
    }
  }
}

/** Every method with a body the top-level classes of `source` and their named classes declare. */
function methodDeclarations(source) {
  const code = javaCode(source);
  const found = [];
  let cursor = 0;
  while (cursor < code.length) {
    const open = code.indexOf("{", cursor);
    if (open < 0) break;
    const header = CLASS_HEADER.exec(code.slice(cursor, open));
    const close = matchingBracket(code, open);
    if (close < 0) break;
    if (header) membersOf(source, code, open, close, header[1], found);
    cursor = close + 1;
  }
  return found;
}

/** The declarations of `name` in the file's outermost classes, overloads apart. */
function methodsNamed(source, name) {
  return methodDeclarations(source).filter((method) => method.name === name && !method.declaringClass.includes("."));
}

module.exports = { methodDeclarations, methodsNamed };
