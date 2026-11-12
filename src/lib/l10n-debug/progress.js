/**
 * @import { L10nDebugRegistry } from './markers.js';
 */

/**
 * A part of the app to check, listed in the checklist of the overlay. Its progress is the share of
 * its messages that have been shown on the page.
 * @typedef {object} L10nDebugChecklistItem
 * @property {string} id Unique ID, used to remember whether the item has been checked off.
 * @property {string} label Label, for example `Settings Dialog`.
 * @property {string} source Name of the package the messages belong to.
 * @property {string[]} keys Dot-separated paths of the messages in that part of the app.
 * @property {string} [group] Heading the item is listed under, for example the package name.
 * @property {string} [hint] How to get to that part of the app.
 */

/**
 * Progress of the localization check, remembered across page loads.
 * @typedef {object} L10nDebugProgress
 * @property {(source: string, key: string) => boolean} add Record that a message has been shown.
 * Returns whether it hadn’t been shown before.
 * @property {(source: string, key: string) => boolean} has Check whether a message has been shown.
 * @property {(source: string) => number} count Get the number of messages of a package that have
 * been shown.
 * @property {(id: string) => boolean} isChecked Check whether a checklist item has been checked
 * off by hand.
 * @property {(id: string, checked: boolean) => void} setChecked Check off a checklist item by hand,
 * or undo it.
 * @property {() => void} save Save the progress to the storage.
 * @property {() => void} reset Forget the progress.
 */

/**
 * Separator between the package name and the message path in a stored key. The control character
 * can’t appear in either.
 */
const SEPARATOR = '\u0000';

/**
 * Read a JSON value from the local storage.
 * @param {string} key Storage key.
 * @returns {any} Value, or `undefined` if it’s missing, invalid or the storage is unavailable.
 */
const readStorage = (key) => {
  try {
    const value = globalThis.localStorage?.getItem(key);

    return value ? JSON.parse(value) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Write a JSON value to the local storage, ignoring errors, for example when the storage is full
 * or blocked.
 * @param {string} key Storage key.
 * @param {any} value Value.
 */
const writeStorage = (key, value) => {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing to do
  }
};

/**
 * Create the progress store, loading what has been saved under the given storage key.
 * @param {string} storageKey Prefix of the local storage keys.
 * @returns {L10nDebugProgress} Progress.
 */
const createProgress = (storageKey) => {
  const seenKey = `${storageKey}:seen`;
  const checkedKey = `${storageKey}:checked`;
  /** @type {Set<string>} */
  const seen = new Set(readStorage(seenKey) ?? []);
  /** @type {Set<string>} */
  const checked = new Set(readStorage(checkedKey) ?? []);

  return {
    // eslint-disable-next-line jsdoc/require-jsdoc
    add: (source, key) => {
      const entry = `${source}${SEPARATOR}${key}`;

      if (seen.has(entry)) {
        return false;
      }

      seen.add(entry);

      return true;
    },
    // eslint-disable-next-line jsdoc/require-jsdoc
    has: (source, key) => seen.has(`${source}${SEPARATOR}${key}`),
    // eslint-disable-next-line jsdoc/require-jsdoc
    count: (source) =>
      [...seen].filter((entry) => entry.startsWith(`${source}${SEPARATOR}`)).length,
    // eslint-disable-next-line jsdoc/require-jsdoc
    isChecked: (id) => checked.has(id),
    // eslint-disable-next-line jsdoc/require-jsdoc
    setChecked: (id, value) => {
      if (value) {
        checked.add(id);
      } else {
        checked.delete(id);
      }

      writeStorage(checkedKey, [...checked]);
    },
    // eslint-disable-next-line jsdoc/require-jsdoc
    save: () => {
      writeStorage(seenKey, [...seen]);
    },
    // eslint-disable-next-line jsdoc/require-jsdoc
    reset: () => {
      seen.clear();
      checked.clear();
      writeStorage(seenKey, []);
      writeStorage(checkedKey, []);
    },
  };
};

/**
 * Get the progress of a checklist item.
 * @param {L10nDebugChecklistItem} item Item.
 * @param {L10nDebugProgress} progress Progress.
 * @returns {{ seen: number, total: number, unseen: string[], done: boolean }} Number of messages
 * shown, total number of messages, the messages not shown yet, and whether the item is done: all
 * its messages have been shown or it has been checked off by hand.
 */
const getItemProgress = (item, progress) => {
  const unseen = item.keys.filter((key) => !progress.has(item.source, key));
  const total = item.keys.length;

  return {
    seen: total - unseen.length,
    total,
    unseen,
    done: unseen.length === 0 || progress.isChecked(item.id),
  };
};

/**
 * Create a checklist item for each top-level key of the given package, for a package whose locale
 * files aren’t divided into sections, like a UI library with a group of messages per component.
 * @param {L10nDebugRegistry} registry Registry.
 * @param {string} source Package name.
 * @returns {L10nDebugChecklistItem[]} Items.
 */
const createChecklistByTopLevelKey = (registry, source) => {
  const { keys = [] } = registry.sources.find(({ name }) => name === source) ?? {};
  /** @type {Map<string, string[]>} */
  const groups = new Map();

  keys.forEach((key) => {
    const [first] = key.split('.');
    const label = key.includes('.') ? first : 'Common';

    groups.set(label, [...(groups.get(label) ?? []), key]);
  });

  return [...groups].map(([label, groupKeys]) => ({
    id: `${source}:${label}`,
    label,
    source,
    keys: groupKeys,
    group: source,
  }));
};

export { createChecklistByTopLevelKey, createProgress, getItemProgress };
