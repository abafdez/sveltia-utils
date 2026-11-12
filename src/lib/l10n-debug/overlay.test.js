import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createL10nDebugRegistry, markMessages } from './markers.js';
import {
  ATTR_STATUS_ATTR,
  createStyles,
  findMarkedStrings,
  getGroupStatus,
  getStatus,
  HIDDEN_ATTR,
  startL10nDebugOverlay,
  TEXT_STATUS_ATTR,
} from './overlay.js';

/**
 * @import { L10nDebugOverlay } from './overlay.js';
 */

const registry = createL10nDebugRegistry({
  sources: [
    {
      name: 'App',
      repository: 'example/app',
      path: 'locales/{locale}.yaml',
      color: 'orange',
      messages: {
        'en-US': { hello: 'Hello', bye: 'Bye', only_en: 'Only English' },
        es: { hello: 'Hola', bye: 'Adiós' },
      },
    },
    {
      name: 'UI',
      path: 'src/locales/{locale}.yaml',
      color: 'pink',
      messages: { 'en-US': { close: 'Close' } },
    },
  ],
});

const app = {
  'en-US': markMessages(
    { hello: 'Hello', bye: 'Bye', only_en: 'Only English' },
    { registry, source: 'App', locale: 'en-US' },
  ),
  es: markMessages({ hello: 'Hola', bye: 'Adiós' }, { registry, source: 'App', locale: 'es' }),
};

const ui = markMessages({ close: 'Close' }, { registry, source: 'UI', locale: 'en-US' });

/**
 * Wait for the mutation observer and the summary update.
 * @param {number} [ms] Milliseconds.
 * @returns {Promise<void>} Promise.
 */
const wait = (ms = 0) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Get the shadow root of the overlay.
 * @returns {ShadowRoot} Shadow root.
 */
const getShadow = () =>
  /** @type {ShadowRoot} */ (
    /** @type {HTMLElement} */ (document.querySelector('[data-l10n-debug]')).shadowRoot
  );

/** @type {L10nDebugOverlay | undefined} */
let overlay;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = 'es';
  document.body.innerHTML = `
    <h1 id="translated">${app.es.hello}</h1>
    <p id="foreign">${app['en-US'].bye}</p>
    <p id="missing">${app['en-US'].only_en}</p>
    <button id="close" aria-label="${ui.close}"></button>
    <p id="plain">Plain text</p>
  `;
});

afterEach(() => {
  overlay?.stop();
  overlay = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('Test getStatus() and getGroupStatus()', () => {
  const [hello] = findMarkedStrings(
    Object.assign(document.createElement('p'), { textContent: app.es.hello }),
    { registry },
  ).text;

  test('tell the strings in the active locale from the others', () => {
    expect(getStatus(hello.marker, '')).toBe('source-0');
    expect(getStatus(hello.marker, 'es')).toBe('source-0');
    expect(getStatus({ ...hello.marker, locale: 'en-US' }, 'es')).toBe('foreign');
    expect(getStatus({ ...hello.marker, locale: 'en-US', keyIndex: 2 }, 'es')).toBe('missing');
  });

  test('give priority to missing strings, then to foreign ones', () => {
    expect(getGroupStatus([])).toBeUndefined();

    expect(
      getGroupStatus([
        { ...hello, status: 'source-1' },
        { ...hello, status: 'foreign' },
      ]),
    ).toBe('foreign');

    expect(
      getGroupStatus([
        { ...hello, status: 'foreign' },
        { ...hello, status: 'missing' },
      ]),
    ).toBe('missing');
    expect(getGroupStatus([{ ...hello, status: 'source-1' }])).toBe('source-1');
  });
});

describe('Test findMarkedStrings()', () => {
  test('finds the strings in the own text and the attributes of an element', () => {
    const element = document.createElement('div');

    element.innerHTML = `${app.es.hello}<span>${app.es.bye}</span>`;
    element.setAttribute('title', ui.close);

    const { text, attributes } = findMarkedStrings(element, { registry, activeLocale: 'es' });

    expect(text.map(({ marker, status }) => [marker.key, status])).toEqual([['hello', 'source-0']]);
    expect(
      attributes.map(({ marker, attribute, status, text: value }) => [
        marker.key,
        attribute,
        status,
        value,
      ]),
    ).toEqual([['close', 'title', 'missing', 'Close']]);
  });

  test('skips elements whose content isn’t text', () => {
    const element = document.createElement('script');

    element.textContent = app.es.hello;
    expect(findMarkedStrings(element, { registry }).text).toEqual([]);
  });
});

describe('Test createStyles()', () => {
  test('creates solid and dashed outlines in each color', () => {
    const css = createStyles(registry);

    expect(css).toContain(`[${TEXT_STATUS_ATTR}="source-0"] { outline: 2px solid orange`);
    expect(css).toContain(`[${ATTR_STATUS_ATTR}="source-1"] { outline: 2px dashed pink`);
    expect(css).toContain(`[${TEXT_STATUS_ATTR}="missing"] { outline: 2px solid #e00`);
    expect(css).toContain(`[${TEXT_STATUS_ATTR}="foreign"] { outline: 2px solid #8b5cf6`);
  });
});

describe('Test startL10nDebugOverlay()', () => {
  test('marks the elements with strings', () => {
    overlay = startL10nDebugOverlay({ registry });

    const statusOf = (/** @type {string} */ id, attr = TEXT_STATUS_ATTR) =>
      document.getElementById(id)?.getAttribute(attr);

    expect(statusOf('translated')).toBe('source-0');
    expect(statusOf('foreign')).toBe('foreign');
    expect(statusOf('missing')).toBe('missing');
    expect(statusOf('close', ATTR_STATUS_ATTR)).toBe('missing');
    expect(statusOf('plain')).toBeNull();
    expect(document.head.querySelector('style')?.textContent).toContain('outline');
  });

  test('follows changes to the page', async () => {
    overlay = startL10nDebugOverlay({ registry });

    const added = document.createElement('p');
    const translated = /** @type {HTMLElement} */ (document.getElementById('translated'));
    const button = /** @type {HTMLElement} */ (document.getElementById('close'));

    added.innerHTML = `<span>${app.es.bye}</span>`;
    document.body.append(added);
    /** @type {Text} */ (translated.firstChild).nodeValue = 'Changed';
    button.setAttribute('aria-label', 'Plain');
    await wait();

    expect(added.querySelector('span')?.getAttribute(TEXT_STATUS_ATTR)).toBe('source-0');
    expect(translated.hasAttribute(TEXT_STATUS_ATTR)).toBe(false);
    expect(button.hasAttribute(ATTR_STATUS_ATTR)).toBe(false);
  });

  test('checks the page again when the locale changes', async () => {
    overlay = startL10nDebugOverlay({ registry });
    document.documentElement.lang = 'en-US';
    await wait();

    expect(document.getElementById('missing')?.getAttribute(TEXT_STATUS_ATTR)).toBe('source-0');
    // The Spanish string is now shown in another locale, which has its own translation
    expect(document.getElementById('translated')?.getAttribute(TEXT_STATUS_ATTR)).toBe('foreign');
  });

  test('shows where the strings live on hover', () => {
    overlay = startL10nDebugOverlay({ registry });

    const tooltip = /** @type {HTMLElement} */ (getShadow().querySelector('.tooltip'));
    const missing = /** @type {HTMLElement} */ (document.getElementById('missing'));
    const foreign = /** @type {HTMLElement} */ (document.getElementById('foreign'));

    missing.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 10 }));
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toContain('App · only_en');
    expect(tooltip.textContent).toContain('example/app › locales/es.yaml');
    expect(tooltip.textContent).toContain('Missing in es, showing the en-US string');

    foreign.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 9999 }));
    expect(tooltip.textContent).toContain('Shown in en-US though es has it');

    document
      .getElementById('close')
      ?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    expect(tooltip.textContent).toContain('UI · close [aria-label]');
    expect(tooltip.textContent).toContain('src/locales/es.yaml');
    expect(tooltip.textContent).toContain('“Close”');

    document
      .getElementById('plain')
      ?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    expect(tooltip.hidden).toBe(true);

    tooltip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }));
    expect(tooltip.hidden).toBe(true);
  });

  test('summarizes the strings and tracks the checklist', async () => {
    overlay = startL10nDebugOverlay({
      registry,
      checklist: [
        { id: 'greetings', label: 'Greetings', source: 'App', keys: ['hello', 'bye'], hint: 'Hi' },
        { id: 'other', label: 'Other', source: 'App', keys: ['only_en', 'unknown'] },
        { id: 'ui', label: 'Buttons', source: 'Missing', keys: ['close'], group: 'UI' },
      ],
    });
    await wait(250);

    const shadow = getShadow();

    expect(shadow.textContent).toContain('App: 1 on screen, 3/3 seen');
    expect(shadow.textContent).toContain('UI: 0 on screen, 1/1 seen');
    expect(shadow.textContent).toContain('Missing: 2 on screen');
    expect(shadow.textContent).toContain('Other locale: 1 on screen');
    expect(shadow.textContent).toContain('1/3 parts done');
    expect(localStorage.getItem('l10n-debug:seen')).toContain('only_en');

    const [greetings, other] = shadow.querySelectorAll('.item');
    const checkbox = /** @type {HTMLInputElement} */ (other.querySelector('input'));
    const details = /** @type {HTMLDetailsElement} */ (other.querySelector('details'));

    expect(greetings.classList.contains('done')).toBe(true);
    expect(other.textContent).toContain('Other 1/2');

    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(other.textContent).toContain('Not shown yet:');
    expect(other.textContent).toContain('unknown');

    /** @type {HTMLDetailsElement} */ (greetings.querySelector('details')).open = true;
    greetings.querySelector('details')?.dispatchEvent(new Event('toggle'));
    expect(greetings.textContent).toContain('All the strings have been shown.');
    expect(greetings.textContent).toContain('Hi');

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('l10n-debug:checked')).toBe('["other"]');
    expect(other.classList.contains('done')).toBe(true);
    expect(shadow.textContent).toContain('2/3 parts done');

    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    expect(other.querySelector('ul')?.childElementCount).toBe(0);
  });

  test('lists the strings that aren’t rendered visibly', async () => {
    overlay = startL10nDebugOverlay({ registry });
    await wait(250);

    const section = /** @type {HTMLDetailsElement} */ (
      [...getShadow().querySelectorAll('details')].at(-1)
    );

    section.open = true;
    section.dispatchEvent(new Event('toggle'));

    const list = /** @type {HTMLElement} */ (section.querySelector('ul'));

    // happy-dom doesn’t lay out the page, so every element counts as invisible
    expect(list.textContent).toContain('“Hola”');
    expect(list.textContent).toContain('“Close”');
    expect(list.querySelector('.missing')?.textContent).toBe('“Only English”');
  });

  test('hides the outlines, collapses and resets the progress', async () => {
    overlay = startL10nDebugOverlay({ registry });

    const buttons = [...getShadow().querySelectorAll('button')];
    const collapse = /** @type {HTMLButtonElement} */ (buttons.find((b) => b.textContent === '–'));

    const toggle = /** @type {HTMLButtonElement} */ (
      buttons.find((b) => b.textContent === 'Hide outlines')
    );

    const reset = /** @type {HTMLButtonElement} */ (
      buttons.find((b) => b.textContent === 'Reset progress')
    );

    toggle.click();
    expect(document.documentElement.hasAttribute(HIDDEN_ATTR)).toBe(true);
    expect(toggle.textContent).toBe('Show outlines');
    toggle.click();
    expect(document.documentElement.hasAttribute(HIDDEN_ATTR)).toBe(false);

    collapse.click();
    expect(getShadow().querySelector('.panel')?.hasAttribute('data-collapsed')).toBe(true);
    expect(collapse.textContent).toBe('+');
    collapse.click();
    expect(collapse.textContent).toBe('–');

    await wait(250);
    reset.click();
    await wait(250);
    // The strings on the page are recorded again right away
    expect(getShadow().textContent).toContain('3/3 seen');
  });

  test('moves into an open modal dialog and back', async () => {
    const show = vi.fn();
    const hide = vi.fn();
    const { matches } = Element.prototype;

    Object.assign(HTMLElement.prototype, { showPopover: show, hidePopover: hide });
    vi.spyOn(Element.prototype, 'matches').mockImplementation(
      /**
       * Mock of `Element.prototype.matches`.
       * @param {string} selector Selector.
       * @returns {boolean} Result.
       * @this {Element}
       */
      function mock(selector) {
        if (selector === ':modal') {
          return this.tagName === 'DIALOG' && this.hasAttribute('open');
        }

        if (selector === ':popover-open') {
          return show.mock.calls.length > 0;
        }

        return matches.call(this, selector);
      },
    );

    overlay = startL10nDebugOverlay({ registry });

    const host = /** @type {HTMLElement} */ (document.querySelector('[data-l10n-debug]'));
    const dialog = document.createElement('dialog');

    expect(host.parentElement).toBe(document.body);
    expect(show).toHaveBeenCalledOnce();

    dialog.setAttribute('open', '');
    document.body.append(dialog);
    dialog.dispatchEvent(new Event('toggle'));
    expect(host.parentElement).toBe(dialog);
    expect(hide).toHaveBeenCalled();

    // The host’s own toggle events are ignored
    host.dispatchEvent(new Event('toggle'));
    expect(host.parentElement).toBe(dialog);

    dialog.remove();
    await wait();
    expect(host.parentElement).toBe(document.body);

    // @ts-ignore
    delete HTMLElement.prototype.showPopover;
    // @ts-ignore
    delete HTMLElement.prototype.hidePopover;
  });

  test('works when `:modal` isn’t supported', () => {
    const { matches } = Element.prototype;

    vi.spyOn(Element.prototype, 'matches').mockImplementation(
      /**
       * Mock of `Element.prototype.matches`.
       * @param {string} selector Selector.
       * @returns {boolean} Result.
       * @throws {SyntaxError} For `:modal`, like a browser that doesn’t support it.
       * @this {Element}
       */
      function mock(selector) {
        if (selector === ':modal') {
          throw new SyntaxError('Unsupported');
        }

        return matches.call(this, selector);
      },
    );

    const dialog = document.createElement('dialog');

    dialog.setAttribute('open', '');
    document.body.append(dialog);
    overlay = startL10nDebugOverlay({ registry });

    expect(document.querySelector('[data-l10n-debug]')?.parentElement).toBe(document.body);
  });

  test('removes everything on stop', () => {
    const instance = startL10nDebugOverlay({ registry });

    document.documentElement.setAttribute(HIDDEN_ATTR, '');
    instance.stop();

    expect(document.querySelector('[data-l10n-debug]')).toBeNull();
    expect(document.head.querySelector('style')).toBeNull();
    expect(document.querySelector(`[${TEXT_STATUS_ATTR}], [${ATTR_STATUS_ATTR}]`)).toBeNull();
    expect(document.documentElement.hasAttribute(HIDDEN_ATTR)).toBe(false);
  });

  test('treats every string as translated without a locale, and skips rendered text', async () => {
    document.documentElement.lang = '';

    const rendered = /** @type {HTMLElement} */ (document.getElementById('translated'));
    const { getClientRects } = Element.prototype;

    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(
      /**
       * Mock of `Element.prototype.getClientRects`.
       * @returns {DOMRectList} Rectangles.
       * @this {Element}
       */
      function mock() {
        return this === rendered
          ? /** @type {DOMRectList} */ (/** @type {unknown} */ ([{ width: 100, height: 20 }]))
          : getClientRects.call(this);
      },
    );

    overlay = startL10nDebugOverlay({ registry });
    expect(document.getElementById('missing')?.getAttribute(TEXT_STATUS_ATTR)).toBe('source-0');

    rendered.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    expect(getShadow().querySelector('.tooltip')?.textContent).toContain('locales/es.yaml');

    await wait(250);

    const section = /** @type {HTMLDetailsElement} */ (
      [...getShadow().querySelectorAll('details')].at(-1)
    );

    section.open = true;
    section.dispatchEvent(new Event('toggle'));
    expect(section.textContent).not.toContain('“Hola”');
    expect(section.textContent).toContain('“Bye”');
  });

  test('counts the strings of an element as shown only once it’s displayed', async () => {
    const menu = document.createElement('div');
    let open = false;

    menu.setAttribute('popover', '');
    menu.innerHTML = `<span id="menu-item">${app.es.bye}</span>`;
    document.body.append(menu);

    const { checkVisibility } = Element.prototype;

    Element.prototype.checkVisibility = function mock() {
      return this.id === 'menu-item' ? open : true;
    };

    overlay = startL10nDebugOverlay({
      registry,
      checklist: [{ id: 'bye', label: 'Bye', source: 'App', keys: ['bye'] }],
      storageKey: 'visibility',
    });

    // The element is outlined, but its string isn’t counted while the menu is closed
    expect(document.getElementById('menu-item')?.getAttribute(TEXT_STATUS_ATTR)).toBe('source-0');
    await wait(250);
    expect(getShadow().querySelector('.item')?.textContent).toContain('Bye 1/1');
    overlay.stop();
    localStorage.clear();

    document.getElementById('foreign')?.remove();
    overlay = startL10nDebugOverlay({
      registry,
      checklist: [{ id: 'bye', label: 'Bye', source: 'App', keys: ['bye'] }],
      storageKey: 'visibility',
    });
    await wait(250);
    expect(getShadow().querySelector('.item')?.textContent).toContain('Bye 0/1');

    // A `<details>` element opening doesn’t count
    open = true;
    document.body.append(document.createElement('details'));
    document.querySelector('details')?.dispatchEvent(new Event('toggle'));
    await wait(250);
    expect(getShadow().querySelector('.item')?.textContent).toContain('Bye 0/1');

    // The menu opening does
    menu.dispatchEvent(new Event('toggle'));
    await wait(250);
    expect(getShadow().querySelector('.item')?.textContent).toContain('Bye 1/1');

    Element.prototype.checkVisibility = checkVisibility;
  });

  test('checks the pending elements regularly, and forgets removed ones', async () => {
    vi.useFakeTimers();

    let open = false;
    const { checkVisibility } = Element.prototype;

    Element.prototype.checkVisibility = function mock() {
      return this.id === 'foreign' || this.id === 'missing' ? open : true;
    };

    overlay = startL10nDebugOverlay({ registry, storageKey: 'interval' });
    document.getElementById('missing')?.remove();
    open = true;
    vi.advanceTimersByTime(1500);
    overlay.stop();
    overlay = undefined;

    expect(localStorage.getItem('interval:seen')).toContain('bye');
    expect(localStorage.getItem('interval:seen')).not.toContain('only_en');

    Element.prototype.checkVisibility = checkVisibility;
    vi.useRealTimers();
  });

  test('shows the strings inside a control whose content ignores the pointer', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<button id="labelled" aria-label="${ui.close}"><span id="icon"></span>` +
        `<span id="label">${app.es.hello}</span></button>`,
    );
    overlay = startL10nDebugOverlay({ registry });

    const tooltip = /** @type {HTMLElement} */ (getShadow().querySelector('.tooltip'));

    // The pointer is over the icon, but the event targets the button, as with Sveltia UI
    document
      .getElementById('labelled')
      ?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toContain('UI · close [aria-label]');
    expect(tooltip.textContent).toContain('App · hello');
  });

  test('shows the strings under the pointer inside other elements', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div id="container"><span id="under">${app.es.hello}</span>` +
        `<span id="beside">${app.es.bye}</span></div>`,
    );
    overlay = startL10nDebugOverlay({ registry });

    const tooltip = /** @type {HTMLElement} */ (getShadow().querySelector('.tooltip'));
    const under = /** @type {HTMLElement} */ (document.getElementById('under'));
    const container = /** @type {HTMLElement} */ (document.getElementById('container'));

    vi.spyOn(under, 'getClientRects').mockReturnValue(
      /** @type {DOMRectList} */ (/** @type {unknown} */ ([new DOMRect(0, 0, 50, 20)])),
    );

    container.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10 }),
    );
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toContain('App · hello');
    expect(tooltip.textContent).not.toContain('App · bye');

    container.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 100, clientY: 10 }),
    );
    expect(tooltip.hidden).toBe(true);
  });

  test('hides the tooltip when the pointer leaves the window', () => {
    overlay = startL10nDebugOverlay({ registry });

    const tooltip = /** @type {HTMLElement} */ (getShadow().querySelector('.tooltip'));
    const missing = /** @type {HTMLElement} */ (document.getElementById('missing'));

    missing.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    missing.dispatchEvent(
      new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }),
    );
    expect(tooltip.hidden).toBe(false);
    missing.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
    expect(tooltip.hidden).toBe(true);
  });

  test('saves the progress when the page is hidden', () => {
    overlay = startL10nDebugOverlay({ registry, storageKey: 'pagehide' });
    expect(localStorage.getItem('pagehide:seen')).toBeNull();
    window.dispatchEvent(new Event('pagehide'));
    expect(localStorage.getItem('pagehide:seen')).toContain('hello');
  });

  test('can scan the page again on demand', () => {
    overlay = startL10nDebugOverlay({ registry });
    document.getElementById('translated')?.removeAttribute(TEXT_STATUS_ATTR);
    overlay.refresh();

    expect(document.getElementById('translated')?.getAttribute(TEXT_STATUS_ATTR)).toBe('source-0');
  });
});
