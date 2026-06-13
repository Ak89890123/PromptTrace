import { describe, expect, it } from 'vitest';
import { formatHotkeyFromEvent, matchHotkey, parseHotkey } from '@/src/core/hotkeys';

const ev = (key: string, mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }> = {}) => ({
  key,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false,
  shiftKey: mods.shift ?? false,
  metaKey: mods.meta ?? false,
});

describe('parseHotkey', () => {
  it('parses modifiers and key', () => {
    expect(parseHotkey('Alt+1')).toEqual({ ctrl: false, alt: true, shift: false, meta: false, key: '1' });
    expect(parseHotkey('Ctrl+Shift+K')).toEqual({ ctrl: true, alt: false, shift: true, meta: false, key: 'K' });
  });

  it('rejects empty / modifier-only strings', () => {
    expect(parseHotkey('')).toBeNull();
    expect(parseHotkey('Alt+')).toBeNull();
  });
});

describe('matchHotkey', () => {
  it('matches exact modifier combination', () => {
    expect(matchHotkey(ev('1', { alt: true }), 'Alt+1')).toBe(true);
    expect(matchHotkey(ev('1', { alt: true, ctrl: true }), 'Alt+1')).toBe(false);
    expect(matchHotkey(ev('1'), 'Alt+1')).toBe(false);
    expect(matchHotkey(ev('k', { ctrl: true, shift: true }), 'Ctrl+Shift+K')).toBe(true);
  });

  it('is case-insensitive on the key', () => {
    expect(matchHotkey(ev('a', { alt: true }), 'Alt+A')).toBe(true);
  });

  it('handles undefined hotkey', () => {
    expect(matchHotkey(ev('1', { alt: true }), undefined)).toBe(false);
  });
});

describe('formatHotkeyFromEvent', () => {
  it('formats modifiers in canonical order', () => {
    expect(formatHotkeyFromEvent(ev('k', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+K');
    expect(formatHotkeyFromEvent(ev('2', { alt: true }))).toBe('Alt+2');
  });

  it('returns null for bare modifier presses', () => {
    expect(formatHotkeyFromEvent(ev('Alt', { alt: true }))).toBeNull();
    expect(formatHotkeyFromEvent(ev('Shift', { shift: true }))).toBeNull();
  });

  it('round-trips through matchHotkey', () => {
    const e = ev('p', { alt: true, shift: true });
    const formatted = formatHotkeyFromEvent(e)!;
    expect(matchHotkey(e, formatted)).toBe(true);
  });
});
