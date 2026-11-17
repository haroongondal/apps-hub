import * as cheerio from 'cheerio'
import type { Cheerio } from 'cheerio'
import type { AnyNode, Element } from 'domhandler'

export interface ScreenshotOptions {
  maxWidth?: number
  maxHeight?: number
  quality?: number
}

export interface OptimizedScreenshot {
  base64: string
  mimeType: 'image/jpeg'
  width: number
  height: number
  byteLength: number
}

export async function optimizeScreenshot(
  input: Buffer | string,
  options: ScreenshotOptions = {}
): Promise<OptimizedScreenshot> {
  const { maxWidth = 1024, maxHeight = 768, quality = 55 } = options
  const { nativeImage } = await import('electron')
  const buffer = typeof input === 'string' ? Buffer.from(stripDataUrlPrefix(input), 'base64') : input
  let image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) throw new Error('optimizeScreenshot: input is not a decodable image')

  const { width, height } = image.getSize()
  const scale = Math.min(maxWidth / width, maxHeight / height, 1)
  if (scale < 1) {
    image = image.resize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      quality: 'good'
    })
  }

  const jpeg = image.toJPEG(quality)
  const size = image.getSize()
  return {
    base64: jpeg.toString('base64'),
    mimeType: 'image/jpeg',
    width: size.width,
    height: size.height,
    byteLength: jpeg.byteLength
  }
}

function stripDataUrlPrefix(value: string): string {
  if (!value.startsWith('data:')) return value
  const comma = value.indexOf(',')
  return comma === -1 ? value : value.slice(comma + 1)
}

export interface DomFilterOptions {
  maxTextLength?: number
  maxAttributeLength?: number
  keepClasses?: boolean
  extraAttributes?: string[]
  dropHidden?: boolean
}

export interface FilteredDom {
  html: string
  title: string | null
  originalChars: number
  filteredChars: number
}

const DROP_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'canvas',
  'video', 'audio', 'source', 'track', 'object', 'embed', 'map',
  'base', 'link', 'meta'
])

const INTERACTIVE_TAGS = new Set([
  'a', 'button', 'input', 'select', 'textarea', 'option', 'optgroup',
  'form', 'label', 'fieldset', 'legend', 'summary', 'details', 'dialog'
])

const SEMANTIC_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'ul', 'ol', 'dl', 'dt', 'dd',
  'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'main', 'nav', 'header', 'footer', 'article', 'section', 'aside',
  'figure', 'figcaption', 'blockquote', 'pre', 'img', 'iframe'
])

const SELF_MEANINGFUL = new Set(['img', 'iframe', 'td', 'th'])

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'textbox', 'searchbox', 'combobox',
  'listbox', 'option', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'switch', 'tab', 'tablist', 'slider', 'spinbutton',
  'grid', 'gridcell', 'treeitem'
])

const BASE_KEEP_ATTRS = new Set([
  'id', 'name', 'type', 'value', 'href', 'src', 'placeholder', 'alt', 'title',
  'role', 'for', 'action', 'method', 'checked', 'selected', 'disabled',
  'required', 'readonly', 'min', 'max', 'step', 'maxlength', 'rows', 'cols',
  'colspan', 'rowspan', 'open', 'contenteditable', 'tabindex', 'multiple',
  'accept', 'pattern', 'inputmode', 'autocomplete', 'label'
])

const TEST_ID_ATTRS = new Set(['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy'])

const INLINE_TAGS = new Set([
  'span', 'b', 'i', 'u', 's', 'em', 'strong', 'small', 'mark', 'abbr', 'sub', 'sup',
  'code', 'cite', 'q', 'kbd', 'samp', 'var', 'bdi', 'bdo', 'data', 'dfn', 'ins', 'del',
  'ruby', 'rt', 'rp', 'font', 'tt'
])

const HANDLER_ATTR = /^on[a-z]+$/

export function filterDom(html: string, options: DomFilterOptions = {}): FilteredDom {
  const {
    maxTextLength = 200,
    maxAttributeLength = 250,
    keepClasses = false,
    extraAttributes = [],
    dropHidden = true
  } = options

  const $ = cheerio.load(html)
  const title = $('head > title').first().text().trim() || null
  const keepAttrs = new Set([
    ...BASE_KEEP_ATTRS,
    ...(keepClasses ? ['class'] : []),
    ...extraAttributes.map((a) => a.toLowerCase())
  ])

  $('head').remove()
  $([...DROP_TAGS].join(', ')).remove()
  removeComments($)

  const body = $('body').get(0)
  if (body) {
    for (const child of [...body.children]) {
      if (isElement(child)) filterElement($, child, { keepAttrs, maxAttributeLength, dropHidden })
    }
  }

  compactText($, maxTextLength)

  const filtered = ($('body').html() ?? '').trim()
  return { html: filtered, title, originalChars: html.length, filteredChars: filtered.length }
}

interface FilterContext {
  keepAttrs: Set<string>
  maxAttributeLength: number
  dropHidden: boolean
}

function filterElement($: cheerio.CheerioAPI, el: Element, ctx: FilterContext): void {
  const $el = $(el)
  const tag = el.name.toLowerCase()

  if (ctx.dropHidden && isHidden(el, tag)) {
    dropElement($el, tag)
    return
  }
  if (tag === 'br') {
    $el.replaceWith(' ')
    return
  }
  if (tag === 'wbr') {
    $el.remove()
    return
  }

  for (const child of [...el.children]) {
    if (isElement(child)) filterElement($, child, ctx)
  }

  const interactive = isInteractive(el, tag)
  stripAttributes($, el, ctx)
  if (interactive) return

  const hasElementChildren = el.children.some(isElement)
  const hasText = $el.text().trim().length > 0

  if (SEMANTIC_TAGS.has(tag)) {
    if (!hasElementChildren && !hasText && !SELF_MEANINGFUL.has(tag)) dropElement($el, tag)
    return
  }
  if (Object.keys(el.attribs).length === 0) {
    if (hasElementChildren || hasText) unwrapElement($el, tag)
    else dropElement($el, tag)
    return
  }
  if (!hasElementChildren && !hasText) dropElement($el, tag)
}

function dropElement($el: Cheerio<Element>, tag: string): void {
  if (INLINE_TAGS.has(tag)) $el.remove()
  else $el.replaceWith(' ')
}

function unwrapElement($el: Cheerio<Element>, tag: string): void {
  if (!INLINE_TAGS.has(tag)) {
    $el.before(' ')
    $el.after(' ')
  }
  $el.replaceWith($el.contents())
}

function isElement(node: AnyNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style'
}

function removeComments($: cheerio.CheerioAPI): void {
  $.root()
    .find('*')
    .addBack()
    .contents()
    .each((_, node) => {
      if (node.type === 'comment') $(node).remove()
    })
}

function isHidden(el: Element, tag: string): boolean {
  const attribs = el.attribs
  if ('hidden' in attribs) return true
  if (attribs['aria-hidden'] === 'true') return true
  const style = attribs['style']
  if (style && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) return true
  return tag === 'input' && attribs['type']?.toLowerCase() === 'hidden'
}

function isInteractive(el: Element, tag: string): boolean {
  if (INTERACTIVE_TAGS.has(tag)) return true
  const attribs = el.attribs
  const role = attribs['role']?.toLowerCase()
  if (role !== undefined && INTERACTIVE_ROLES.has(role)) return true
  if ('contenteditable' in attribs || 'tabindex' in attribs) return true
  return Object.keys(attribs).some((name) => HANDLER_ATTR.test(name.toLowerCase()))
}

function stripAttributes($: cheerio.CheerioAPI, el: Element, ctx: FilterContext): void {
  const $el = $(el)
  let hadHandler = false
  for (const name of Object.keys(el.attribs)) {
    const lower = name.toLowerCase()
    if (HANDLER_ATTR.test(lower)) {
      hadHandler = true
      $el.removeAttr(name)
      continue
    }
    const keep = ctx.keepAttrs.has(lower) || lower.startsWith('aria-') || TEST_ID_ATTRS.has(lower)
    if (!keep) {
      $el.removeAttr(name)
      continue
    }
    const value = el.attribs[name]
    if (value && value.length > ctx.maxAttributeLength) {
      $el.attr(name, truncate(value, ctx.maxAttributeLength))
    }
  }
  if (hadHandler) $el.attr('onclick', '')
}

function compactText($: cheerio.CheerioAPI, maxTextLength: number): void {
  $('body').find('*').addBack().contents().each((_, node) => {
    if (node.type !== 'text') return
    const text = node as unknown as { data: string }
    if (hasAncestor(node, 'pre')) return
    let data = text.data.replace(/\s+/g, ' ')
    if (data.length > maxTextLength) data = truncate(data, maxTextLength)
    text.data = data
  })
}

function truncate(value: string, max: number): string {
  const cut = value.slice(0, max).replace(/[\uD800-\uDBFF]$/, '')
  return cut.trimEnd() + '…'
}

function hasAncestor(node: AnyNode, tag: string): boolean {
  let current = node.parent
  while (current) {
    if (isElement(current) && current.name.toLowerCase() === tag) return true
    current = current.parent
  }
  return false
}
