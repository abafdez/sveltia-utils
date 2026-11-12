import { describe, expect, test } from 'vitest';

import {
  createL10nDebugRegistry,
  decodeMarkers,
  encodeMarker,
  hasMessage,
  MARKER_START,
  markMessage,
  markMessages,
  stripMarkers,
} from './markers.js';

const COUNT_MESSAGE =
  '.input {$count :integer} .match $count one {{One item}} * {{{$count} items}}';

/**
 * Create the registry used by most tests: an app with two locales, one of which lacks a message,
 * and a UI library with an English file only.
 * @returns {import('./markers.js').L10nDebugRegistry} Registry.
 */
const createRegistry = () =>
  createL10nDebugRegistry({
    sources: [
      {
        name: 'App',
        repository: 'example/app',
        path: 'locales/{locale}.yaml',
        color: 'orange',
        messages: {
          'en-US': { hello: 'Hello', nested: { count: COUNT_MESSAGE }, only_en: 'Only English' },
          es: { hello: 'Hola', nested: { count: COUNT_MESSAGE } },
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

describe('Test createL10nDebugRegistry()', () => {
  test('collects the sorted locales and keys, and the keys each locale lacks', () => {
    const registry = createRegistry();

    expect(registry.locales).toEqual(['en-US', 'es']);
    expect(registry.missingColor).toBe('#e00');
    expect(registry.foreignColor).toBe('#8b5cf6');
    expect(registry.sources[0]).toEqual({
      name: 'App',
      repository: 'example/app',
      path: 'locales/{locale}.yaml',
      color: 'orange',
      keys: ['hello', 'nested.count', 'only_en'],
      absentKeys: { 'en-US': [], es: [2] },
    });
    expect(registry.sources[1].keys).toEqual(['close']);
    expect(registry.sources[1].absentKeys).toEqual({ 'en-US': [] });
  });

  test('accepts custom colors', () => {
    const registry = createL10nDebugRegistry({
      sources: [],
      missingColor: 'red',
      foreignColor: 'violet',
    });

    expect(registry).toEqual({
      sources: [],
      locales: [],
      missingColor: 'red',
      foreignColor: 'violet',
    });
  });

  test('ignores values that are neither strings nor objects', () => {
    const registry = createL10nDebugRegistry({
      sources: [
        {
          name: 'App',
          path: '{locale}.yaml',
          color: 'orange',
          messages: { en: { list: ['a', 'b'], number: 1, empty: null, text: 'Text' } },
        },
      ],
    });

    expect(registry.sources[0].keys).toEqual(['text']);
  });

  test('throws when a marker can’t refer to every package', () => {
    const sources = Array.from({ length: 96 }, (_, index) => ({
      name: `App ${index}`,
      path: '{locale}.yaml',
      color: 'orange',
      messages: {},
    }));

    expect(() => createL10nDebugRegistry({ sources })).toThrow(RangeError);
  });
});

describe('Test encodeMarker() and decodeMarkers()', () => {
  test('round-trip the indexes, including the largest ones', () => {
    const keys = Array.from({ length: 9025 }, (_, index) => `key${String(index).padStart(4, '0')}`);

    const registry = createL10nDebugRegistry({
      sources: [
        { name: 'App', path: '{locale}.yaml', color: 'orange', messages: { en: {} } },
        {
          name: 'Big',
          path: '{locale}.yaml',
          color: 'pink',
          messages: { en: Object.fromEntries(keys.map((key) => [key, key])) },
        },
      ],
    });

    const marker = encodeMarker([1, 0, 9024]);

    expect(marker.startsWith(MARKER_START)).toBe(true);
    expect([...marker]).toHaveLength(6);
    expect(decodeMarkers(`${marker}Text`, registry)).toEqual([
      { sourceIndex: 1, source: registry.sources[1], locale: 'en', keyIndex: 9024, key: 'key9024' },
    ]);
  });

  test('find every marker in a string, in order', () => {
    const registry = createRegistry();
    const text = `${encodeMarker([0, 1, 0])}Hola, ${encodeMarker([1, 0, 0])}Close`;

    expect(decodeMarkers(text, registry).map(({ key, locale }) => `${key}@${locale}`)).toEqual([
      'hello@es',
      'close@en-US',
    ]);
  });

  test('skip markers the registry can’t resolve', () => {
    const registry = createRegistry();

    expect(decodeMarkers(`${encodeMarker([5, 0, 0])}Text`, registry)).toEqual([]);
    expect(decodeMarkers(`${encodeMarker([0, 9, 0])}Text`, registry)).toEqual([]);
    expect(decodeMarkers(`${encodeMarker([0, 0, 99])}Text`, registry)).toEqual([]);
  });

  test('return nothing for a string without markers', () => {
    expect(decodeMarkers('Hello', createRegistry())).toEqual([]);
    expect(decodeMarkers(`${MARKER_START}incomplete`, createRegistry())).toEqual([]);
  });
});

describe('Test markMessage()', () => {
  const marker = encodeMarker([0, 0, 0]);

  test('adds the marker to the start of a simple message', () => {
    expect(markMessage('Hello {$name}', marker)).toBe(`${marker}Hello {$name}`);
  });

  test('adds the marker to the start of each variant of a complex message', () => {
    expect(markMessage(COUNT_MESSAGE, marker)).toBe(
      `.input {$count :integer} .match $count one {{${marker}One item}} *` +
        ` {{${marker}{$count} items}}`,
    );
  });

  test('adds the marker to a quoted pattern', () => {
    expect(markMessage('{{Hello}}', marker)).toBe(`{{${marker}Hello}}`);
  });

  test('leaves escaped braces alone', () => {
    expect(markMessage('Use `\\{\\{slug\\}\\}` here', marker)).toBe(
      `${marker}Use \`\\{\\{slug\\}\\}\` here`,
    );
  });
});

describe('Test markMessages()', () => {
  test('marks every message the registry knows, keeping the structure', () => {
    const registry = createRegistry();

    const marked = markMessages(
      { hello: 'Hola', nested: { count: COUNT_MESSAGE }, extra: 'New', list: ['a'], number: 1 },
      { registry, source: 'App', locale: 'es' },
    );

    expect(marked.hello).toBe(`${encodeMarker([0, 1, 0])}Hola`);
    expect(stripMarkers(marked.nested.count)).toBe(COUNT_MESSAGE);
    expect(decodeMarkers(marked.nested.count, registry)[0].key).toBe('nested.count');
    expect(marked.extra).toBe('New');
    expect(marked.list).toEqual(['a']);
    expect(marked.number).toBe(1);
  });

  test('throws for an unknown package or locale', () => {
    const registry = createRegistry();

    expect(() => markMessages({}, { registry, source: 'Other', locale: 'es' })).toThrow();
    expect(() => markMessages({}, { registry, source: 'App', locale: 'fr' })).toThrow();
  });
});

describe('Test hasMessage()', () => {
  test('checks the locale file of a package', () => {
    const [app, ui] = createRegistry().sources;

    expect(hasMessage(app, 'es', 0)).toBe(true);
    expect(hasMessage(app, 'es', 2)).toBe(false);
    expect(hasMessage(ui, 'es', 0)).toBe(false);
  });
});

describe('Test stripMarkers()', () => {
  test('removes every marker', () => {
    expect(stripMarkers(`${encodeMarker([0, 0, 0])}A ${encodeMarker([1, 2, 3])}B`)).toBe('A B');
    expect(stripMarkers('Plain')).toBe('Plain');
  });
});
