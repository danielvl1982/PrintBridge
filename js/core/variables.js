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

    /**
     * Test values suggested by a label: model.variableDefaults = { NAME: value } (ZPL ^FN data, see js/languages/zpl.js). A default fills only the
     * variables that have no value yet in `values` (an empty value the user typed counts as a value). It changes `values`; a model without
     * defaults changes nothing.
     */
    seedDefaults(values, model) {
      for (const [name, value] of Object.entries((model && model.variableDefaults) || {})) if (values[name] == null) values[name] = value;
    },

    /**
     * The values that were really assigned: the Variables panel fills a new variable with its own name as a placeholder, which is not a value
     * (an empty value the user typed is one). Used to print: a variable without an assigned value is sent as written.
     */
    assigned(values) {
      return Object.fromEntries(Object.entries(values || {}).filter(([name, value]) => value != null && value !== name));
    },

    /** Replaces the variables with their value; the ones without a value are left as they are. */
    substitute(text, values) {
      return text == null ? '' : text.replace(PATTERN, (match, name) => values[name] ?? match);
    },
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
