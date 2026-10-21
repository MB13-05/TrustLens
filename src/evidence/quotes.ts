const QUOTE_MARKS: Record<string, string> = {
 '„': '"', '“': '"', '”': '"', '«': '"', '»': '"', '‟': '"', '〝': '"', '〞': '"', '″': '"',
 '‚': "'", '‘': "'", '’': "'", '‹': "'", '›': "'", '‛': "'", '′': "'", '`': "'", '´': "'",
 '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
 '…': '...',
};
const INVISIBLE = /[­​-‍⁠﻿]/;

interface Folded { text: string; origin: number[] }

/** Folds typography that models routinely change when re-typing a quote, remembering each folded character's source index. */
function fold(input: string): Folded {
 let text = '';
 const origin: number[] = [];
 for (let i = 0; i < input.length; i++) {
  const char = input[i]!;
  if (INVISIBLE.test(char)) continue;
  if (/\s/.test(char)) { if (text.length > 0 && !text.endsWith(' ')) { text += ' '; origin.push(i); } continue; }
  const mapped = QUOTE_MARKS[char] ?? char;
  for (const folded of mapped) { text += folded; origin.push(i); }
 }
 return { text, origin };
}

/**
 * Finds `quote` inside `source` while ignoring whitespace, line breaks, soft hyphens and quotation-mark style.
 * Returns the literal source span so callers can store the real text, never the model's re-typed version.
 * Letters, digits and case must still match exactly.
 */
export function locateQuote(source: string, quote: string): string | null {
 const folded = fold(quote.trim()).text.trim();
 if (!folded) return null;
 const exact = source.indexOf(quote);
 if (exact >= 0 && quote.trim()) return quote;
 const haystack = fold(source);
 // Models often wrap a quote in quotation marks the source does not contain; only the outer pair may be dropped.
 const needle = [folded, folded.replace(/^["']+|["']+$/g, '').trim()].find(candidate => candidate && haystack.text.includes(candidate));
 if (!needle) return null;
 const at = haystack.text.indexOf(needle);
 const start = haystack.origin[at]!;
 const end = haystack.origin[at + needle.length - 1]! + 1;
 return source.slice(start, end);
}
