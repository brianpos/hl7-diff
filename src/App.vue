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

const downloaderPrefix = undefined; //'http://localhost:7071/api/downloader?url='

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

async function comparePages() {
  const oldHtml = extractBody(oldSpecHtml.value)
  const newHtml = extractBody(newSpecHtml.value)

  try {
    rawStatus.value = 'Computing diff...'
    const val = await executeDiffInWorker(oldHtml, newHtml)
    renderRawDiff(val, activeOldUrl.value, activeNewUrl.value)
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

function renderRawDiff(diffHtml: string, oldPageUrl: string, newPageUrl: string) {
  const newBaseUrl = getBaseUrl(newPageUrl)
  const oldBaseUrl = getBaseUrl(oldPageUrl)

  const headContent = rebaseHeadUrls(newSpecHtml.value, newBaseUrl, oldBaseUrl)
  diffHtml = rebaseBodySrcUrls(diffHtml, newBaseUrl)
  diffHtml = rewriteRelativeLinks(diffHtml, oldBaseUrl, newBaseUrl)

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
#diff-nav {
  position: fixed;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10000;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: white;
  border: 1px solid #ccc;
  border-left: none;
  border-radius: 0 8px 8px 0;
  padding: 6px 8px 6px 6px;
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
#diff-nav .diff-row {
  display: flex;
  width: 100%;
}
#diff-nav .diff-pos {
  display: flex;
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
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
});
<\/script>
</body>
</html>`

  document.open()
  document.write(fullHtml)
  document.close()

  // The Vue app is now destroyed by document.write.
  // If the user navigates back, reload so the app bootstraps fresh.
  window.addEventListener('popstate', () => {
    window.location.reload()
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

  const proxiedOld = wrapWithProxy(oldPageUrl)
  const proxiedNew = wrapWithProxy(newPageUrl)
  const oldUsedProxy = proxiedOld !== oldPageUrl
  const newUsedProxy = proxiedNew !== newPageUrl

  const fetchOld = axios.get(proxiedOld, {
    onDownloadProgress: (e) => { rawProgressOld.value = e.loaded }
  }).catch(error => {
    rawErrorOld.value = formatDownloadError(error, oldPageUrl)
    return null
  })

  const fetchNew = axios.get(proxiedNew, {
    onDownloadProgress: (e) => { rawProgressNew.value = e.loaded }
  }).catch(error => {
    rawErrorNew.value = formatDownloadError(error, newPageUrl)
    return null
  })

  Promise.all([fetchOld, fetchNew]).then(([oldResponse, newResponse]) => {
    if (!oldResponse || !newResponse) {
      rawStatus.value = 'Diff evaluation cancelled — failed download';
      loading.value = false;
      return
    }
    activeOldUrl.value = resolvedUrl(oldResponse, oldPageUrl, oldUsedProxy)
    activeNewUrl.value = resolvedUrl(newResponse, newPageUrl, newUsedProxy)
    oldSpecHtml.value = oldResponse.data
    newSpecHtml.value = newResponse.data
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

  if (qOld && qNew) {
    if (!validateUrls(oldUrl.value, newUrl.value)) {
      rawError.value = validationError.value
      rawMode.value = true
      return
    }
    downloadAndCompare(oldUrl.value, newUrl.value)
  }
})
</script>
