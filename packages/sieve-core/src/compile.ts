import {
  GenericPlatform,
  QuoteUtils,
  RuleConverter,
  RuleParser,
  defaultParserOptions,
  scriptletsCompatibilityTable,
  type AnyCosmeticRule,
  type NetworkRule,
} from '@adguard/agtree';
import {
  EmptyDomainsError,
  EmptyResourcesError,
  Filter,
  FilterConverter,
  Rule,
  TooManyRegexpRulesError,
  UnsupportedModifierError,
  UnsupportedRegexpError,
  isConversionError,
} from '@adguard/dnr-converter';
import { scriptlets } from '@adguard/scriptlets';
import { emptyCosmetic, scriptletKey } from './page.ts';

export interface DnrRule {
  id: number;
  priority?: number;
  action: { type: string; [key: string]: unknown };
  condition: { [key: string]: unknown };
}

export interface ScriptletCall {
  name: string;
  args: string[];
}

export interface CosmeticSet {
  generic: string[];
  hide: Record<string, string[]>;
  unhide: Record<string, string[]>; // host ('*' = every site) -> selectors it exempts
  generichide: string[];
  elemhide: string[];
  scriptlets: Record<string, ScriptletCall[]>; // host ('*' = every site) -> calls
  scriptletExcept: Record<string, string[]>; // host ('*' = every site) -> scriptletKey(call), or '*' for all of them
}

export interface CompileOptions {
  firstId: number;
  regexLimit?: number;
  trusted?: boolean; // allow trusted-* scriptlets: only for the owner's own filters
  scriptlets?: readonly string[]; // the scriptlets the extension ships (My filters): any other is an error on its line
}

export interface CompiledList {
  rules: DnrRule[];
  sources: Record<number, string>;
  allowIds: number[];
  modifyIds: number[];
  cosmetic: CosmeticSet;
  maxPriority: number;
  dropped: Record<string, number>;
  errors: { line: number; text: string; reason: string }[];
  skipped: { line: number; text: string; reason: string }[]; // the dropped filters whose line is known, with their `dropped` reason
  filterLines: number; // lines that are not blank or a comment
}

// The build serialises these with toString(); asking sieve-core keeps one installed copy of @adguard/scriptlets.
export function scriptletFunction(name: string): ((source: object, args: string[]) => void) | undefined {
  const fn = scriptlets.getScriptletFunction(name);
  return typeof fn === 'function' ? fn : undefined;
}

// `! name.txt` or EasyList's `! *** easylist:dir/name.txt ***`
const SECTION = /^!\s*(?:\*+\s*)?(?:\S*[/:])?([\w.-]+\.txt)(?:\s*\*+)?$/;

export function stripSections(text: string, dropPrefixes: string[]): string {
  let dropping = false;
  return text
    .split('\n')
    .filter((line) => {
      const name = SECTION.exec(line.trim())?.[1];
      if (name) dropping = dropPrefixes.some((p) => name.startsWith(p));
      return !dropping;
    })
    .join('\n');
}

const PARSE = { ...defaultParserOptions, tolerant: true, isLocIncluded: false, includeRaws: false };
const EXTENDED_CSS =
  /:(?:-abp-contains|-abp-properties|has-text|contains|xpath|matches-[\w-]+|upward|remove|remove-attr|remove-class|spath|style|min-text-length|watch-attr|others|if-not|nth-ancestor)\(/;
// shortcut: misses nesting behind a closing paren (`:has(:is(a) :has(b))`); Chrome then ignores just that one CSS rule.
const NESTED_HAS = /:has\([^)]*:has\(/;
// An escape (`\:`) and complete quoted strings are harmless; what is left must not hold a quote, brace, comment or lone backslash.
const ESCAPED_OR_QUOTED = /\\[^]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
const BREAKS_CSS = /\/\*|\*\/|[{};"'\\]/;
const HIDE_KINDS = new Map<string, 'generichide' | 'elemhide'>([
  ['generichide', 'generichide'],
  ['ghide', 'generichide'],
  ['elemhide', 'elemhide'],
  ['ehide', 'elemhide'],
  ['specifichide', 'elemhide'],
  ['shide', 'elemhide'],
]);
const HOST_IN_PATTERN = /^(?:\|\||\|?(?:[a-z][\w+.-]*)?:\/\/)([a-z0-9.*-]+)/i;

const NON_ASCII = /[^\x00-\x7f]/;

const push = <T>(map: Record<string, T[]>, key: string, value: T) => (map[key] ??= []).push(value);
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
// Tab hostnames come lowercased and in xn-- form, so filter domains are stored the same way.
const siteKey = (domain: string) => (NON_ASCII.test(domain) ? new URL(`http://${domain}`).hostname : domain.toLowerCase());

export async function compileFilters(text: string, opts: CompileOptions): Promise<CompiledList> {
  const out: CompiledList = { rules: [], sources: {}, allowIds: [], modifyIds: [], cosmetic: emptyCosmetic(), maxPriority: 0, dropped: {}, errors: [], skipped: [], filterLines: 0 };
  const drop = (reason: string, count = 1) => (out.dropped[reason] = (out.dropped[reason] ?? 0) + count);
  const network: { line: number; text: string }[] = [];

  text.split(/\r\n?|\n/).forEach((rawLine, i) => {
    const raw = rawLine.trim();
    const fail = (reason: string) => out.errors.push({ line: i + 1, text: raw, reason });
    const skip = (reason: string) => {
      drop(reason);
      out.skipped.push({ line: i + 1, text: raw, reason });
    };
    try {
      const node = RuleParser.parse(raw, PARSE);
      if (node.category === 'Empty' || node.category === 'Comment') return;
      out.filterLines++;
      if (node.category === 'Invalid') return fail(node.error.message);
      if (node.category === 'Cosmetic') {
        if (node.modifiers?.children.length) return skip('cosmetic-modifier');
        // agtree strips some procedural parts while parsing (`:matches-media(…)` vanishes), so check the line as written.
        if (node.type === 'ElementHidingRule' && EXTENDED_CSS.test(raw)) return skip('extended-css');
        for (const rule of RuleConverter.convertToAdg(node).result) addCosmetic(rule as AnyCosmeticRule, out.cosmetic, skip, opts);
        return;
      }
      if (node.category !== 'Network' || node.type !== 'NetworkRule') return;
      if (NON_ASCII.test(node.pattern.value)) return fail('Write the address in plain ASCII, with xn-- names for non-Latin sites');
      if (addCosmeticException(node, out.cosmetic, skip)) return;
      const rules = Rule.parseFromNode(1, 0, node); // throws what the batch converter would only report without a line
      if (rules.some(blocksEverySite)) return fail('Rule is too general: add an address or a domain= so it does not block every site');
      network.push({ line: i + 1, text: raw });
    } catch (e) {
      fail(messageOf(e).replace(/^"(.*)" in the rule: .*$/s, '$1'));
    }
  });

  if (network.length) await convertNetwork(network, opts, out, drop);
  out.errors.sort((a, b) => a.line - b.line);
  out.skipped.sort((a, b) => a.line - b.line);
  return out;
}

async function convertNetwork(
  network: { line: number; text: string }[],
  opts: CompileOptions,
  out: CompiledList,
  drop: (reason: string, count?: number) => void,
): Promise<void> {
  const byOffset = new Map<number, { line: number; text: string }>();
  let offset = 0;
  for (const entry of network) {
    byOffset.set(offset, entry);
    offset += entry.text.length + 1;
  }
  try {
    const [result] = await new FilterConverter().convert([new Filter(1, network.map((n) => n.text).join('\n'))], {
      withSourceMap: true,
      maxNumberOfRegexpRules: opts.regexLimit ?? 1000,
    });
    for (const [i, rule] of (await result.ruleset.getDeclarativeRules()).entries()) {
      const id = opts.firstId + i;
      out.rules.push({ ...rule, id } as DnrRule);
      out.sources[id] = (await result.ruleset.getRulesById(rule.id)).map((s) => s.sourceRule).join('\n');
      if (rule.action.type === 'allow' || rule.action.type === 'allowAllRequests') out.allowIds.push(id);
      if (rule.action.type === 'modifyHeaders') out.modifyIds.push(id);
      out.maxPriority = Math.max(out.maxPriority, rule.priority ?? 1);
    }
    for (const e of result.errors) {
      const at = isConversionError(e) ? e.rule.index : Number(/index - (\d+)/.exec(e.message)?.[1]);
      const entry = byOffset.get(at) ?? { line: 0, text: '' };
      const skipped =
        e instanceof UnsupportedModifierError || e instanceof EmptyResourcesError || e instanceof EmptyDomainsError
          ? 'unsupported-modifier'
          : /web accessible resources/.test(messageOf(e.cause))
            ? 'redirect'
            : null;
      if (skipped) {
        drop(skipped);
        if (entry.line) out.skipped.push({ ...entry, reason: skipped });
      } else {
        out.errors.push({ ...entry, reason: e instanceof UnsupportedRegexpError ? "Chrome can't run this regular expression" : e.message });
      }
    }
    for (const l of result.limitations) {
      drop(l instanceof TooManyRegexpRulesError ? 'regex-limit' : l.name, 'numberOfExcludedDeclarativeRules' in l ? l.numberOfExcludedDeclarativeRules : 1);
    }
  } catch (e) {
    for (const n of network) out.errors.push({ ...n, reason: `Sieve could not convert this filter: ${messageOf(e)}` });
  }
}

function blocksEverySite(rule: Rule): boolean {
  return !rule.allowlist && /^[|*]*$/.test(rule.pattern) && !rule.permittedDomains && !rule.permittedToDomains && !rule.advancedModifierName;
}

// $generichide/$elemhide/$specifichide only touch cosmetics (true: keep the line from the converter);
// $document also allows every request, so it still goes on to become an allowAllRequests rule.
function addCosmeticException(node: NetworkRule, cosmetic: CosmeticSet, drop: (reason: string) => void): boolean {
  const names = (node.modifiers?.children ?? []).filter((m) => !m.exception).map((m) => m.name.value);
  const namesDocument = names.some((n) => n === 'document' || n === 'doc');
  const document = node.exception && namesDocument;
  const kinds = new Set(names.flatMap((n) => HIDE_KINDS.get(n) ?? []));
  // Extra modifiers (`$generichide,third-party`) must not turn a hide exception into a network allow rule.
  const cosmeticOnly = kinds.size > 0 && !namesDocument;
  if ((!kinds.size && !document) || names.includes('badfilter')) return cosmeticOnly;
  const hosts = exceptionHosts(node);
  if (!node.exception || !hosts.length) {
    if (cosmeticOnly) drop('hide-exception-pattern');
    return cosmeticOnly;
  }
  if (document) kinds.add('elemhide');
  for (const kind of kinds) cosmetic[kind].push(...hosts);
  if (document) for (const host of hosts) push(cosmetic.scriptletExcept, host, '*');
  return cosmeticOnly;
}

// shortcut: a path-limited exception (`@@||bing.com/search?$generichide`) covers the whole host; fewer hidden ads there, never a broken page.
function exceptionHosts(node: NetworkRule): string[] {
  if (/^\**$/.test(node.pattern.value)) {
    const list = node.modifiers?.children.find((m) => m.name.value === 'domain' || m.name.value === 'from')?.value?.value ?? '';
    return list.split('|').filter((d) => d && !d.startsWith('~')).map(siteKey);
  }
  const host = HOST_IN_PATTERN.exec(node.pattern.value)?.[1];
  return host ? [siteKey(host.replace(/\.$/, '.*'))] : [];
}

function addCosmetic(rule: AnyCosmeticRule, cosmetic: CosmeticSet, drop: (reason: string) => void, opts: CompileOptions): void {
  const hosts = rule.domains.children.filter((d) => !d.exception && d.value !== '*').map((d) => siteKey(d.value));
  const notHosts = rule.domains.children.filter((d) => d.exception).map((d) => siteKey(d.value));
  const targets = hosts.length ? hosts : ['*'];
  if (rule.exception && notHosts.length) return drop('negated-exception');

  if (rule.type === 'ElementHidingRule') {
    const selector = rule.body.selectorList.value.replace(/:-abp-has\(/g, ':has(').replace(/:if\(/g, ':has(');
    if (EXTENDED_CSS.test(selector) || NESTED_HAS.test(selector)) return drop('extended-css');
    // Each selector becomes its own CSS rule in a shared stylesheet; a stray comment or brace would void the rules after it.
    if (BREAKS_CSS.test(selector.replace(ESCAPED_OR_QUOTED, ''))) throw new Error("A selector can't contain /*, */, {, } or ; outside quotes, an unclosed quote or a trailing backslash");
    if (rule.exception) for (const host of targets) push(cosmetic.unhide, host, selector);
    else if (hosts.length) for (const host of hosts) push(cosmetic.hide, host, selector);
    else cosmetic.generic.push(selector);
    if (!rule.exception) for (const host of notHosts) push(cosmetic.unhide, host, selector);
    return;
  }
  if (rule.type === 'ScriptletInjectionRule') {
    for (const params of rule.body.children.length ? rule.body.children : [{ children: [] }]) {
      const [name, ...args] = params.children.map((v) => (v ? QuoteUtils.removeQuotesAndUnescape(v.value) : ''));
      if (rule.exception && !name) {
        for (const host of targets) push(cosmetic.scriptletExcept, host, '*');
        continue;
      }
      const adgName = name ? scriptletsCompatibilityTable.getFirst(name, GenericPlatform.AdgAny)?.name : undefined;
      // The worker only has the scriptlets the lists use, so in My filters any other one would do nothing.
      if (!rule.exception && name && opts.scriptlets && !opts.scriptlets.includes(adgName ?? '')) {
        throw new Error(`${name.replace(/^(?:ubo|abp)-/, '')} isn't available in this build`); // the name as written, without agtree's prefix
      }
      if (!adgName || !scriptletFunction(adgName)) {
        drop('unknown-scriptlet');
        continue;
      }
      if (!rule.exception && !opts.trusted && adgName.startsWith('trusted-')) {
        drop('trusted-scriptlet');
        continue;
      }
      const call = { name: adgName, args };
      if (rule.exception) for (const host of targets) push(cosmetic.scriptletExcept, host, scriptletKey(call));
      else for (const host of targets) push(cosmetic.scriptlets, host, call);
      if (!rule.exception) for (const host of notHosts) push(cosmetic.scriptletExcept, host, scriptletKey(call));
    }
    return;
  }
  drop(rule.type === 'JsInjectionRule' ? 'raw-js' : rule.type === 'CssInjectionRule' ? 'css-injection' : 'html-filtering');
}
