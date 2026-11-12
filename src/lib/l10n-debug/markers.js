/**
 * A package whose localized strings are marked, such as an app or a UI library it uses.
 * @typedef {object} L10nDebugSource
 * @property {string} name Display name, for example `Sveltia CMS`.
 * @property {string} [repository] Repository the locale files live in, for example
 * `sveltia/sveltia-cms`.
 * @property {string} path Path of the locale files within the repository, with a `{locale}`
 * placeholder, for example `src/lib/locales/{locale}.yaml`.
 * @property {string} color CSS color of the outlines drawn around the strings of the package.
 * @property {string[]} keys Dot-separated paths of the messages found in any locale file of the
 * package, for example `calendar.year`. A marker refers to a message by its index in this list.
 * @property {Record<string, number[]>} absentKeys Indexes in {@link L10nDebugSource.keys} of the
 * messages each locale file of the package doesn’t have, keyed with the locale code. A locale
 * without a file isn’t listed.
 */

/**
 * Lookup table shared by the code that marks the strings and the code that reads the markers back.
 * It’s serializable, so it can be built on a server and sent to the browser.
 * @typedef {object} L10nDebugRegistry
 * @property {L10nDebugSource[]} sources Packages.
 * @property {string[]} locales Locale codes found in any locale file of any package. A marker
 * refers to the locale file a string comes from by its index in this list.
 * @property {string} missingColor CSS color of the outlines drawn around the strings that aren’t
 * translated into the active locale, so another locale is shown instead.
 * @property {string} foreignColor CSS color of the outlines drawn around the strings that are
 * translated into the active locale, but shown in another one, either on purpose, such as in a
 * notice suggesting to switch to the browser’s language, or because they were rendered before the
 * locale was switched.
 */

/**
 * A package and its strings, used to build an {@link L10nDebugRegistry}.
 * @typedef {object} L10nDebugSourceInput
 * @property {string} name Display name.
 * @property {string} [repository] Repository the locale files live in.
 * @property {string} path Path of the locale files, with a `{locale}` placeholder.
 * @property {string} color CSS color of the outlines.
 * @property {Record<string, Record<string, any>>} messages Parsed locale files, keyed with the
 * locale code.
 */

/**
 * What a marker refers to, resolved with an {@link L10nDebugRegistry}.
 * @typedef {object} L10nDebugMarker
 * @property {number} sourceIndex Index of the package in the registry.
 * @property {L10nDebugSource} source Package.
 * @property {string} locale Locale code of the file the string comes from.
 * @property {number} keyIndex Index of the message in {@link L10nDebugSource.keys}.
 * @property {string} key Dot-separated path of the message in the locale file.
 */

/**
 * Character starting a marker: U+E0001 LANGUAGE TAG. Tag characters are invisible, take up no
 * space and don’t join with the characters around them, so a marked string looks the same as the
 * original one.
 */
const MARKER_START = '\u{E0001}';
/**
 * Code point of the first of the {@link DIGIT_COUNT} tag characters used as the digits of a
 * marker: U+E0020 TAG SPACE to U+E007E TAG TILDE.
 */
const FIRST_DIGIT = 0xe0020;
/**
 * Number of digits, which is the base of the numbers encoded in a marker.
 */
const DIGIT_COUNT = 95;
/**
 * Number of digits used for each number encoded in a marker: the package index, the locale index
 * and the message index, in this order.
 */
const FIELD_WIDTHS = [1, 2, 2];
/**
 * Largest number each field of a marker can hold.
 */
const FIELD_LIMITS = FIELD_WIDTHS.map((width) => DIGIT_COUNT ** width - 1);

/**
 * Regular expression matching a marker, capturing its digits.
 */
const MARKER_REGEX = new RegExp(
  `${MARKER_START}([\\u{E0020}-\\u{E007E}]{${FIELD_WIDTHS.reduce((a, b) => a + b, 0)}})`,
  'gu',
);

/**
 * Regular expression matching the start of a complex MessageFormat 2 message, which begins with a
 * declaration like `.input` or `.match`, or with a quoted pattern.
 */
const COMPLEX_MESSAGE_REGEX = /^\s*(?:\.|\{\{)/;
/**
 * Regular expression matching the opening braces of a quoted pattern in a complex message, which
 * starts each variant of a `.match` statement. Escaped braces, written as `\{\{`, are never
 * adjacent.
 */
const QUOTED_PATTERN_REGEX = /(?<!\\)\{\{/g;

/**
 * Flatten a parsed locale file into dot-separated message paths.
 * @param {Record<string, any>} messages Parsed locale file.
 * @param {string} [prefix] Path of the object being flattened.
 * @returns {[string, string][]} Pairs of a path and a message.
 */
const flattenMessages = (messages, prefix = '') =>
  Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'string') {
      return /** @type {[string, string][]} */ ([[path, value]]);
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return flattenMessages(value, path);
    }

    return [];
  });

/**
 * Build the lookup table for the given packages.
 * @param {object} args Arguments.
 * @param {L10nDebugSourceInput[]} args.sources Packages and their strings.
 * @param {string} [args.missingColor] CSS color of the outlines drawn around untranslated strings.
 * @param {string} [args.foreignColor] CSS color of the outlines drawn around strings deliberately
 * shown in another locale.
 * @returns {L10nDebugRegistry} Registry.
 * @throws {RangeError} When there are more packages, locales or messages than a marker can refer
 * to.
 */
const createL10nDebugRegistry = ({ sources, missingColor = '#e00', foreignColor = '#8b5cf6' }) => {
  const locales = [...new Set(sources.flatMap(({ messages }) => Object.keys(messages)))].sort();

  const registry = {
    sources: sources.map(({ messages, ...rest }) => {
      const keysByLocale = Object.entries(messages).map(
        ([locale, strings]) =>
          /** @type {[string, Set<string>]} */ ([
            locale,
            new Set(flattenMessages(strings).map(([key]) => key)),
          ]),
      );

      const keys = [...new Set(keysByLocale.flatMap(([, set]) => [...set]))].sort();

      return {
        ...rest,
        keys,
        absentKeys: Object.fromEntries(
          keysByLocale.map(([locale, set]) => [
            locale,
            keys.flatMap((key, index) => (set.has(key) ? [] : [index])),
          ]),
        ),
      };
    }),
    locales,
    missingColor,
    foreignColor,
  };

  const counts = [
    registry.sources.length,
    locales.length,
    Math.max(0, ...registry.sources.map(({ keys }) => keys.length)),
  ];

  counts.forEach((count, index) => {
    if (count - 1 > FIELD_LIMITS[index]) {
      throw new RangeError(`Too many items for a marker to refer to: ${count}`);
    }
  });

  return registry;
};

/**
 * Encode the given numbers into a marker.
 * @param {number[]} values Package index, locale index and message index.
 * @returns {string} Marker.
 */
const encodeMarker = (values) =>
  MARKER_START +
  values
    .map((value, index) => {
      let digits = '';
      let rest = value;

      for (let i = 0; i < FIELD_WIDTHS[index]; i += 1) {
        digits = String.fromCodePoint(FIRST_DIGIT + (rest % DIGIT_COUNT)) + digits;
        rest = Math.floor(rest / DIGIT_COUNT);
      }

      return digits;
    })
    .join('');

/**
 * Add a marker to a MessageFormat 2 message, keeping its syntax valid: a simple message gets the
 * marker at the start, while a complex message gets it at the start of each quoted pattern, so
 * that the formatted string starts with the marker whichever variant is selected.
 * @param {string} message Message.
 * @param {string} marker Marker.
 * @returns {string} Marked message.
 */
const markMessage = (message, marker) =>
  COMPLEX_MESSAGE_REGEX.test(message)
    ? message.replace(QUOTED_PATTERN_REGEX, `{{${marker}`)
    : `${marker}${message}`;

/**
 * Add markers to all the messages of a parsed locale file, so that the strings formatted from them
 * can be traced back to the package, the locale file and the message.
 * @param {Record<string, any>} messages Parsed locale file.
 * @param {object} args Arguments.
 * @param {L10nDebugRegistry} args.registry Registry.
 * @param {string} args.source Name of the package the file belongs to.
 * @param {string} args.locale Locale code of the file.
 * @returns {Record<string, any>} Copy of the locale file with the messages marked. Messages the
 * registry doesn’t know, such as ones added after it was built, are left as is.
 * @throws {Error} When the registry doesn’t have the package or the locale.
 */
const markMessages = (messages, { registry, source, locale }) => {
  const sourceIndex = registry.sources.findIndex(({ name }) => name === source);
  const localeIndex = registry.locales.indexOf(locale);

  if (sourceIndex === -1 || localeIndex === -1) {
    throw new Error(`Unknown package or locale: ${source}, ${locale}`);
  }

  const keyIndexes = new Map(registry.sources[sourceIndex].keys.map((key, index) => [key, index]));

  /**
   * Mark the messages in the given object.
   * @param {Record<string, any>} object Object.
   * @param {string} prefix Path of the object.
   * @returns {Record<string, any>} Marked copy.
   */
  const mark = (object, prefix) =>
    Object.fromEntries(
      Object.entries(object).map(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;

        if (typeof value === 'string') {
          const keyIndex = keyIndexes.get(path);

          return [
            key,
            keyIndex === undefined
              ? value
              : markMessage(value, encodeMarker([sourceIndex, localeIndex, keyIndex])),
          ];
        }

        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return [key, mark(value, path)];
        }

        return [key, value];
      }),
    );

  return mark(messages, '');
};

/**
 * Find the markers in the given string and resolve them with the registry.
 * @param {string} text String, such as the text of a DOM node.
 * @param {L10nDebugRegistry} registry Registry.
 * @returns {L10nDebugMarker[]} Markers, in the order they appear. Markers the registry can’t
 * resolve are skipped.
 */
const decodeMarkers = (text, registry) => {
  if (!text.includes(MARKER_START)) {
    return [];
  }

  return [...text.matchAll(MARKER_REGEX)].flatMap(([, digits]) => {
    const codePoints = [...digits].map((char) => /** @type {number} */ (char.codePointAt(0)));
    let offset = 0;

    const [sourceIndex, localeIndex, keyIndex] = FIELD_WIDTHS.map((width) => {
      const value = codePoints
        .slice(offset, offset + width)
        .reduce((result, codePoint) => result * DIGIT_COUNT + (codePoint - FIRST_DIGIT), 0);

      offset += width;

      return value;
    });

    const source = registry.sources[sourceIndex];
    const locale = registry.locales[localeIndex];
    const key = source?.keys[keyIndex];

    return source && locale && key ? [{ sourceIndex, source, locale, keyIndex, key }] : [];
  });
};

/**
 * Check whether the locale file of a package has a message.
 * @param {L10nDebugSource} source Package.
 * @param {string} locale Locale code.
 * @param {number} keyIndex Index of the message in {@link L10nDebugSource.keys}.
 * @returns {boolean} `true` if the file exists and has the message.
 */
const hasMessage = (source, locale, keyIndex) => {
  const absent = source.absentKeys[locale];

  return !!absent && !absent.includes(keyIndex);
};

/**
 * Remove the markers from the given string.
 * @param {string} text String.
 * @returns {string} String without markers.
 */
const stripMarkers = (text) => text.replace(MARKER_REGEX, '');

export {
  createL10nDebugRegistry,
  decodeMarkers,
  encodeMarker,
  hasMessage,
  markMessage,
  markMessages,
  MARKER_START,
  stripMarkers,
};
