import { decodeMarkers, hasMessage, MARKER_START, stripMarkers } from './markers.js';
import { createProgress, getItemProgress } from './progress.js';

/**
 * @import { L10nDebugMarker, L10nDebugRegistry } from './markers.js';
 * @import { L10nDebugChecklistItem, L10nDebugProgress } from './progress.js';
 */

/**
 * A marked string found on an element, either in its text or in one of its attributes.
 * @typedef {object} L10nDebugFinding
 * @property {L10nDebugMarker} marker Marker.
 * @property {string} text String without the markers.
 * @property {string} [attribute] Name of the attribute the string is in, for example
 * `aria-label`, or nothing for the text of the element.
 * @property {string} status `source-N` for a string in the active locale, where `N` is the index
 * of the package in the registry, `missing` for a string shown in another locale because the active
 * one doesn’t have it, or `foreign` for a string shown in another locale even though the active one
 * has it, which happens on purpose, such as in a notice suggesting the browser’s language, or with
 * a string rendered before the locale was switched and not updated since.
 */

/**
 * The overlay started with {@link startL10nDebugOverlay}.
 * @typedef {object} L10nDebugOverlay
 * @property {() => void} refresh Scan the whole page again, for example after the active locale
 * has changed without the `lang` attribute of the root element being updated.
 * @property {() => void} stop Remove the overlay and everything it has added to the page.
 */

/**
 * Attributes holding strings that aren’t shown as text, mostly read out by screen readers.
 */
const DEFAULT_ATTRIBUTES = [
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-placeholder',
  'aria-valuetext',
  'alt',
  'placeholder',
  'title',
];

/**
 * Attribute set on an element whose text has marked strings. Its value is the status of the
 * strings, see {@link L10nDebugFinding.status}.
 */
const TEXT_STATUS_ATTR = 'data-l10n-debug-text';
/**
 * Attribute set on an element whose attributes have marked strings, with the same values as
 * {@link TEXT_STATUS_ATTR}.
 */
const ATTR_STATUS_ATTR = 'data-l10n-debug-attr';
/**
 * Attribute set on the root element to hide the outlines.
 */
const HIDDEN_ATTR = 'data-l10n-debug-hidden';
/**
 * Elements whose content is never shown as text.
 */
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

/**
 * Get the status of a marked string.
 * @param {L10nDebugMarker} marker Marker.
 * @param {string} activeLocale Active locale code. If it’s empty, every string counts as being in
 * the active locale.
 * @returns {string} Status, see {@link L10nDebugFinding.status}.
 */
const getStatus = (marker, activeLocale) => {
  if (!activeLocale || marker.locale === activeLocale) {
    return `source-${marker.sourceIndex}`;
  }

  return hasMessage(marker.source, activeLocale, marker.keyIndex) ? 'foreign' : 'missing';
};

/**
 * Get the status of a group of marked strings: `missing` if any of them is missing, otherwise
 * `foreign` if any of them is shown in another locale on purpose, otherwise the status of the first
 * one.
 * @param {L10nDebugFinding[]} findings Strings.
 * @returns {string | undefined} Status, or `undefined` if there are no strings.
 */
const getGroupStatus = (findings) => {
  if (!findings.length) {
    return undefined;
  }

  const statuses = findings.map(({ status }) => status);

  return ['missing', 'foreign'].find((status) => statuses.includes(status)) ?? statuses[0];
};

/**
 * Find the marked strings on the given element: in its own text nodes, not those of its children,
 * and in the given attributes.
 * @param {Element} element Element.
 * @param {object} args Arguments.
 * @param {L10nDebugRegistry} args.registry Registry.
 * @param {string[]} [args.attributes] Names of the attributes to check.
 * @param {string} [args.activeLocale] Active locale code.
 * @returns {{ text: L10nDebugFinding[], attributes: L10nDebugFinding[] }} Strings found.
 */
const findMarkedStrings = (
  element,
  { registry, attributes = DEFAULT_ATTRIBUTES, activeLocale = '' },
) => {
  /**
   * Turn the markers in the given string into findings.
   * @param {string} value String.
   * @param {string} [attribute] Attribute name.
   * @returns {L10nDebugFinding[]} Findings.
   */
  const toFindings = (value, attribute) => {
    const text = stripMarkers(value).trim();

    return decodeMarkers(value, registry).map((marker) => ({
      marker,
      text,
      attribute,
      status: getStatus(marker, activeLocale),
    }));
  };

  const ownText = [...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.nodeValue ?? '')
    .join('');

  return {
    text: SKIPPED_TAGS.has(element.tagName) ? [] : toFindings(ownText),
    attributes: attributes.flatMap((name) => {
      const value = element.getAttribute(name);

      return value?.includes(MARKER_START) ? toFindings(value, name) : [];
    }),
  };
};

/**
 * Generate the CSS rules for the outlines: solid for a string in the text of an element, dashed for
 * one in its attributes.
 * @param {L10nDebugRegistry} registry Registry.
 * @returns {string} CSS.
 */
const createStyles = ({ sources, missingColor, foreignColor }) => {
  const colors = [
    ...sources.map(({ color }, index) => [`source-${index}`, color]),
    ['missing', missingColor],
    ['foreign', foreignColor],
  ];

  const rules = colors.flatMap(([status, color]) => [
    `:root:not([${HIDDEN_ATTR}]) [${ATTR_STATUS_ATTR}="${status}"] {` +
      ` outline: 2px dashed ${color} !important; outline-offset: -2px !important; }`,
    `:root:not([${HIDDEN_ATTR}]) [${TEXT_STATUS_ATTR}="${status}"] {` +
      ` outline: 2px solid ${color} !important; outline-offset: -2px !important; }`,
  ]);

  return rules.join('\n');
};

/**
 * Get the path of the locale file a message should be translated in.
 * @param {{ path: string, repository?: string }} source Package.
 * @param {string} locale Locale code.
 * @returns {string} Path, prefixed with the repository if known.
 */
const getFilePath = (source, locale) => {
  const filePath = source.path.replace('{locale}', locale);

  return source.repository ? `${source.repository} › ${filePath}` : filePath;
};

/**
 * Styles of the panel and the tooltip, which live in a shadow root so the page can’t affect them.
 */
const SHADOW_STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .panel, .tooltip {
    font: 12px/1.4 system-ui, sans-serif; color: #eee; background: #222e; border-radius: 6px;
    box-shadow: 0 2px 12px #0006;
  }
  .panel {
    position: fixed; left: 8px; bottom: 8px; z-index: 2147483647; padding: 8px 10px;
    width: min(440px, calc(100vw - 16px)); max-height: 70vh; overflow: auto;
  }
  .panel[data-collapsed] { width: auto; }
  .panel[data-collapsed] .body { display: none; }
  .row { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; margin: 4px 0; }
  .header { justify-content: space-between; margin: 0; }
  .swatch {
    display: inline-block; flex: none; width: 10px; height: 10px; border-radius: 2px;
  }
  .legend { display: inline-flex; gap: 4px; align-items: center; }
  .hint { color: #aaa; }
  button {
    font: inherit; color: inherit; background: #444; border: 0; border-radius: 4px;
    padding: 2px 8px; cursor: pointer;
  }
  button:hover { background: #555; }
  .title { font-weight: 600; }
  details { margin: 6px 0 0; }
  summary { cursor: pointer; }
  details details { margin: 2px 0 0 16px; }
  ul { margin: 4px 0 0; padding: 0 0 0 16px; }
  li { margin: 2px 0; }
  .item { display: flex; gap: 6px; align-items: flex-start; margin: 2px 0 0 12px; }
  .item details { flex: auto; margin: 0; }
  .item input { margin: 2px 0 0; }
  .item.done summary { color: #8c8; }
  .count { color: #aaa; font-variant-numeric: tabular-nums; }
  .tooltip {
    position: fixed; z-index: 2147483647; padding: 6px 8px; pointer-events: none;
    max-width: min(420px, calc(100vw - 16px));
  }
  .tooltip[hidden] { display: none; }
  .finding + .finding { margin-top: 6px; padding-top: 6px; border-top: 1px solid #555; }
  .key { font-family: ui-monospace, monospace; }
  .missing { color: #f88; }
  .foreign { color: #c4b5fd; }
`;

/**
 * Create an element with the given class and children.
 * @param {string} tagName Tag name.
 * @param {string} [className] Class name.
 * @param {...(Node | string)} children Child nodes or text.
 * @returns {HTMLElement} Element.
 */
const h = (tagName, className, ...children) => {
  const element = document.createElement(tagName);

  if (className) {
    element.className = className;
  }

  element.append(...children);

  return element;
};

/**
 * Describe the given strings in a list of elements, for the tooltip and the panel.
 * @param {L10nDebugFinding[]} findings Strings.
 * @param {string} activeLocale Active locale code.
 * @returns {HTMLElement[]} Elements.
 */
const describeFindings = (findings, activeLocale) =>
  findings.map(({ marker, attribute, status, text }) =>
    h(
      'div',
      'finding',
      h(
        'div',
        '',
        h('span', 'title', marker.source.name),
        ' · ',
        h('span', 'key', marker.key),
        attribute ? h('span', 'hint', ` [${attribute}]`) : '',
      ),
      h('div', 'hint', getFilePath(marker.source, activeLocale || marker.locale)),
      status === 'missing'
        ? h('div', 'missing', `Missing in ${activeLocale}, showing the ${marker.locale} string`)
        : '',
      status === 'foreign'
        ? h(
            'div',
            'foreign',
            `Shown in ${marker.locale} though ${activeLocale} has it: on purpose, such as a` +
              ' suggestion to switch languages, or left over from before the language was switched.',
          )
        : '',
      attribute && text ? h('div', 'hint', `“${text}”`) : '',
    ),
  );

/**
 * Check whether the given element is rendered with a visible size. Elements hidden with the usual
 * “visually hidden” technique, which clips them to 1×1 pixel, count as invisible.
 * @param {Element} element Element.
 * @returns {boolean} Result.
 */
const isRendered = (element) =>
  [...element.getClientRects()].some(({ width, height }) => width > 1 && height > 1);

/**
 * Check whether the given element is displayed, so its strings can be counted as shown. Unlike
 * {@link isRendered}, this is true for an element hidden with the “visually hidden” technique,
 * whose text screen readers read out, but false for one in a closed menu, popover or dialog, which
 * stays in the page until it’s opened.
 * @param {Element} element Element.
 * @returns {boolean} Result. Always `true` in a browser without `checkVisibility()`.
 */
const isShown = (element) =>
  typeof element.checkVisibility === 'function'
    ? element.checkVisibility({ visibilityProperty: true })
    : true;

/**
 * Interval at which the elements whose strings haven’t been counted as shown yet are checked
 * again, in milliseconds, as a menu or a popover can be opened without changing the page.
 */
const VISIBILITY_CHECK_INTERVAL = 1000;

/**
 * Create the checklist section of the panel.
 * @param {object} args Arguments.
 * @param {L10nDebugChecklistItem[]} args.checklist Items.
 * @param {L10nDebugProgress} args.progress Progress.
 * @param {L10nDebugRegistry} args.registry Registry.
 * @param {() => string} args.getActiveLocale Function returning the active locale code.
 * @returns {{ element: HTMLElement, update: () => void }} Section and a function updating it.
 */
const createChecklist = ({ checklist, progress, registry, getActiveLocale }) => {
  const heading = h('summary', '', h('span', 'title', 'Checklist'), ' ');
  const headingCount = h('span', 'count');
  const element = h('details', '', heading);
  /** @type {Map<string, HTMLElement>} */
  const groups = new Map();

  heading.append(headingCount);

  const rows = checklist.map((item) => {
    const groupName = item.group ?? '';

    if (!groups.has(groupName)) {
      const group = h('details', '', h('summary', 'title', groupName || 'Other'));

      groups.set(groupName, group);
      element.append(group);
    }

    const checkbox = /** @type {HTMLInputElement} */ (h('input'));
    const count = h('span', 'count');
    const unseenList = h('ul');

    const details = /** @type {HTMLDetailsElement} */ (
      h('details', '', h('summary', '', `${item.label} `, count))
    );

    const row = h('div', 'item', checkbox, details);
    const source = registry.sources.find(({ name }) => name === item.source);

    checkbox.type = 'checkbox';
    checkbox.title = 'Mark as checked';
    checkbox.addEventListener('change', () => {
      progress.setChecked(item.id, checkbox.checked);
      // eslint-disable-next-line no-use-before-define
      update();
    });

    if (item.hint) {
      details.append(h('div', 'hint', item.hint));
    }

    details.append(unseenList);
    details.addEventListener('toggle', () => {
      // eslint-disable-next-line no-use-before-define
      update();
    });
    /** @type {HTMLElement} */ (groups.get(groupName)).append(row);

    return { item, checkbox, count, unseenList, details, row, source };
  });

  /**
   * Update the progress of the items.
   */
  const update = () => {
    let doneCount = 0;

    rows.forEach(({ item, checkbox, count, unseenList, details, row, source }) => {
      const { seen, total, unseen, done } = getItemProgress(item, progress);

      if (done) {
        doneCount += 1;
      }

      count.textContent = `${seen}/${total}`;
      checkbox.checked = progress.isChecked(item.id);
      row.classList.toggle('done', done);

      if (details.open) {
        unseenList.replaceChildren(
          ...(source ? [h('li', 'hint', getFilePath(source, getActiveLocale()))] : []),
          h('li', 'hint', unseen.length ? 'Not shown yet:' : 'All the strings have been shown.'),
          ...unseen.map((key) => h('li', 'key', key)),
        );
      } else if (unseenList.childElementCount) {
        unseenList.replaceChildren();
      }
    });

    headingCount.textContent = `${doneCount}/${rows.length} parts done`;
  };

  return { element, update };
};

/**
 * Outline the localized strings on the page: in the color of the package they come from, or in the
 * missing color if they come from a locale other than the active one because it doesn’t have them.
 * Strings shown in another locale on purpose get the foreign color. The active locale is read from
 * the `lang` attribute of the root element. Strings in the text of an element get a solid outline,
 * those in its attributes, such as `aria-label`, a dashed one. Hovering over an outlined element
 * shows where its strings live. A panel lists the counts, a checklist of the parts of the app with
 * the share of their strings that have been shown so far, and the strings that aren’t rendered
 * visibly. Meant for development only: the strings have to be marked with `markMessages()` first.
 * @param {object} args Arguments.
 * @param {L10nDebugRegistry} args.registry Registry the strings were marked with.
 * @param {string[]} [args.attributes] Names of the attributes to check for strings.
 * @param {L10nDebugChecklistItem[]} [args.checklist] Parts of the app to check.
 * @param {string} [args.storageKey] Prefix of the local storage keys the progress is saved under.
 * @returns {L10nDebugOverlay} Overlay.
 */
const startL10nDebugOverlay = ({
  registry,
  attributes = DEFAULT_ATTRIBUTES,
  checklist = [],
  storageKey = 'l10n-debug',
}) => {
  const root = document.documentElement;
  const progress = createProgress(storageKey);
  const style = h('style');
  const host = h('div');
  const shadow = host.attachShadow({ mode: 'open' });
  const panel = h('div', 'panel');
  const tooltip = h('div', 'tooltip');
  const summary = h('div', 'row');
  const hiddenList = h('ul');

  const hiddenSection = /** @type {HTMLDetailsElement} */ (
    h('details', '', h('summary', 'title', 'Non-visible strings'), hiddenList)
  );

  const toggleOutlinesButton = h('button', '', 'Hide outlines');
  const resetButton = h('button', '', 'Reset progress');
  const collapseButton = h('button', '', '–');
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let summaryTimer;
  let progressChanged = false;
  /**
   * Elements with strings that haven’t been counted as shown yet, because the elements aren’t
   * displayed.
   * @type {Set<Element>}
   */
  const pendingElements = new Set();
  /**
   * Get the active locale code.
   * @returns {string} Locale code.
   */
  const getActiveLocale = () => root.lang;
  const checklistSection = createChecklist({ checklist, progress, registry, getActiveLocale });

  /**
   * Find the marked strings on the given element.
   * @param {Element} element Element.
   * @returns {{ text: L10nDebugFinding[], attributes: L10nDebugFinding[] }} Strings found.
   */
  const find = (element) =>
    findMarkedStrings(element, { registry, attributes, activeLocale: getActiveLocale() });

  /**
   * Record the given strings as shown.
   * @param {L10nDebugFinding[]} findings Strings.
   */
  const recordShown = (findings) => {
    findings.forEach(({ marker }) => {
      if (progress.add(marker.source.name, marker.key)) {
        progressChanged = true;
      }
    });
  };

  /**
   * Update the status attributes of the given element, and record its strings as shown if it’s
   * displayed, or check it again later otherwise.
   * @param {Element} element Element.
   */
  const evaluate = (element) => {
    if (element === host) {
      return;
    }

    const { text, attributes: attrs } = find(element);
    const findings = [...text, ...attrs];

    if (!findings.length) {
      pendingElements.delete(element);
    } else if (isShown(element)) {
      pendingElements.delete(element);
      recordShown(findings);
    } else {
      pendingElements.add(element);
    }

    /** @type {[string, string | undefined][]} */ ([
      [TEXT_STATUS_ATTR, getGroupStatus(text)],
      [ATTR_STATUS_ATTR, getGroupStatus(attrs)],
    ]).forEach(([name, status]) => {
      if (status) {
        if (element.getAttribute(name) !== status) {
          element.setAttribute(name, status);
        }
      } else if (element.hasAttribute(name)) {
        element.removeAttribute(name);
      }
    });
  };

  /**
   * Get all the elements with marked strings.
   * @returns {Element[]} Elements.
   */
  const getMarkedElements = () => [
    ...root.querySelectorAll(`[${TEXT_STATUS_ATTR}], [${ATTR_STATUS_ATTR}]`),
  ];

  /**
   * Update the counts, the checklist and the list of strings that aren’t rendered visibly, and
   * save the progress.
   */
  const updateSummary = () => {
    const activeLocale = getActiveLocale();
    const findings = getMarkedElements().map((element) => ({ element, ...find(element) }));
    /** @type {Map<string, number>} */
    const counts = new Map();

    if (progressChanged) {
      progress.save();
      progressChanged = false;
    }

    findings.forEach(({ text, attributes: attrs }) => {
      [...text, ...attrs].forEach(({ status }) => {
        counts.set(status, (counts.get(status) ?? 0) + 1);
      });
    });

    summary.replaceChildren(
      ...registry.sources.map(({ name, color, keys }, index) =>
        h(
          'span',
          'legend',
          Object.assign(h('span', 'swatch'), { style: `background: ${color}` }),
          `${name}: ${counts.get(`source-${index}`) ?? 0} on screen, `,
          h('span', 'count', `${progress.count(name)}/${keys.length} seen`),
        ),
      ),
      h(
        'span',
        'legend',
        Object.assign(h('span', 'swatch'), { style: `background: ${registry.missingColor}` }),
        `Missing: ${counts.get('missing') ?? 0} on screen`,
      ),
      h(
        'span',
        'legend',
        Object.assign(h('span', 'swatch'), { style: `background: ${registry.foreignColor}` }),
        `Other locale: ${counts.get('foreign') ?? 0} on screen`,
      ),
    );

    checklistSection.update();

    hiddenList.replaceChildren(
      ...(hiddenSection.open
        ? findings.flatMap(({ element, text, attributes: attrs }) =>
            [...(isRendered(element) ? [] : text), ...attrs].map((finding) =>
              h(
                'li',
                '',
                h('span', finding.status, `“${finding.text}”`),
                ...describeFindings([finding], activeLocale),
              ),
            ),
          )
        : []),
    );
  };

  /**
   * Update the summary soon, once the page has settled.
   */
  const scheduleSummary = () => {
    clearTimeout(summaryTimer);
    summaryTimer = setTimeout(updateSummary, 200);
  };

  /**
   * Record the strings of the pending elements that are now displayed.
   */
  const checkPendingElements = () => {
    let changed = false;

    pendingElements.forEach((element) => {
      if (!element.isConnected) {
        pendingElements.delete(element);
      } else if (isShown(element)) {
        const { text, attributes: attrs } = find(element);

        pendingElements.delete(element);
        recordShown([...text, ...attrs]);
        changed = true;
      }
    });

    if (changed) {
      scheduleSummary();
    }
  };

  /**
   * Scan the whole page.
   */
  const refresh = () => {
    [root, ...root.querySelectorAll('*')].forEach(evaluate);
    scheduleSummary();
  };

  /**
   * Show the panel and the tooltip above everything else. The host is moved into the topmost open
   * modal dialog, if any, because the rest of the page is inert while a modal dialog is open, so
   * the panel couldn’t be used otherwise. It’s then put in the top layer again, above the dialog
   * and any popover.
   */
  const raise = () => {
    const modals = [...document.querySelectorAll('dialog[open]')].filter((dialog) => {
      try {
        return dialog.matches(':modal');
      } catch {
        return false;
      }
    });

    const parent = modals.at(-1) ?? document.body;

    if (host.parentElement !== parent) {
      parent.append(host);
    }

    if (typeof host.showPopover !== 'function') {
      return;
    }

    if (host.matches(':popover-open')) {
      host.hidePopover();
    }

    host.showPopover();
  };

  const observer = new MutationObserver((records) => {
    /** @type {Set<Element>} */
    const elements = new Set();
    let fullRefresh = false;

    records.forEach(({ type, target, addedNodes, attributeName }) => {
      if (type === 'attributes' && target === root && attributeName === 'lang') {
        fullRefresh = true;

        return;
      }

      if (target.nodeType === Node.TEXT_NODE) {
        if (target.parentElement) {
          elements.add(target.parentElement);
        }

        return;
      }

      elements.add(/** @type {Element} */ (target));

      addedNodes.forEach((node) => {
        if (node instanceof Element) {
          elements.add(node);
          node.querySelectorAll('*').forEach((child) => elements.add(child));
        }
      });
    });

    // The host is removed along with a dialog it was moved into
    if (!host.isConnected) {
      raise();
    }

    if (fullRefresh) {
      refresh();
    } else {
      elements.forEach(evaluate);
      scheduleSummary();
    }
  });

  /**
   * Show the tooltip for the outlined element under the pointer.
   * @param {PointerEvent} event `pointermove` event.
   */
  const onPointerMove = (event) => {
    const target = event.target instanceof Element ? event.target : null;

    const element =
      target && !host.contains(target)
        ? target.closest(`[${TEXT_STATUS_ATTR}], [${ATTR_STATUS_ATTR}]`)
        : null;

    if (!element) {
      tooltip.hidden = true;

      return;
    }

    const { text, attributes: attrs } = find(element);

    tooltip.replaceChildren(...describeFindings([...text, ...attrs], getActiveLocale()));
    tooltip.hidden = false;

    const { innerWidth, innerHeight } = window;
    const { offsetWidth, offsetHeight } = tooltip;
    const x = Math.min(event.clientX + 12, innerWidth - offsetWidth - 8);

    const y =
      event.clientY + 16 + offsetHeight > innerHeight
        ? event.clientY - offsetHeight - 8
        : event.clientY + 16;

    tooltip.style.left = `${Math.max(8, x)}px`;
    tooltip.style.top = `${Math.max(8, y)}px`;
  };

  /**
   * Hide the tooltip when the pointer leaves the window.
   * @param {PointerEvent} event `pointerout` event.
   */
  const onPointerOut = (event) => {
    if (!event.relatedTarget) {
      tooltip.hidden = true;
    }
  };

  /**
   * Put the overlay above a dialog or popover the page has just opened, or back on the page once a
   * modal dialog it was moved into has been closed, and count the strings that have appeared.
   * Other elements firing the event, like `<details>`, are ignored.
   * @param {Event} event `toggle` event.
   */
  const onToggle = (event) => {
    const { target } = event;

    if (target !== host && target instanceof Element && target.matches('dialog, [popover]')) {
      raise();
      checkPendingElements();
    }
  };

  /**
   * Save the progress before the page is unloaded.
   */
  const onPageHide = () => {
    progress.save();
  };

  toggleOutlinesButton.addEventListener('click', () => {
    const hidden = root.toggleAttribute(HIDDEN_ATTR);

    toggleOutlinesButton.textContent = hidden ? 'Show outlines' : 'Hide outlines';
  });

  resetButton.addEventListener('click', () => {
    progress.reset();
    refresh();
  });

  collapseButton.addEventListener('click', () => {
    const collapsed = panel.toggleAttribute('data-collapsed');

    collapseButton.textContent = collapsed ? '+' : '–';
  });

  hiddenSection.addEventListener('toggle', updateSummary);

  panel.append(
    h('div', 'row header', h('span', 'title', 'L10n debug'), collapseButton),
    h(
      'div',
      'body',
      summary,
      h('div', 'hint', 'Solid outline: text. Dashed outline: attribute (aria-label…).'),
      h('div', 'hint', 'Hover over an outlined element to see where its strings live.'),
      h('div', 'row', toggleOutlinesButton, resetButton),
      ...(checklist.length ? [checklistSection.element] : []),
      hiddenSection,
    ),
  );
  tooltip.hidden = true;
  shadow.append(h('style', '', SHADOW_STYLES), panel, tooltip);
  host.setAttribute('popover', 'manual');
  host.dataset.l10nDebug = '';
  style.textContent = createStyles(registry);
  document.head.append(style);
  raise();
  refresh();
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...attributes, 'lang'],
  });
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  document.addEventListener('pointerout', onPointerOut, { capture: true, passive: true });
  document.addEventListener('toggle', onToggle, { capture: true });
  window.addEventListener('pagehide', onPageHide);

  const visibilityTimer = setInterval(checkPendingElements, VISIBILITY_CHECK_INTERVAL);

  return {
    refresh,
    // eslint-disable-next-line jsdoc/require-jsdoc
    stop: () => {
      observer.disconnect();
      clearTimeout(summaryTimer);
      clearInterval(visibilityTimer);
      progress.save();
      document.removeEventListener('pointermove', onPointerMove, { capture: true });
      document.removeEventListener('pointerout', onPointerOut, { capture: true });
      document.removeEventListener('toggle', onToggle, { capture: true });
      window.removeEventListener('pagehide', onPageHide);
      style.remove();
      host.remove();
      root.removeAttribute(HIDDEN_ATTR);
      getMarkedElements().forEach((element) => {
        element.removeAttribute(TEXT_STATUS_ATTR);
        element.removeAttribute(ATTR_STATUS_ATTR);
      });
    },
  };
};

export {
  ATTR_STATUS_ATTR,
  createStyles,
  DEFAULT_ATTRIBUTES,
  findMarkedStrings,
  getGroupStatus,
  getStatus,
  HIDDEN_ATTR,
  startL10nDebugOverlay,
  TEXT_STATUS_ATTR,
};
