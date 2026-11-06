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
  unhide: Record<string, string[]>;
  generichide: string[];
  elemhide: string[];
  scriptlets: Record<string, ScriptletCall[]>;
  scriptletExcept: Record<string, string[]>;
}

export interface CompiledList {
  rules: DnrRule[];
  sources: Record<number, string>;
  allowIds: number[];
  cosmetic: CosmeticSet;
  maxPriority: number;
  dropped: Record<string, number>;
  errors: { line: number; text: string; reason: string }[];
}

export function scriptletKey(call: ScriptletCall): string {
  return JSON.stringify([call.name, ...call.args]);
}

export function emptyCosmetic(): CosmeticSet {
  return { generic: [], hide: {}, unhide: {}, generichide: [], elemhide: [], scriptlets: {}, scriptletExcept: {} };
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
  /:(?:-abp-contains|-abp-properties|has-text|contains|xpath|matches-[\w-]+|upward|remove|style|min-text-length|watch-attr|others|if-not|nth-ancestor)\(/;
const HIDE_EXCEPTIONS: Record<string, 'generichide' | 'elemhide'> = { generichide: 'generichide', ghide: 'generichide', elemhide: 'elemhide', ehide: 'elemhide' };

const NON_ASCII = /[^\x00-\x7f]/;

const push = <T>(map: Record<string, T[]>, key: string, value: T) => (map[key] ??= []).push(value);
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
// Tab hostnames come lowercased and in xn-- form, so filter domains are stored the same way.
const siteKey = (domain: string) => (NON_ASCII.test(domain) ? new URL(`http://${domain}`).hostname : domain.toLowerCase());

export async function compileFilters(text: string, opts: { firstId: number; regexLimit?: number }): Promise<CompiledList> {
  const out: CompiledList = { rules: [], sources: {}, allowIds: [], cosmetic: emptyCosmetic(), maxPriority: 0, dropped: {}, errors: [] };
  const drop = (reason: string, count = 1) => (out.dropped[reason] = (out.dropped[reason] ?? 0) + count);
  const network: { line: number; text: string }[] = [];

  text.split(/\r\n?|\n/).forEach((rawLine, i) => {
    const raw = rawLine.trim();
    const fail = (reason: string) => out.errors.push({ line: i + 1, text: raw, reason });
    try {
      const node = RuleParser.parse(raw, PARSE);
      if (node.category === 'Invalid') return fail(node.error.message);
      if (node.category === 'Cosmetic') {
        if (node.modifiers?.children.length) return drop('cosmetic-modifier');
        for (const rule of RuleConverter.convertToAdg(node).result) addCosmetic(rule as AnyCosmeticRule, out.cosmetic, drop);
        return;
      }
      if (node.category !== 'Network' || node.type !== 'NetworkRule') return;
      if (NON_ASCII.test(node.pattern.value)) return fail('Write the address in plain ASCII, with xn-- names for non-Latin sites');
      if (addHideException(node, out.cosmetic, drop)) return;
      Rule.parseFromNode(1, 0, node); // throws what the batch converter would only report without a line
      network.push({ line: i + 1, text: raw });
    } catch (e) {
      fail(messageOf(e).replace(/^"(.*)" in the rule: .*$/s, '$1'));
    }
  });

  if (network.length) await convertNetwork(network, opts, out, drop);
  out.errors.sort((a, b) => a.line - b.line);
  return out;
}

async function convertNetwork(
  network: { line: number; text: string }[],
  opts: { firstId: number; regexLimit?: number },
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
      out.maxPriority = Math.max(out.maxPriority, rule.priority ?? 1);
    }
    for (const e of result.errors) {
      if (e instanceof UnsupportedModifierError || e instanceof EmptyResourcesError || e instanceof EmptyDomainsError) {
        drop('unsupported-modifier');
      } else if (/web accessible resources/.test(messageOf(e.cause))) {
        drop('redirect');
      } else {
        const at = isConversionError(e) ? e.rule.index : Number(/index - (\d+)/.exec(e.message)?.[1]);
        const entry = byOffset.get(at);
        const reason = e instanceof UnsupportedRegexpError ? "Chrome can't run this regular expression" : e.message;
        out.errors.push({ line: entry?.line ?? 0, text: entry?.text ?? '', reason });
      }
    }
    for (const l of result.limitations) {
      drop(l instanceof TooManyRegexpRulesError ? 'regex-limit' : l.name, 'numberOfExcludedDeclarativeRules' in l ? l.numberOfExcludedDeclarativeRules : 1);
    }
  } catch (e) {
    for (const n of network) out.errors.push({ ...n, reason: `Sieve could not convert this filter: ${messageOf(e)}` });
  }
}

// shortcut: a path-limited exception (`@@||bing.com/search?$generichide`) covers the whole host; fewer hidden ads there, never a broken page.
function addHideException(node: NetworkRule, cosmetic: CosmeticSet, drop: (reason: string) => void): boolean {
  const modifiers = node.modifiers?.children ?? [];
  const kind = modifiers.map((m) => HIDE_EXCEPTIONS[m.name.value]).find(Boolean);
  if (!kind) return false;
  const domains = modifiers.find((m) => m.name.value === 'domain')?.value?.value.split('|').filter((d) => !d.startsWith('~')) ?? [];
  const host = /^\|\|([a-z0-9.*-]+)/i.exec(node.pattern.value)?.[1].replace(/\.$/, '.*');
  const hosts = node.pattern.value === '' ? domains : host ? [host] : [];
  if (!node.exception || !hosts.length) drop('hide-exception-pattern');
  else cosmetic[kind].push(...hosts.map(siteKey));
  return true;
}

function addCosmetic(rule: AnyCosmeticRule, cosmetic: CosmeticSet, drop: (reason: string) => void): void {
  const hosts = rule.domains.children.filter((d) => !d.exception && d.value !== '*').map((d) => siteKey(d.value));
  const notHosts = rule.domains.children.filter((d) => d.exception).map((d) => siteKey(d.value));
  const targets = hosts.length ? hosts : ['*'];
  if (rule.exception && notHosts.length) return drop('negated-exception');

  if (rule.type === 'ElementHidingRule') {
    const selector = rule.body.selectorList.value.replace(/:-abp-has\(/g, ':has(').replace(/:if\(/g, ':has(');
    if (EXTENDED_CSS.test(selector)) return drop('extended-css');
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
      if (!adgName || typeof scriptlets.getScriptletFunction(adgName) !== 'function') {
        drop('unknown-scriptlet');
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
