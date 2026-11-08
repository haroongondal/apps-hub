// What compileFilters says about a bad line (an error message, or a `dropped` reason for a skipped one) in the owner's words.
const PLAIN: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^Rule has spaces/, () => "Sieve can't read this line as a filter. Check it for typos and stray spaces."],
  [/^Rule is too general/, () => 'This filter would block every site. Add an address, or limit it with $domain=.'],
  [/^Chrome can't run this regular expression$/, () => "Chrome can't run this regular expression. Take out lookarounds and back-references, or block a plain address."],
  [/^Unknown modifier: ([^=]*)/, (m) => `Sieve doesn't know the option $${m[1]}. Check its spelling, or remove it.`],
  [/^(Modifier value cannot be empty|Empty modifiers are not allowed)/, () => 'An option is missing its value after =. Add the value, or remove the option.'],
  [/^Empty value specified in the list/, () => "An option's list has an empty entry. Remove the extra | or ~."],
  [/^Expected '.*', but got '/, () => "This selector isn't valid CSS. Check its brackets and quotes."],
  [/^Invalid \w+ scriptlet call/, () => "This scriptlet call isn't complete. Check its brackets and quotes."],
  [/^Empty rule body$/, () => 'This filter has nothing after ##. Add a selector.'],
  [/^Network rule must have a pattern or modifiers$/, () => 'This filter has no address. Add one after @@ or ||.'],
  [/^extended-css$/, () => "Chrome can't run extended selectors such as :has-text(). Use a plain CSS selector."],
  [/^css-injection$/, () => "Sieve only hides items, it can't restyle them. Remove the style part."],
  [/^html-filtering$/, () => "Sieve can't filter a page's HTML. Use an element hiding filter (##) instead."],
  [/^raw-js$/, () => "Sieve doesn't run JavaScript from filters. Use a scriptlet instead."],
  [/^redirect$/, () => "Sieve can't swap a request for a stand-in file. Remove $redirect to block the request instead."],
  [/^unsupported-modifier$/, () => "Chrome can't apply one of this filter's options. Remove that option."],
  [/^cosmetic-modifier$/, () => "Sieve can't run element filters with [$…] options. Use site##selector instead."],
  [/^unknown-scriptlet$/, () => "Sieve doesn't know this scriptlet. Check its name."],
  [/^negated-exception$/, () => "An exception can't leave out sites with ~. Name only the sites it is for."],
  [/^hide-exception-pattern$/, () => 'This exception needs a site address, like @@||example.com^$generichide.'],
];

export function plainReason(reason: string): string {
  for (const [pattern, say] of PLAIN) {
    const m = pattern.exec(reason);
    if (m) return say(m);
  }
  return reason;
}

// Only lines new since `loaded` come back, so a line the owner deleted on the page stays deleted.
export function withNewLines(text: string, loaded: string, stored: string): { text: string; added: number } {
  const old = new Set(loaded.split(/\r\n?|\n/));
  const have = new Set(text.split(/\r\n?|\n/));
  const added = stored.split(/\r\n?|\n/).filter((l) => l.trim() && !old.has(l) && !have.has(l));
  return { text: added.length ? [text.trimEnd(), ...added].filter(Boolean).join('\n') : text, added: added.length };
}
