/**
 * Collapsible sections (PB.ui.initCollapsible / PB.ui.makeCollapsible).
 * A container marked with `data-collapsible` gets its title (first `h2` or `.strip-title`) turned into a toggle: clicking it
 * (or pressing Enter/Space) adds/removes the class `is-collapsed` on the container. The direct child of the container that holds
 * the title is marked `collapse-head`; the CSS hides every other child while collapsed, so only the title stays visible.
 * Run it after the scripts that render titles (js/convert-panel.js).
 */
(function (PB) {
  'use strict';

  const TITLE_SELECTOR = 'h2, .strip-title';
  const COLLAPSED = 'is-collapsed';

  function makeCollapsible(container) {
    const title = container.querySelector(TITLE_SELECTOR);
    if (!title) return null;
    let head = title;
    while (head.parentElement && head.parentElement !== container) head = head.parentElement;
    head.classList.add('collapse-head');
    title.classList.add('collapse-toggle');
    title.setAttribute('role', 'button');
    title.setAttribute('tabindex', '0');
    title.setAttribute('aria-expanded', 'true');

    const toggle = () => {
      const collapsed = container.classList.toggle(COLLAPSED);
      title.setAttribute('aria-expanded', String(!collapsed));
    };
    title.addEventListener('click', toggle);
    title.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggle();
    });
    return title;
  }

  function initCollapsible(root) {
    root.querySelectorAll('[data-collapsible]').forEach(makeCollapsible);
  }

  PB.ui = PB.ui || {};
  PB.ui.makeCollapsible = makeCollapsible;
  PB.ui.initCollapsible = initCollapsible;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
