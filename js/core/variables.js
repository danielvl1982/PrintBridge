/**
 * Template variables: #NAME# or <#NAME#>.
 */
(function (PB) {
  'use strict';

  const PATTERN = /<?#(\w+)#>?/g;

  PB.variables = Object.freeze({
    /** Variable names that appear in a text, without repeats and in order of appearance. */
    namesIn(text) {
      return text == null ? [] : [...new Set([...text.matchAll(PATTERN)].map(m => m[1]))];
    },

    /** Variable names of all the items of the model. */
    namesInModel(model) {
      return [...new Set(model.items.flatMap(it => PB.variables.namesIn(it.data)))];
    },

    /** Replaces the variables with their value; the ones without a value are left as they are. */
    substitute(text, values) {
      return text == null ? '' : text.replace(PATTERN, (match, name) => values[name] ?? match);
    },
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
