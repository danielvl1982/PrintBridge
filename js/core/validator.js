/**
 * Language-independent validation rules. Those specific to a language go in its validate.
 * Rules that apply to every kind live in RULES (add one there); rules of one component belong to its slice, as the
 * optional `validate(item) -> diagnostics` hook (see js/components/registry.js), run after the RULES for that item.
 */
(function (PB) {
  'use strict';

  const { diagnostics: diag } = PB;

  const RULES = [
    // Fields without content (images and the slices declared with carriesData: false, like lines, carry no data by design)
    item => {
      const slice = PB.components.forItem(item);
      const carriesData = !slice || slice.carriesData !== false;
      return carriesData && item.data == null
        ? [diag.warning(`${item.ref}: sin texto ni comando de datos asociado`)]
        : [];
    },

    // Rules of the component that owns the item (e.g. barcodes the viewer does not generate exactly)
    item => {
      const slice = PB.components.forItem(item);
      return slice && slice.validate ? slice.validate(item) : [];
    },
  ];

  PB.validator = Object.freeze({
    /** Neutral rules plus those of the model's language (if it has any). */
    validate: (model, language) => [
      ...model.items.flatMap(item => RULES.flatMap(rule => rule(item))),
      ...(language && language.validate ? language.validate(model) : []),
    ],
  });
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
