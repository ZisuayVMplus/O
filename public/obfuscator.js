/**
 * RoLock — stage 1: string literal obfuscation for Luau/Roblox scripts.
 *
 * Walks the source character-by-character (comment- and long-string aware),
 * finds every quoted string literal, decodes its escape sequences to raw
 * byte values, and re-emits each one as a plain numeric array passed to a
 * tiny runtime decoder that rebuilds the string with string.char at
 * execution time. No encryption layer — this stage only converts text into
 * numbers, which is the step requested before anything fancier gets added.
 * Everything else in the source (identifiers, control flow, comments, long
 * strings) is left untouched.
 *
 * This runs entirely client-side — no source code ever leaves the browser.
 */

const RoLock = (() => {
  const DECODER_NAME = '_RL';

  function randomVarName(seed) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let s = '_';
    let n = seed;
    for (let i = 0; i < 6; i++) {
      s += chars[(n + i * 17) % chars.length];
      n = (n * 31 + 7) >>> 0;
    }
    return s;
  }

  // Decode a Lua-escaped string body into an array of byte values (0-255).
  function decodeLuaEscapes(body) {
    const bytes = [];
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch !== '\\') {
        // encode as UTF-8 bytes so non-ASCII survives
        const codePoint = body.codePointAt(i);
        const utf8 = new TextEncoder().encode(String.fromCodePoint(codePoint));
        utf8.forEach((b) => bytes.push(b));
        if (codePoint > 0xffff) i++; // consumed a surrogate pair
        continue;
      }
      const next = body[i + 1];
      switch (next) {
        case 'n': bytes.push(10); i++; break;
        case 't': bytes.push(9); i++; break;
        case 'r': bytes.push(13); i++; break;
        case 'a': bytes.push(7); i++; break;
        case 'b': bytes.push(8); i++; break;
        case 'f': bytes.push(12); i++; break;
        case 'v': bytes.push(11); i++; break;
        case '\\': bytes.push(92); i++; break;
        case '"': bytes.push(34); i++; break;
        case "'": bytes.push(39); i++; break;
        case '\n': bytes.push(10); i++; break;
        case 'x': {
          const hex = body.substr(i + 2, 2);
          bytes.push(parseInt(hex, 16) & 0xff);
          i += 3;
          break;
        }
        case 'z': {
          // \z skips following whitespace (Lua 5.2+/Luau)
          i++;
          let j = i + 1;
          while (j < body.length && /\s/.test(body[j])) j++;
          i = j - 1;
          break;
        }
        default: {
          if (/[0-9]/.test(next)) {
            let digits = '';
            let j = i + 1;
            while (j < body.length && digits.length < 3 && /[0-9]/.test(body[j])) {
              digits += body[j];
              j++;
            }
            bytes.push(parseInt(digits, 10) & 0xff);
            i = j - 1;
          } else {
            // unknown escape — keep literally
            bytes.push(next.charCodeAt(0));
            i++;
          }
        }
      }
    }
    return bytes;
  }

  function emitCall(bytes) {
    return `${DECODER_NAME}({${bytes.join(',')}})`;
  }

  /**
   * Tokenizes `src`, replacing every plain quoted string literal with an
   * obfuscated decoder call. Skips comments and long-bracket strings.
   * Returns { code, count } where count is the number of strings replaced.
   */
  function obfuscateStrings(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let count = 0;

    function matchLongBracket(pos) {
      // returns level (number of '=') if a long-bracket opener starts at pos, else -1
      if (src[pos] !== '[') return -1;
      let j = pos + 1;
      let level = 0;
      while (src[j] === '=') { level++; j++; }
      if (src[j] === '[') return level;
      return -1;
    }

    function consumeLongBracket(pos, level) {
      // pos points at the opening '[', returns index just past the matching close
      const closer = ']' + '='.repeat(level) + ']';
      const end = src.indexOf(closer, pos);
      return end === -1 ? n : end + closer.length;
    }

    while (i < n) {
      const ch = src[i];

      // line comment
      if (ch === '-' && src[i + 1] === '-') {
        const lvl = matchLongBracket(i + 2);
        if (lvl >= 0) {
          const end = consumeLongBracket(i + 2, lvl);
          out += src.slice(i, end);
          i = end;
          continue;
        }
        const nl = src.indexOf('\n', i);
        const end = nl === -1 ? n : nl;
        out += src.slice(i, end);
        i = end;
        continue;
      }

      // long string literal (not a comment) — leave untouched for now
      const lvl = matchLongBracket(i);
      if (lvl >= 0) {
        const end = consumeLongBracket(i, lvl);
        out += src.slice(i, end);
        i = end;
        continue;
      }

      // quoted string
      if (ch === '"' || ch === "'") {
        const quote = ch;
        let j = i + 1;
        let body = '';
        while (j < n && src[j] !== quote) {
          if (src[j] === '\\') {
            body += src[j] + (src[j + 1] || '');
            j += 2;
          } else {
            body += src[j];
            j++;
          }
        }
        const end = j + 1; // past closing quote
        const bytes = decodeLuaEscapes(body);
        out += emitCall(bytes);
        count++;
        i = end;
        continue;
      }

      out += ch;
      i++;
    }

    return { code: out, count };
  }

  function runtimeHeader() {
    return `local function ${DECODER_NAME}(d) local t={} for i=1,#d do t[i]=string.char(d[i]) end return table.concat(t) end\n`;
  }

  /**
   * Full pipeline: obfuscate string literals and prepend the runtime
   * decoder. Also renames the decoder to something less obvious per run.
   */
  function run(src) {
    const seed = Math.floor(Math.random() * 1e9);
    const name = randomVarName(seed);
    const { code, count } = obfuscateStrings(src);
    const header = runtimeHeader().replace(new RegExp(DECODER_NAME, 'g'), name);
    const body = code.replace(new RegExp(`\\b${DECODER_NAME}\\(`, 'g'), `${name}(`);
    return { code: header + body, count };
  }

  return { run, obfuscateStrings, decodeLuaEscapes };
})();

if (typeof module !== 'undefined') module.exports = RoLock;
