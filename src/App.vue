<template>
  <v-app>
    <div class="main">
      <div class="container bd-layout" style="padding: 40px">
        <h2>HL7 FHIR Spec Diff Viewer</h2>
        <br />
        <div v-if="rawMode" class="main">
          <v-text-field density="compact" :label="'Old Page URL  (' + formatBytes(rawProgressOld) + ')'" v-model="oldUrl" :readonly="loading" :loading="loading" :error-messages="rawErrorOld" />
          <v-text-field density="compact" :label="'New Page URL  (' + formatBytes(rawProgressNew) + ')'" v-model="newUrl" :readonly="loading" :loading="loading" :error-messages="rawErrorNew" />
          <v-btn @click="startCompare" :disabled="!oldUrl || !newUrl || loading">
            <v-icon> mdi-file-compare </v-icon> Compare
          </v-btn>
          <p></p>
          <p v-if="validationError" style="color: red; margin-top: 12px;">{{ validationError }}</p>
          <div style="max-width: 400px; font-size: 0.85em; color: #666; text-align: left;">
            <div style="text-align: left;">{{ rawStatus }}</div>
          </div>
          <p v-if="rawError" style="color: red;">{{ rawError }}</p>
        </div>
        <div v-else class="main">
          <div>
            <v-text-field density="compact" label="Old Page URL" v-model="oldUrl" />
            <v-text-field density="compact" label="New Page URL" v-model="newUrl" />
            <v-btn @click="startCompare" :disabled="!oldUrl || !newUrl">
              <v-icon> mdi-file-compare </v-icon> Compare
            </v-btn>
            <p v-if="validationError" style="color: red; margin-top: 12px;">{{ validationError }}</p>
          </div>
        </div>
      </div>
    </div>
  </v-app>
</template>

<style scoped>
.error-url {
  font-size: 0.8em;
  font-style: italic;
  color: #555;
  padding-left: 40px;
}
</style>
<style>
.diffins {
  background-color: #b6ffa7;
}

.diffmod {
  background-color: #a7e0ff;
}

del.diffmod {
  background-color: #feccbf;
}

ins.diffmod {
  background-color: #b6ffa7;
}

.diffdel {
  background-color: #feccbf;
}
</style>

<style lang="scss" scoped>
.leader {
  font-size: x-large;
}

p {
  text-align: justify;
  text-justify: inter-word;
}

</style>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import axios from 'axios'

document.title = 'HL7 FHIR Spec Diff Viewer - FHIRPath Lab'

const downloaderPrefix = undefined; //'https://fhirpath-lab-dotnet2.azurewebsites.net/api/downloader?url='

// Allowlist
const allowedSites = ref<string[]>([])
const validationError = ref('')

// Reactive state
const rawMode = ref(false)
const loading = ref(false)
const rawStatus = ref('')
const rawError = ref('')
const rawErrorOld = ref('')
const rawErrorNew = ref('')
const rawProgressOld = ref(0)
const rawProgressNew = ref(0)

// Form inputs (shown when no query params)
const oldUrl = ref('https://hl7.org/fhir/us/core/STU8.0.1/index.html')
const newUrl = ref('https://build.fhir.org/ig/HL7/US-Core/index.html')

// Internal state for raw mode
const oldSpecHtml = ref('')
const newSpecHtml = ref('')
const activeOldUrl = ref('')
const activeNewUrl = ref('')

// Methods
function isUrlAllowed(url: string): boolean {
  try {
    const parsed = new URL(url.startsWith('http') ? url : 'https://' + url);
    if (parsed.protocol !== 'https:') return false;
    const hostAndPath = parsed.host + parsed.pathname + parsed.search;

    return allowedSites.value.some(site =>
      hostAndPath === site ||
      hostAndPath.startsWith(site + '/')
    );
  } catch {
    return false
  }
}

function validateUrls(oldPageUrl: string, newPageUrl: string): boolean {
  validationError.value = ''
  const blocked: string[] = []
  if (!isUrlAllowed(oldPageUrl)) blocked.push('Old URL')
  if (!isUrlAllowed(newPageUrl)) blocked.push('New URL')
  if (blocked.length > 0) {
    validationError.value = `${blocked.join(' and ')} not from an allowed site.`
    return false
  }
  return true
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function startCompare() {
  if (!validateUrls(oldUrl.value, newUrl.value)) return
  const params = new URLSearchParams({ old: oldUrl.value, new: newUrl.value })
  history.pushState(null, '', window.location.pathname + '?' + params.toString())
  downloadAndCompare(oldUrl.value, newUrl.value)
}

function wrapWithProxy(url: string): string {
  if (downloaderPrefix?.length > 0) {
    url = downloaderPrefix + encodeURIComponent(url);
  }

  return url
}

function getBaseUrl(url: string): string {
  if (url.startsWith(downloaderPrefix)) {
    url = url.substring(downloaderPrefix.length)
  }
  // If the last path segment has no extension, treat it as a directory
  const lastSlash = url.lastIndexOf('/')
  const lastSegment = url.substring(lastSlash + 1)
  if (!lastSegment || lastSegment.indexOf('.') === -1) {
    return url.endsWith('/') ? url : url + '/'
  }
  return url.substring(0, lastSlash + 1)
}

function rebaseHeadUrls(html: string, newBaseUrl: string, oldBaseUrl: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  doc.head.querySelectorAll('[href], [src]').forEach(el => {
    for (const attr of ['href', 'src']) {
      const val = el.getAttribute(attr)
      if (val && !/^(https?:\/\/|\/\/|data:|#|mailto:)/i.test(val)) {
        el.setAttribute(attr, newBaseUrl + val)
      }
    }
  })

  // Rewrite any <meta http-equiv="refresh"> redirects to point at the diff page
  // instead of navigating away, mirroring what rewriteRelativeLinks does for body links.
  const diffPagePath = window.location.pathname
  doc.head.querySelectorAll('meta[http-equiv]').forEach(el => {
    if (el.getAttribute('http-equiv')?.toLowerCase() !== 'refresh') return
    const content = el.getAttribute('content') || ''
    // Content is either just a delay ("5") or "delay; url=<url>"
    const match = content.match(/^(\d+);\s*url\s*=\s*['"]?([^'"]+?)['"]?\s*$/i)
    if (!match) return
    const delay = match[1]
    const rawUrl = match[2].trim()
    try {
      const newTarget = new URL(rawUrl, newBaseUrl).href
      const oldTarget = new URL(rawUrl, oldBaseUrl).href
      const diffUrl = diffPagePath + '?old=' + encodeURIComponent(oldTarget) + '&new=' + encodeURIComponent(newTarget)
      el.setAttribute('content', delay + '; url=' + diffUrl)
    } catch (e) {
      // If URL resolution fails, remove the tag to prevent a broken redirect
      console.warn('Failed to resolve meta refresh URL, removing tag:', rawUrl, e)
      el.remove()
    }
  })

  return doc.head.innerHTML
}

function rebaseBodySrcUrls(html: string, baseUrl: string): string {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html
  tempDiv.querySelectorAll('[src]').forEach(el => {
    const val = el.getAttribute('src')
    if (val && !/^(https?:\/\/|\/\/|data:|#|mailto:)/i.test(val)) {
      el.setAttribute('src', baseUrl + val)
    }
  })
  return tempDiv.innerHTML
}

function extractBody(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
  return match ? match[1] : html
}

const releaseHeaderPlaceholderSelector = '[data-hl7-diff-release-header]'
const releaseHeaderPlaceholderHtml = '<div data-hl7-diff-release-header="true"></div>'

function normalizeReleaseHeaders(oldHtml: string, newHtml: string) {
  const releaseHeaderPattern = /<!--\s*ReleaseHeader\s*-->[\s\S]*?<!--\s*EndReleaseHeader\s*-->/i
  if (!releaseHeaderPattern.test(oldHtml) && !releaseHeaderPattern.test(newHtml)) {
    return { oldHtml, newHtml, hasReleaseHeader: false }
  }

  const normalizePage = (html: string): string => {
    const container = document.createElement('div')
    container.innerHTML = html.replace(releaseHeaderPattern, releaseHeaderPlaceholderHtml)

    if (!container.querySelector(releaseHeaderPlaceholderSelector)) {
      const statusBanner = Array.from(container.querySelectorAll('p')).find((paragraph) =>
        paragraph.id === 'publish-box'
        || /Continuous Integration Build of FHIR/i.test(paragraph.textContent || '')
      )
      const placeholder = document.createElement('div')
      placeholder.setAttribute('data-hl7-diff-release-header', 'true')

      if (statusBanner) {
        statusBanner.replaceWith(placeholder)
      } else {
        container.querySelector('ul.nav.nav-tabs')?.before(placeholder)
      }
    }

    return container.innerHTML
  }

  return {
    oldHtml: normalizePage(oldHtml),
    newHtml: normalizePage(newHtml),
    hasReleaseHeader: true,
  }
}

function executeDiffInWorker(oldHtml: string, newHtml: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./workers/htmldiff.worker.ts', import.meta.url),
      { type: 'module' }
    )
    worker.onmessage = (e: MessageEvent<string>) => {
      resolve(e.data)
      worker.terminate()
    }
    worker.onerror = (e) => {
      reject(new Error(e.message))
      worker.terminate()
    }
    worker.postMessage({ oldHtml, newHtml })
  })
}

type TabListKind = 'navigation' | 'resource-content'

interface TabEntry {
  listItem: HTMLLIElement
  label: string
  key: string
}

function tabKey(label: string, kind: TabListKind): string {
  const normalized = label.replace(/\s+/g, ' ').trim().toLowerCase()
  if (normalized === 'profiles' || normalized === 'profiles & extensions') return 'profiles'
  if (kind === 'resource-content' && (normalized === 'version diff' || /^r\d+b? diff$/.test(normalized))) {
    return 'version-diff'
  }
  if (/^r\d+b? conversions$/.test(normalized)) return 'version-conversions'
  return normalized
}

function tabEntries(list: HTMLUListElement, kind: TabListKind): TabEntry[] {
  return Array.from(list.children)
    .filter((child): child is HTMLLIElement => child instanceof HTMLLIElement)
    .map((listItem) => {
      const label = listItem.querySelector('a')?.textContent || ''
      return { listItem, label, key: tabKey(label, kind) }
    })
}

function wrapTabLabel(listItem: HTMLLIElement, tagName: 'ins' | 'del', className: string) {
  const anchor = listItem.querySelector('a')
  if (!anchor) return
  const marker = document.createElement(tagName)
  marker.className = className
  marker.append(...Array.from(anchor.childNodes))
  anchor.appendChild(marker)
}

function disableResourceTab(listItem: HTMLLIElement) {
  listItem.dataset.diffDisabled = 'true'
  listItem.classList.add('ui-state-disabled')
  const anchor = listItem.querySelector('a')
  anchor?.setAttribute('aria-disabled', 'true')
  anchor?.setAttribute('tabindex', '-1')
}

function buildNewNavigationTabList(newList: HTMLUListElement): HTMLUListElement {
  const result = newList.cloneNode(true) as HTMLUListElement
  tabEntries(result, 'navigation').forEach(({ listItem, key }) => {
    if (key !== 'version-conversions') return
    listItem.classList.add('disabled')
    const anchor = listItem.querySelector('a')
    anchor?.removeAttribute('href')
    anchor?.setAttribute('aria-disabled', 'true')
    anchor?.setAttribute('tabindex', '-1')
  })
  return result
}

function compareTabLabel(listItem: HTMLLIElement, oldLabel: string, newLabel: string) {
  const anchor = listItem.querySelector('a')
  if (!anchor || oldLabel === newLabel) return

  anchor.replaceChildren()
  let prefixLength = 0
  while (
    prefixLength < oldLabel.length &&
    prefixLength < newLabel.length &&
    oldLabel[prefixLength] === newLabel[prefixLength]
  ) {
    prefixLength++
  }

  let suffixLength = 0
  while (
    suffixLength < oldLabel.length - prefixLength &&
    suffixLength < newLabel.length - prefixLength &&
    oldLabel[oldLabel.length - suffixLength - 1] === newLabel[newLabel.length - suffixLength - 1]
  ) {
    suffixLength++
  }

  const prefix = newLabel.substring(0, prefixLength)
  const oldMiddle = oldLabel.substring(prefixLength, oldLabel.length - suffixLength)
  const newMiddle = newLabel.substring(prefixLength, newLabel.length - suffixLength)
  const suffix = newLabel.substring(newLabel.length - suffixLength)

  anchor.append(prefix)
  if (oldMiddle) {
    const removed = document.createElement('del')
    removed.className = 'diffmod'
    removed.textContent = oldMiddle
    anchor.appendChild(removed)
  }
  if (newMiddle) {
    const inserted = document.createElement('ins')
    inserted.className = 'diffmod'
    inserted.textContent = newMiddle
    anchor.appendChild(inserted)
  }
  anchor.append(suffix)
}

function buildComparedTabList(
  oldList: HTMLUListElement,
  newList: HTMLUListElement,
  kind: TabListKind,
): HTMLUListElement {
  const oldTabs = tabEntries(oldList, kind)
  const newTabs = tabEntries(newList, kind)
  const lengths = Array.from({ length: oldTabs.length + 1 }, () =>
    Array<number>(newTabs.length + 1).fill(0),
  )

  for (let oldIndex = oldTabs.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newTabs.length - 1; newIndex >= 0; newIndex--) {
      lengths[oldIndex][newIndex] = oldTabs[oldIndex].key === newTabs[newIndex].key
        ? lengths[oldIndex + 1][newIndex + 1] + 1
        : Math.max(lengths[oldIndex + 1][newIndex], lengths[oldIndex][newIndex + 1])
    }
  }

  const result = newList.cloneNode(false) as HTMLUListElement
  let oldIndex = 0
  let newIndex = 0
  while (oldIndex < oldTabs.length || newIndex < newTabs.length) {
    if (
      oldIndex < oldTabs.length &&
      newIndex < newTabs.length &&
      oldTabs[oldIndex].key === newTabs[newIndex].key
    ) {
      if (kind === 'resource-content' && newTabs[newIndex].key === 'version-diff') {
        const oldListItem = oldTabs[oldIndex].listItem.cloneNode(true) as HTMLLIElement
        const newListItem = newTabs[newIndex].listItem.cloneNode(true) as HTMLLIElement
        oldListItem.querySelector('a')?.setAttribute('href', '#tabs-diff-old')
        newListItem.querySelector('a')?.setAttribute('href', '#tabs-diff-new')
        wrapTabLabel(oldListItem, 'del', 'diffdel')
        wrapTabLabel(newListItem, 'ins', 'diffins')
        disableResourceTab(oldListItem)
        result.append(oldListItem, newListItem)
        oldIndex++
        newIndex++
        continue
      }

      const listItem = newTabs[newIndex].listItem.cloneNode(true) as HTMLLIElement
      compareTabLabel(listItem, oldTabs[oldIndex].label, newTabs[newIndex].label)
      if (kind === 'resource-content' && newTabs[newIndex].key === 'all') {
        disableResourceTab(listItem)
      }
      result.appendChild(listItem)
      oldIndex++
      newIndex++
    } else if (
      newIndex >= newTabs.length ||
      (oldIndex < oldTabs.length && lengths[oldIndex + 1][newIndex] >= lengths[oldIndex][newIndex + 1])
    ) {
      const listItem = oldTabs[oldIndex].listItem.cloneNode(true) as HTMLLIElement
      listItem.classList.remove('active')
      wrapTabLabel(listItem, 'del', 'diffdel')
      result.appendChild(listItem)
      oldIndex++
    } else {
      const listItem = newTabs[newIndex].listItem.cloneNode(true) as HTMLLIElement
      wrapTabLabel(listItem, 'ins', 'diffins')
      result.appendChild(listItem)
      newIndex++
    }
  }

  return result
}

function maskSpecialResourcePanels(html: string): string {
  const container = document.createElement('div')
  container.innerHTML = html

  for (const panelId of ['tabs-uml', 'tabs-diff', 'tabs-all']) {
    const panel = container.querySelector<HTMLElement>(`#${panelId}`)
    if (!panel) continue
    const placeholder = document.createElement('span')
    placeholder.dataset.diffPanelPlaceholder = panelId
    panel.replaceChildren(placeholder)
  }

  return container.innerHTML
}

function prefixFragmentIds(root: HTMLElement, prefix: string) {
  const idMap = new Map<string, string>()
  root.querySelectorAll<HTMLElement>('[id]').forEach((element) => {
    const oldId = element.id
    const newId = `${prefix}${oldId}`
    idMap.set(oldId, newId)
    element.id = newId
  })

  root.querySelectorAll<HTMLElement>('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      let value = attribute.value.replace(/url\(\s*#([^)\s]+)\s*\)/g, (match, id) =>
        idMap.has(id) ? `url(#${idMap.get(id)})` : match,
      )
      if (value.startsWith('#') && idMap.has(value.substring(1))) {
        value = `#${idMap.get(value.substring(1))}`
      }
      if (value !== attribute.value) {
        element.setAttribute(attribute.name, value)
      }
    })
  })
}

function clonePanelContent(panel: HTMLElement, className: string, source: 'old' | 'new'): HTMLDivElement {
  const wrapper = document.createElement('div')
  wrapper.className = className
  wrapper.dataset.diffSource = source
  wrapper.append(...Array.from(panel.childNodes, (node) => node.cloneNode(true)))
  prefixFragmentIds(wrapper, `diff-${source}-`)
  return wrapper
}

function cloneVersionPanel(panel: HTMLElement, source: 'old' | 'new', includeContent = true): HTMLElement {
  const clone = panel.cloneNode(includeContent) as HTMLElement
  clone.removeAttribute('id')
  prefixFragmentIds(clone, `diff-${source}-`)
  clone.id = `tabs-diff-${source}`
  clone.dataset.diffSource = source
  return clone
}

function restoreSpecialResourcePanels(
  diffContainer: HTMLElement,
  oldContainer: HTMLElement,
  newContainer: HTMLElement,
) {
  const diffUmlPanel = diffContainer.querySelector<HTMLElement>('#tabs-uml')
  const oldUmlPanel = oldContainer.querySelector<HTMLElement>('#tabs-uml')
  const newUmlPanel = newContainer.querySelector<HTMLElement>('#tabs-uml')
  if (diffUmlPanel && oldUmlPanel && newUmlPanel) {
    diffUmlPanel.replaceChildren(
      clonePanelContent(oldUmlPanel, 'diffdel', 'old'),
      clonePanelContent(newUmlPanel, 'diffins', 'new'),
    )
  }

  const diffVersionPanel = diffContainer.querySelector<HTMLElement>('#tabs-diff')
  const oldVersionPanel = oldContainer.querySelector<HTMLElement>('#tabs-diff')
  const newVersionPanel = newContainer.querySelector<HTMLElement>('#tabs-diff')
  if (diffVersionPanel && oldVersionPanel && newVersionPanel) {
    diffVersionPanel.replaceWith(
      cloneVersionPanel(oldVersionPanel, 'old', false),
      cloneVersionPanel(newVersionPanel, 'new'),
    )
  }

  diffContainer.querySelector<HTMLElement>('#tabs-all')?.replaceChildren()
}

function replaceComparedTabLists(diffHtml: string, oldHtml: string, newHtml: string): string {
  const oldContainer = document.createElement('div')
  const newContainer = document.createElement('div')
  const diffContainer = document.createElement('div')
  oldContainer.innerHTML = oldHtml
  newContainer.innerHTML = newHtml
  diffContainer.innerHTML = diffHtml

  const newGlobalNavigation = newContainer.querySelector<HTMLElement>('nav.navbar.navbar-inverse')
  const diffGlobalNavigation = diffContainer.querySelector<HTMLElement>('nav.navbar.navbar-inverse')
  if (newGlobalNavigation && diffGlobalNavigation) {
    diffGlobalNavigation.replaceWith(newGlobalNavigation.cloneNode(true))
  }

  const newFooter = newContainer.querySelector<HTMLElement>('#segment-footer')
  const diffFooter = diffContainer.querySelector<HTMLElement>('#segment-footer')
  if (newFooter && diffFooter) {
    diffFooter.replaceWith(newFooter.cloneNode(true))
  }

  const newNavigation = newContainer.querySelector<HTMLUListElement>('ul.nav.nav-tabs')
  const diffNavigation = diffContainer.querySelector<HTMLUListElement>('ul.nav.nav-tabs')
  if (newNavigation && diffNavigation) {
    diffNavigation.replaceWith(buildNewNavigationTabList(newNavigation))
  }

  const oldResourceTabs = oldContainer.querySelector<HTMLUListElement>('#tabs > ul')
  const newResourceTabs = newContainer.querySelector<HTMLUListElement>('#tabs > ul')
  const diffResourceTabs = diffContainer.querySelector<HTMLUListElement>('#tabs > ul')
  if (oldResourceTabs && newResourceTabs && diffResourceTabs) {
    diffResourceTabs.replaceWith(buildComparedTabList(oldResourceTabs, newResourceTabs, 'resource-content'))
  }

  const isTabInitializer = (script: HTMLScriptElement) =>
    /\$\s*\(\s*['"]#tabs['"]\s*\)\.tabs\s*\(/.test(script.textContent || '')
  const newTabInitializer = Array.from(newContainer.querySelectorAll<HTMLScriptElement>('script:not([src])'))
    .find(isTabInitializer)
  const diffTabInitializer = Array.from(diffContainer.querySelectorAll<HTMLScriptElement>('script:not([src])'))
    .find(isTabInitializer)
  if (newTabInitializer && diffTabInitializer) {
    const initializer = newTabInitializer.cloneNode(true) as HTMLScriptElement
    initializer.textContent += `
try {
  var diffDisabledTabs = [];
  $('#tabs > ul > li[data-diff-disabled="true"]').each(function() {
    diffDisabledTabs.push($(this).index());
  });
  var diffActiveTab = $('#tabs').tabs('option', 'active');
  if (diffDisabledTabs.indexOf(diffActiveTab) !== -1) {
    $('#tabs').tabs('option', 'active', 0);
  }
  $('#tabs').tabs('option', 'disabled', diffDisabledTabs);
} catch(exception) {
}
`
    diffTabInitializer.replaceWith(initializer)
  }

  restoreSpecialResourcePanels(diffContainer, oldContainer, newContainer)

  return diffContainer.innerHTML
}

async function comparePages() {
  const normalizedPages = normalizeReleaseHeaders(
    extractBody(oldSpecHtml.value),
    extractBody(newSpecHtml.value),
  )
  const oldHtml = normalizedPages.oldHtml
  const newHtml = normalizedPages.newHtml

  try {
    rawStatus.value = 'Computing diff...'
    const rawDiff = await executeDiffInWorker(
      maskSpecialResourcePanels(oldHtml),
      maskSpecialResourcePanels(newHtml),
    )
    const val = replaceComparedTabLists(rawDiff, oldHtml, newHtml)
    renderRawDiff(val, activeOldUrl.value, activeNewUrl.value, normalizedPages.hasReleaseHeader)
  } catch (e) {
    console.error(e)
    rawError.value = 'Diff computation failed: ' + (e as Error).message
  }
}

function rewriteRelativeLinks(html: string, oldBaseUrl: string, newBaseUrl: string): string {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html
  const diffPagePath = window.location.pathname
  tempDiv.querySelectorAll('a[href]').forEach(el => {
    const href = el.getAttribute('href')
    if (!href) return
    // Skip absolute, anchor-only, mailto, data, javascript links
    if (/^(https?:\/\/|\/\/|#|mailto:|data:|javascript:)/i.test(href)) return
    // Skip non-page resources
    if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|json|xml|zip|pdf)$/i.test(href)) return
    // Strip any fragment for URL resolution, preserve it for display
    const [path, fragment] = href.split('#')
    if (!path) return // anchor-only like #foo was already skipped, but just in case
    try {
      const newTarget = new URL(path, newBaseUrl).href
      const oldTarget = new URL(path, oldBaseUrl).href
      const diffUrl = diffPagePath + '?old=' + encodeURIComponent(oldTarget) + '&new=' + encodeURIComponent(newTarget)
      el.setAttribute('href', diffUrl + (fragment ? '#' + fragment : ''))
    } catch (_) {
      // If URL resolution fails, leave link as-is
    }
  })
  return tempDiv.innerHTML
}

function removePresentationOnlyImageDiffs(diffHtml: string): string {
  const container = document.createElement('div')
  container.innerHTML = diffHtml

  const meaningfulAttributes = (image: HTMLImageElement): string => {
    const normalized = image.cloneNode(true) as HTMLImageElement
    normalized.style.removeProperty('background-color')
    if (!normalized.getAttribute('style')?.trim()) {
      normalized.removeAttribute('style')
    }
    return Array.from(normalized.attributes)
      .map(({ name, value }) => `${name.toLowerCase()}=${value}`)
      .sort()
      .join('\n')
  }

  container.querySelectorAll<HTMLElement>('del.diffmod').forEach((removed) => {
    const inserted = removed.nextElementSibling
    if (!(inserted instanceof HTMLElement) || !inserted.matches('ins.diffmod')) return
    if (removed.children.length !== 1 || inserted.children.length !== 1) return

    const oldImage = removed.firstElementChild
    const newImage = inserted.firstElementChild
    if (!(oldImage instanceof HTMLImageElement) || !(newImage instanceof HTMLImageElement)) return
    if (removed.textContent?.trim() || inserted.textContent?.trim()) return
    if (meaningfulAttributes(oldImage) !== meaningfulAttributes(newImage)) return

    removed.replaceWith(newImage.cloneNode(true))
    inserted.remove()
  })

  return container.innerHTML
}

function removeZeroSizeDiffElements(diffHtml: string): string {
  const container = document.createElement('div')
  // Render off-screen so layout metrics are available before the final render.
  container.style.position = 'absolute'
  container.style.left = '-99999px'
  container.style.top = '0'
  container.style.visibility = 'hidden'
  container.style.pointerEvents = 'none'
  container.style.width = `${Math.max(document.documentElement.clientWidth, 1024)}px`
  container.innerHTML = diffHtml
  document.body.appendChild(container)

  const selector = '.diffins, .diffmod, .diffdel, ins.diffmod, del.diffmod'
  const hasRenderableMedia = (el: Element): boolean =>
    !!el.querySelector('img, svg, video, audio, picture, canvas, iframe, object, embed')
  const isWhitespaceSensitive = (el: Element): boolean =>
    !!el.closest('pre, textarea')
  const unwrapElement = (el: Element) => {
    const parent = el.parentNode
    if (!parent) return
    while (el.firstChild) {
      parent.insertBefore(el.firstChild, el)
    }
    parent.removeChild(el)
  }

  try {
    // Remove truly empty wrappers, but preserve any whitespace text they carry.
    Array.from(container.querySelectorAll(selector)).forEach((el) => {
      if (isWhitespaceSensitive(el)) return
      if (el.textContent?.trim().length === 0 && !hasRenderableMedia(el)) {
        if (el.childNodes.length === 0) {
          el.remove()
        } else {
          unwrapElement(el)
        }
      }
    })

    // Remove zero-size leaf diff nodes until stable.
    while (true) {
      const allDiffs = Array.from(container.querySelectorAll(selector))
      const leafDiffs = allDiffs.filter((el) => !allDiffs.some((other) => other !== el && el.contains(other)))
      let removed = 0

      leafDiffs.forEach((el) => {
        if (isWhitespaceSensitive(el)) return
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) {
          unwrapElement(el)
          removed++
        }
      })

      if (removed === 0) break
    }

    return container.innerHTML
  } finally {
    container.remove()
  }
}

function renderRawDiff(
  diffHtml: string,
  oldPageUrl: string,
  newPageUrl: string,
  hasReleaseHeader: boolean,
) {
  const newBaseUrl = getBaseUrl(newPageUrl)
  const oldBaseUrl = getBaseUrl(oldPageUrl)

  const headContent = rebaseHeadUrls(newSpecHtml.value, newBaseUrl, oldBaseUrl)
  diffHtml = rebaseBodySrcUrls(diffHtml, newBaseUrl)
  diffHtml = removePresentationOnlyImageDiffs(diffHtml)
  diffHtml = removeZeroSizeDiffElements(diffHtml)
  diffHtml = rewriteRelativeLinks(diffHtml, oldBaseUrl, newBaseUrl)

  if (hasReleaseHeader) {
    const container = document.createElement('div')
    container.innerHTML = diffHtml
    const placeholder = container.querySelector(releaseHeaderPlaceholderSelector)
    if (placeholder) {
      const notice = document.createElement('aside')
      notice.className = 'generated-diff-notice'
      notice.setAttribute('aria-label', 'Generated comparison notice')

      const heading = document.createElement('strong')
      heading.textContent = 'Generated difference report - not an original FHIR page'
      const explanation = document.createElement('p')
      explanation.textContent = 'This page was generated by comparing the two source URLs below. It is not the original content of either source page.'

      const sourceList = document.createElement('dl')
      for (const [label, url] of [['Old source', oldPageUrl], ['New source', newPageUrl]]) {
        const term = document.createElement('dt')
        term.textContent = label
        const description = document.createElement('dd')
        const link = document.createElement('a')
        link.href = url
        link.textContent = url
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        description.appendChild(link)
        sourceList.append(term, description)
      }

      notice.append(heading, explanation, sourceList)
      placeholder.replaceWith(notice)
      container.querySelectorAll(releaseHeaderPlaceholderSelector).forEach((extra) => extra.remove())
      diffHtml = container.innerHTML
    }
  }

  // Link back to the bare compare page (URLs prefilled, but not auto-compared)
  const editUrl = window.location.pathname
    + '?old=' + encodeURIComponent(oldPageUrl)
    + '&new=' + encodeURIComponent(newPageUrl)
    + '&edit=1'

  const fullHtml = `<!DOCTYPE html>
<html>
<head>
${headContent}
<style>
.diffins { background-color: #b6ffa7; }
.diffmod { background-color: #a7e0ff; }
del.diffmod { background-color: #feccbf; }
ins.diffmod { background-color: #b6ffa7; }
.diffdel { background-color: #feccbf; }
.diff-current-highlight { outline: 3px solid #ff6600; outline-offset: 2px; }
.generated-diff-notice {
  margin: 0 0 18px;
  padding: 12px 16px;
  border: 2px solid #8a4b08;
  border-radius: 4px;
  background: #fff4d6;
  color: #2c210f;
}
.generated-diff-notice strong {
  display: block;
  margin-bottom: 6px;
  font-size: 18px;
}
.generated-diff-notice p { margin: 0 0 8px; }
.generated-diff-notice dl { margin: 0; }
.generated-diff-notice dt {
  float: left;
  clear: left;
  width: 84px;
  font-weight: bold;
}
.generated-diff-notice dd {
  margin-left: 90px;
  overflow-wrap: anywhere;
}
@media (max-width: 600px) {
  .generated-diff-notice { margin-left: 60px; }
}
#diff-nav {
  position: fixed;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10000;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  background: white;
  border: 1px solid #ccc;
  border-left: none;
  border-radius: 0 8px 8px 0;
  /* No top padding: compare button sits flush against the top edge */
  padding: 0 8px 6px 6px;
  box-shadow: 2px 2px 8px rgba(0,0,0,0.15);
  font-family: sans-serif;
  font-size: 13px;
}
#diff-nav button {
  padding: 0;
  width: 28px;
  height: 28px;
  cursor: pointer;
  border: 1px solid #ccc;
  background: #f5f5f5;
  font-size: 14px;
  line-height: 28px;
  text-align: center;
  border-radius: 0;
}
#diff-nav button:hover { background: #e0e0e0; }
#diff-nav .diff-row button:first-child { border-radius: 4px 0 0 4px; }
#diff-nav .diff-row button:last-child { border-radius: 0 4px 4px 0; border-left: none; }
#diff-nav .diff-edit-link {
  display: block;
  /* Negative side margins extend the link past the nav bar's left/right padding (6px / 8px) */
  margin: 0 -8px 2px -6px;
  padding: 3px 6px;
  background: #777;
  color: #fff;
  text-decoration: none;
  text-align: center;
  font-size: 11px;
  font-family: inherit;
  /* Match nav bar's top-right rounding; flat elsewhere */
  border-radius: 0 8px 0 0;
  letter-spacing: 0.5px;
  text-transform: lowercase;
  box-sizing: border-box;
}
#diff-nav .diff-edit-link:hover { background: #555; }
#diff-nav .diff-row {
  display: flex;
  /* Recenter rows now that nav uses align-items: stretch */
  align-self: center;
}
#diff-nav .diff-pos {
  display: flex;
  align-self: center;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
  font-size: 12px;
  color: #666;
}
#diff-nav .diff-counter {
  text-align: right;
  width: 24px;
  border: none;
  padding: 0;
  outline: none;
  font-family: inherit;
  font-size: 12px;
  color: #666;
  background: transparent;
}
#diff-nav .diff-total { font-size: 12px; color: #999; }
</style>
</head>
<body>
<div id="diff-nav">
  <a class="diff-edit-link" href="${editUrl}" title="Edit URLs / back to compare page">compare</a>
  <div class="diff-row">
    <button onclick="diffNavPrev()" title="Previous change ( , )">&#x2191;</button>
    <button onclick="diffNavPrevSection()" title="Skip to previous off-screen change ( < )">&#x21D1;</button>
  </div>
  <div class="diff-pos"><input type="text" class="diff-counter" id="diff-counter" value="0" /><span class="diff-total" id="diff-total"></span></div>
  <div class="diff-row">
    <button onclick="diffNavNext()" title="Next change ( . )">&#x2193;</button>
    <button onclick="diffNavNextSection()" title="Skip to next off-screen change ( > )">&#x21D3;</button>
  </div>
</div>
${diffHtml}
<script>
window.addEventListener('load', function() {
  var allDiffs = [];
  document.querySelectorAll('.diffins, .diffmod, .diffdel, ins.diffmod, del.diffmod').forEach(function(el) {
    // Skip tiny whitespace-only diffs
    if (el.textContent.trim().length === 0 && !el.querySelector('img')) return;
    allDiffs.push(el);
  });
  // Keep only leaf-level diffs (elements that don't contain other diff elements)
  var diffs = allDiffs.filter(function(el) {
    return !allDiffs.some(function(other) {
      return other !== el && el.contains(other);
    });
  });
  diffs = diffs.filter(function(el) {
    var rect = el.getBoundingClientRect();
    return rect.width !== 0 || rect.height !== 0;
  });
  var currentIdx = -1;
  var counter = document.getElementById('diff-counter');
  var total = document.getElementById('diff-total');
  counter.value = '0';
  total.textContent = '/' + diffs.length;

  function highlight(idx, scroll) {
    if (currentIdx >= 0 && currentIdx < diffs.length)
      diffs[currentIdx].classList.remove('diff-current-highlight');
    currentIdx = idx;
    if (currentIdx >= 0 && currentIdx < diffs.length) {
      var el = diffs[currentIdx];
      el.classList.add('diff-current-highlight');
      if (scroll !== false && !isInViewport(el))
        el.scrollIntoView({ behavior: 'auto', block: 'center' });
      counter.value = String(currentIdx + 1);
    }
  }

  // Track scroll position and sync counter to first visible diff
  var scrollTimer = null;
  var navTriggeredScroll = false;

  function isInViewport(el) {
    var rect = el.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  }

  function onUserScroll() {
    if (navTriggeredScroll) return;
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function() {
      // If current highlight is still visible, do nothing
      if (currentIdx >= 0 && currentIdx < diffs.length && isInViewport(diffs[currentIdx])) return;
      // Find first visible diff using binary search for performance with 1600+ diffs
      var lo = 0, hi = diffs.length - 1, firstVisible = -1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        var rect = diffs[mid].getBoundingClientRect();
        if (rect.top >= window.innerHeight) {
          hi = mid - 1;
        } else if (rect.bottom <= 0) {
          lo = mid + 1;
        } else {
          firstVisible = mid;
          hi = mid - 1;
        }
      }
      if (firstVisible >= 0 && firstVisible !== currentIdx) {
        highlight(firstVisible, false);
      }
    }, 150);
  }

  window.addEventListener('scroll', onUserScroll, { passive: true });

  counter.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      var num = parseInt(counter.value, 10);
      if (!isNaN(num) && num >= 1 && num <= diffs.length) {
        navTriggeredScroll = true;
        highlight(num - 1);
        setTimeout(function() { navTriggeredScroll = false; }, 500);
      } else {
        counter.value = currentIdx >= 0 ? String(currentIdx + 1) : '0';
      }
      counter.blur();
    }
  });

  window.diffNavNext = function() {
    if (diffs.length === 0) return;
    navTriggeredScroll = true;
    highlight(currentIdx < diffs.length - 1 ? currentIdx + 1 : 0);
    setTimeout(function() { navTriggeredScroll = false; }, 500);
  };
  window.diffNavPrev = function() {
    if (diffs.length === 0) return;
    navTriggeredScroll = true;
    highlight(currentIdx > 0 ? currentIdx - 1 : diffs.length - 1);
    setTimeout(function() { navTriggeredScroll = false; }, 500);
  };
  window.diffNavNextSection = function() {
    if (diffs.length === 0) return;
    for (var i = currentIdx + 1; i < diffs.length; i++) {
      if (!isInViewport(diffs[i])) {
        navTriggeredScroll = true;
        highlight(i);
        setTimeout(function() { navTriggeredScroll = false; }, 500);
        return;
      }
    }
  };
  window.diffNavPrevSection = function() {
    if (diffs.length === 0) return;
    for (var i = (currentIdx >= 0 ? currentIdx : diffs.length) - 1; i >= 0; i--) {
      if (!isInViewport(diffs[i])) {
        navTriggeredScroll = true;
        highlight(i);
        setTimeout(function() { navTriggeredScroll = false; }, 500);
        return;
      }
    }
  };

  document.addEventListener('keydown', function(e) {
    // Skip when typing in the counter input
    if (e.target === counter) return;
    if (e.key === '>') { diffNavNextSection(); e.preventDefault(); }
    else if (e.key === '<') { diffNavPrevSection(); e.preventDefault(); }
    else if (e.key === '.' || e.key === ']') { diffNavNext(); e.preventDefault(); }
    else if (e.key === ',' || e.key === '[') { diffNavPrev(); e.preventDefault(); }
  });

  // Auto-select the first change if it's already visible in the initial
  // viewport. We pass scroll=false so the page doesn't jump.
  for (var i = 0; i < diffs.length; i++) {
    if (isInViewport(diffs[i])) {
      highlight(i, false);
      break;
    }
  }
});
<\/script>
</body>
</html>`

  // Insert an `edit=1` history entry behind the current diff entry so that the
  // browser Back button returns to the bare compare page (with URLs prefilled)
  // rather than re-running the diff. We do this only on the initial render
  // (renderRawDiff runs at most once per page load — document.write below
  // destroys the Vue app, so any subsequent diff is a fresh page navigation).
  const diffUrl = window.location.pathname
    + '?old=' + encodeURIComponent(oldPageUrl)
    + '&new=' + encodeURIComponent(newPageUrl)
  history.replaceState(null, '', editUrl)
  history.pushState(null, '', diffUrl)

  document.open()
  document.write(fullHtml)
  document.close()

  // The Vue app is now destroyed by document.write.
  // If the user navigates back, reload so the app bootstraps fresh.
  window.addEventListener('popstate', () => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('edit') === '1') {
      window.location.reload()
    }
  })
}

function formatDownloadError(error: any, url: string): string {
  if (error.response) {
    const status = error.response.status
    const statusText = error.response.statusText || ''
    const data = typeof error.response.data === 'string' ? error.response.data.substring(0, 200) : ''
    return `${status} ${statusText}${data ? ': ' + data : ''}`
  }
  if (error.request && !error.response) {
    return `Request failed (likely blocked by CORS). The server may not allow cross-origin requests.`
  }
  return `${error.message || 'Unknown error'}`
}

function resolvedUrl(response: any, originalUrl: string, usedProxy: boolean): string {
  if (usedProxy) return originalUrl
  const finalUrl = response.request?.responseURL
  if (!finalUrl) return originalUrl
  return finalUrl
}

// HL7 IGs (newer template) ship a tiny stub page whose body is just two
// inline scripts: one defining `langs = ["en", ...]` and one sourcing
// `assets/js/lang-redirects.js`. That redirect script picks a language from
// `navigator.language` and client-side redirects to `<lang>/<pageName>`.
// When we fetch such a page directly we get the stub (no real content), so
// we detect the marker, replicate the language-selection logic ourselves,
// and re-fetch from the language sub-path. Older IGs don't have this script
// and serve content directly — those return null and are left untouched.
function resolveLangRedirectTarget(html: string, pageUrl: string): string | null {
  // Cheap pre-check to avoid parsing every page
  if (!/lang-redirects?\.js/i.test(html)) return null

  let doc: Document
  try {
    doc = new DOMParser().parseFromString(html, 'text/html')
  } catch {
    return null
  }

  // Confirm the redirect script tag is actually present
  const hasRedirectScript = Array.from(doc.querySelectorAll('script[src]'))
    .some(s => /lang-redirects?\.js(\?|$)/i.test(s.getAttribute('src') || ''))
  if (!hasRedirectScript) return null

  // Find the inline script that defines `langs = [...]`
  let langs: string[] | null = null
  for (const s of Array.from(doc.querySelectorAll('script:not([src])'))) {
    const text = s.textContent || ''
    const m = text.match(/langs\s*=\s*(\[[^\]]*\])/)
    if (!m) continue
    try {
      const parsed = JSON.parse(m[1].replace(/'/g, '"'))
      if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string') && parsed.length > 0) {
        langs = parsed
        break
      }
    } catch { /* keep looking */ }
  }
  if (!langs) return null

  // Mirror lang-redirects.js selection logic exactly:
  //   exact match OR userLang.startsWith(lang + "-"), else fall back to langs[0]
  const userLang = (navigator.language || (navigator as any).userLanguage || '') as string
  let chosen = langs[0]
  for (const l of langs) {
    if (userLang === l || userLang.startsWith(l + '-')) { chosen = l; break }
  }

  // pageName = last segment of the URL path (matches the original script).
  // For URLs ending in '/', pageName is empty and the target becomes
  // `<base>/<lang>/`, which the server resolves to its default index.
  try {
    const u = new URL(pageUrl)
    const path = u.pathname
    const pageName = path.substring(path.lastIndexOf('/') + 1)
    const basePath = path.substring(0, path.lastIndexOf('/') + 1)
    u.pathname = basePath + chosen + '/' + pageName
    return u.toString()
  } catch {
    return null
  }
}

// Strip the lang-redirects.js script tag (and its companion `langs=[...]`
// inline script) from HTML before we render it. We've already followed the
// redirect ourselves; leaving the tag in would either do nothing (we're
// already on the lang sub-page) or, in the rare case the resolved page still
// references it, redirect again.
function stripLangRedirectScript(html: string): string {
  return html
    .replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*lang-redirects?\.js[^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<script\b[^>]*>\s*(?:\/\/[^\n]*\n\s*)*langs\s*=\s*\[[^\]]*\]\s*;?\s*<\/script>/gi, '')
}

function fetchPage(
  pageUrl: string,
  onProgress: (loaded: number) => void,
  onError: (msg: string) => void,
  followLangRedirect = true,
): Promise<{ html: string; resolvedUrl: string } | null> {
  const proxied = wrapWithProxy(pageUrl)
  const usedProxy = proxied !== pageUrl
  return axios.get(proxied, {
    onDownloadProgress: (e) => onProgress(e.loaded),
  }).then(async response => {
    const finalUrl = resolvedUrl(response, pageUrl, usedProxy)
    const html: string = response.data

    if (followLangRedirect) {
      const langTarget = resolveLangRedirectTarget(html, finalUrl)
      if (langTarget && langTarget !== finalUrl) {
        // Validate against allowlist before following — same host/path as the
        // original, so this should always pass, but be defensive.
        if (!isUrlAllowed(langTarget)) {
          console.warn('lang-redirect target not in allowlist, ignoring:', langTarget)
        } else {
          // Reset progress for the second fetch so the UI reflects the real download
          onProgress(0)
          const followed = await fetchPage(langTarget, onProgress, onError, false)
          if (followed) return followed
        }
      }
    }

    return { html: stripLangRedirectScript(html), resolvedUrl: finalUrl }
  }).catch(error => {
    onError(formatDownloadError(error, pageUrl))
    return null
  })
}

function downloadAndCompare(oldPageUrl: string, newPageUrl: string) {
  loading.value = true;

  rawMode.value = true
  rawStatus.value = 'Downloading pages...'
  rawError.value = ''
  rawErrorOld.value = ''
  rawErrorNew.value = ''
  rawProgressOld.value = 0
  rawProgressNew.value = 0
  activeOldUrl.value = oldPageUrl  // fallback, updated after download with resolved URL
  activeNewUrl.value = newPageUrl

  const fetchOld = fetchPage(
    oldPageUrl,
    (loaded) => { rawProgressOld.value = loaded },
    (msg) => { rawErrorOld.value = msg },
  )
  const fetchNew = fetchPage(
    newPageUrl,
    (loaded) => { rawProgressNew.value = loaded },
    (msg) => { rawErrorNew.value = msg },
  )

  Promise.all([fetchOld, fetchNew]).then(([oldResult, newResult]) => {
    if (!oldResult || !newResult) {
      rawStatus.value = 'Diff evaluation cancelled — failed download';
      loading.value = false;
      return
    }
    activeOldUrl.value = oldResult.resolvedUrl
    activeNewUrl.value = newResult.resolvedUrl
    oldSpecHtml.value = oldResult.html
    newSpecHtml.value = newResult.html
    loading.value = false;
    return comparePages()
  })
}

// Load allowlist, then auto-compare if query params are present
onMounted(async () => {
  try {
    const resp = await axios.get('allowed-sites.json')
    allowedSites.value = resp.data.allowedSites
  } catch (e) {
    console.error('Failed to load allowed sites', e)
  }
  const params = new URLSearchParams(window.location.search)
  const qOld = params.get('old')
  if (qOld) oldUrl.value = qOld

  const qNew = params.get('new')
  if (qNew) newUrl.value = qNew

  // edit=1 means: prefill the form but don't auto-compare
  // (used by the 'compare' link in the diff nav bar to return to the bare page)
  const editMode = params.get('edit') === '1'

  if (qOld && qNew && !editMode) {
    if (!validateUrls(oldUrl.value, newUrl.value)) {
      rawError.value = validationError.value
      rawMode.value = true
      return
    }
    downloadAndCompare(oldUrl.value, newUrl.value)
  }
})
</script>
