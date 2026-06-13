/**
 * Hotkey strings look like "Alt+1", "Ctrl+Shift+K", "Alt+Shift+P".
 * Modifier order when formatting: Ctrl, Alt, Shift, Meta.
 */

export type ParsedHotkey = {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string; // normalized to upper-case single key, e.g. "1", "K", "F2"
};

export function parseHotkey(hotkey: string): ParsedHotkey | null {
  const parts = hotkey
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const parsed: ParsedHotkey = { ctrl: false, alt: false, shift: false, meta: false, key: '' };
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') parsed.ctrl = true;
    else if (lower === 'alt' || lower === 'option') parsed.alt = true;
    else if (lower === 'shift') parsed.shift = true;
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command') parsed.meta = true;
    else parsed.key = part.toUpperCase();
  }
  if (!parsed.key) return null;
  return parsed;
}

export function matchHotkey(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
  hotkey: string | undefined,
): boolean {
  if (!hotkey) return false;
  const parsed = parseHotkey(hotkey);
  if (!parsed) return false;
  return (
    e.ctrlKey === parsed.ctrl &&
    e.altKey === parsed.alt &&
    e.shiftKey === parsed.shift &&
    e.metaKey === parsed.meta &&
    e.key.toUpperCase() === parsed.key
  );
}

/**
 * Format a keydown event into a hotkey string for the settings recorder.
 * Returns null for bare modifier presses (still waiting for the real key).
 */
export function formatHotkeyFromEvent(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
): string | null {
  const key = e.key;
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return parts.join('+');
}
