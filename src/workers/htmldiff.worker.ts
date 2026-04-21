import HtmlDiffModule from 'htmldiff-js';

const HtmlDiff = HtmlDiffModule.default ?? HtmlDiffModule;

self.onmessage = (e: MessageEvent<{ oldHtml: string; newHtml: string }>) => {
  const { oldHtml, newHtml } = e.data;
  const result = HtmlDiff.execute(oldHtml, newHtml);
  self.postMessage(result);
};
