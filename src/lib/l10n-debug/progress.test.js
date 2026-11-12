import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createL10nDebugRegistry } from './markers.js';
import { createChecklistByTopLevelKey, createProgress, getItemProgress } from './progress.js';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Test createProgress()', () => {
  test('records the messages shown, per package', () => {
    const progress = createProgress('test');

    expect(progress.add('App', 'hello')).toBe(true);
    expect(progress.add('App', 'hello')).toBe(false);
    expect(progress.add('UI', 'hello')).toBe(true);
    expect(progress.has('App', 'hello')).toBe(true);
    expect(progress.has('App', 'other')).toBe(false);
    expect(progress.count('App')).toBe(1);
    expect(progress.count('UI')).toBe(1);
    expect(progress.count('Other')).toBe(0);
  });

  test('doesn’t confuse a package whose name starts with another’s', () => {
    const progress = createProgress('test');

    progress.add('App', 'hello');
    progress.add('App Extra', 'hello');

    expect(progress.count('App')).toBe(1);
  });

  test('saves and loads the messages shown', () => {
    const progress = createProgress('test');

    progress.add('App', 'hello');
    expect(createProgress('test').has('App', 'hello')).toBe(false);
    progress.save();
    expect(createProgress('test').has('App', 'hello')).toBe(true);
    expect(createProgress('other').has('App', 'hello')).toBe(false);
  });

  test('saves the checked items right away', () => {
    const progress = createProgress('test');

    progress.setChecked('item', true);
    expect(progress.isChecked('item')).toBe(true);
    expect(createProgress('test').isChecked('item')).toBe(true);
    progress.setChecked('item', false);
    expect(createProgress('test').isChecked('item')).toBe(false);
  });

  test('forgets everything on reset', () => {
    const progress = createProgress('test');

    progress.add('App', 'hello');
    progress.setChecked('item', true);
    progress.save();
    progress.reset();

    expect(progress.has('App', 'hello')).toBe(false);
    expect(progress.isChecked('item')).toBe(false);
    expect(createProgress('test').has('App', 'hello')).toBe(false);
    expect(createProgress('test').isChecked('item')).toBe(false);
  });

  test('ignores invalid saved data', () => {
    localStorage.setItem('test:seen', '{invalid');

    expect(createProgress('test').count('App')).toBe(0);
  });

  test('works when the storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Blocked');
    });

    const progress = createProgress('test');

    expect(() => {
      progress.add('App', 'hello');
      progress.save();
      progress.setChecked('item', true);
    }).not.toThrow();
    expect(progress.has('App', 'hello')).toBe(true);
  });
});

describe('Test getItemProgress()', () => {
  const item = { id: 'a', label: 'A', source: 'App', keys: ['one', 'two'] };

  test('counts the messages shown', () => {
    const progress = createProgress('test');

    expect(getItemProgress(item, progress)).toEqual({
      seen: 0,
      total: 2,
      unseen: ['one', 'two'],
      done: false,
    });

    progress.add('App', 'one');
    expect(getItemProgress(item, progress)).toMatchObject({ seen: 1, unseen: ['two'] });

    progress.add('App', 'two');
    expect(getItemProgress(item, progress)).toMatchObject({ seen: 2, unseen: [], done: true });
  });

  test('is done once checked off by hand', () => {
    const progress = createProgress('test');

    progress.setChecked('a', true);
    expect(getItemProgress(item, progress)).toMatchObject({ seen: 0, done: true });
  });
});

describe('Test createChecklistByTopLevelKey()', () => {
  test('creates an item per top-level key', () => {
    const registry = createL10nDebugRegistry({
      sources: [
        {
          name: 'UI',
          path: '{locale}.yaml',
          color: 'pink',
          messages: {
            en: { ok: 'OK', cancel: 'Cancel', calendar: { year: 'Year', month: 'Month' } },
          },
        },
      ],
    });

    expect(createChecklistByTopLevelKey(registry, 'UI')).toEqual([
      {
        id: 'UI:calendar',
        label: 'calendar',
        source: 'UI',
        keys: ['calendar.month', 'calendar.year'],
        group: 'UI',
      },
      { id: 'UI:Common', label: 'Common', source: 'UI', keys: ['cancel', 'ok'], group: 'UI' },
    ]);
  });

  test('returns nothing for an unknown package', () => {
    const registry = createL10nDebugRegistry({ sources: [] });

    expect(createChecklistByTopLevelKey(registry, 'UI')).toEqual([]);
  });
});
