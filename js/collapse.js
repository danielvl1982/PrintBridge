/**
 * Collapsible sections (PB.ui.initCollapsible / PB.ui.makeCollapsible).
 * A container marked with `data-collapsible` gets its title (first `h2` or `.strip-title`) turned into a toggle: clicking it
 * (or pressing Enter/Space) adds/removes the class `is-collapsed` on the container. The direct child of the container that holds
 * the title is marked `collapse-head`; the CSS hides every other child while collapsed, so only the title stays visible.
 * A container with `data-collapsed-default` starts collapsed when nothing is stored for its key; a stored choice (true or false) wins.
 * The collapsed state of each section (keyed by the `data-collapsible` value) is kept in localStorage; every storage access is
 * guarded, so a blocked or corrupt storage just means the sections start in their default state (expanded unless declared otherwise).
 * Run it after the scripts that render titles (js/convert-panel.js).
 */
(function (PB) {
  'use strict';

  const TITLE_SELECTOR = 'h2, .strip-title';
  const COLLAPSED = 'is-collapsed';
  const STORAGE_KEY = 'printbridge.collapsed';

  function readState(storage) {
    try {
      const state = JSON.parse(storage.getItem(STORAGE_KEY));
      return state && typeof state === 'object' ? state : {};
    } catch (e) { return {}; }
  }

  function saveState(storage, id, collapsed) {
    try { storage.setItem(STORAGE_KEY, JSON.stringify({ ...readState(storage), [id]: collapsed })); } catch (e) { /* storage unavailable: the state just is not remembered */ }
  }

  function defaultStorage() {
    try { return globalThis.localStorage || null; } catch (e) { return null; }
  }

  function makeCollapsible(container, storage = null) {
    const title = container.querySelector(TITLE_SELECTOR);
    if (!title) return null;
    let head = title;
    while (head.parentElement && head.parentElement !== container) head = head.parentElement;
    head.classList.add('collapse-head');
    title.classList.add('collapse-toggle');
    title.setAttribute('role', 'button');
    title.setAttribute('tabindex', '0');
    title.setAttribute('aria-expanded', 'true');

    const id = container.getAttribute('data-collapsible');
    const remember = storage && id;
    const stored = remember ? readState(storage)[id] : undefined;
    const collapsedAtStart = typeof stored === 'boolean' ? stored : container.getAttribute('data-collapsed-default') != null;
    if (collapsedAtStart) {
      container.classList.add(COLLAPSED);
      title.setAttribute('aria-expanded', 'false');
    }

    const toggle = () => {
      const collapsed = container.classList.toggle(COLLAPSED);
      title.setAttribute('aria-expanded', String(!collapsed));
      if (remember) saveState(storage, id, collapsed);
    };
    title.addEventListener('click', toggle);
    title.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggle();
    });
    return title;
  }

  function initCollapsible(root, storage = defaultStorage()) {
    root.querySelectorAll('[data-collapsible]').forEach(container => makeCollapsible(container, storage));
  }

  PB.ui = PB.ui || {};
  PB.ui.makeCollapsible = makeCollapsible;
  PB.ui.initCollapsible = initCollapsible;
  PB.ui.COLLAPSE_STORAGE_KEY = STORAGE_KEY;
})(globalThis.PrintBridge = globalThis.PrintBridge || {});
