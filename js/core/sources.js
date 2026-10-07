/**
 * Origin of an item in the source text (item.source). Both functions accept items without source.
 */
(function (PB) {
  'use strict';

  PB.sources = Object.freeze({
    /** Span { start, end } covered by the item (from the first span to the last), or null if unknown. */
    rangeOf(item) {
      const spans = item.source && item.source.spans;
      return spans && spans.length ? { start: spans[0].start, end: spans[spans.length - 1].end } : null;
    },

    /** Short text to display the item (tooltip), or null if it has none. */
    labelOf: item => (item.source && item.source.label) || null,
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
