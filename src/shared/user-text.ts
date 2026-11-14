/** The string literals (template parts without their `${}`) and JSX text in a TS/TSX source, comments left out. */
export function userText(source: string): string[] {
  const out: string[] = [];
  let i = 0,
    code = "";
  const flushCode = () => {
    // JSX text: words between a tag's `>` and the next `<` or `{`, with no code punctuation in it.
    for (const m of code.matchAll(/>([^<>{}]*)(?=[<{])/g)) {
      const text = m[1]!;
      if (/[A-Za-z]/.test(text) && /^[\sA-Za-z'’…,.!?-]+$/.test(text) && !/^\s*[A-Za-z_$][\w$]*\s*$/.test(text.trim() ? text : "x="))
        out.push(text.trim());
    }
    code = "";
  };
  while (i < source.length) {
    const c = source[i]!,
      next = source[i + 1];
    if (c === "/" && next === "/") {
      i = source.indexOf("\n", i);
      if (i < 0) break;
      continue;
    }
    if (c === "/" && next === "*") {
      i = source.indexOf("*/", i + 2) + 2;
      if (i < 2) break;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      // A quote inside JSX text (an apostrophe in "parent's") is text, not a string: JSX text has a `>` before it on its run.
      if (c === "'" && /[A-Za-z]$/.test(code)) {
        code += c;
        i++;
        continue;
      }
      flushCode();
      let j = i + 1,
        text = "";
      while (j < source.length && source[j] !== c) {
        if (source[j] === "\\") {
          text += source[j + 1];
          j += 2;
          continue;
        }
        if (c === "`" && source[j] === "$" && source[j + 1] === "{") {
          let depth = 1;
          j += 2;
          while (j < source.length && depth) {
            if (source[j] === "{") depth++;
            else if (source[j] === "}") depth--;
            j++;
          }
          text += " ";
          continue;
        }
        if (c !== "`" && source[j] === "\n") break; // not a string after all (a regex or stray quote)
        text += source[j];
        j++;
      }
      out.push(text);
      i = j + 1;
      continue;
    }
    code += c;
    i++;
  }
  flushCode();
  return out;
}
