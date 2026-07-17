import HtmlDiffModule from 'htmldiff-js';

const HtmlDiff = HtmlDiffModule.default ?? HtmlDiffModule;

function normalizeLineEndings(html: string): string {
  return html.replace(/\r\n?/g, '\n');
}

self.onmessage = (e: MessageEvent<{ oldHtml: string; newHtml: string }>) => {
  const { oldHtml, newHtml } = e.data;
  const result = HtmlDiff.execute(
    normalizeLineEndings(oldHtml),
    normalizeLineEndings(newHtml),
  );
  self.postMessage(result);
};
