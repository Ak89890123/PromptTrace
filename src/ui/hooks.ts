import { useEffect, useState } from 'react';
import type { RecordCategory } from '../core/domain/entities';
import { categoryRepository } from '../storage/repositories';
import { seedDefaults } from '../storage/seed';

/** Load categories from IndexedDB (extension pages share the DB). */
export function useTaxonomy(refreshKey = 0) {
  const [categories, setCategories] = useState<RecordCategory[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await seedDefaults();
      const cats = await categoryRepository.list();
      if (!cancelled) {
        setCategories(cats.sort((a, b) => a.sortOrder - b.sortOrder));
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { categories, loaded };
}

/** Build a depth-first flattened tree for <select> / tree rendering. */
export function flattenTree(
  categories: RecordCategory[],
  opts: { activeOnly?: boolean } = {},
): { category: RecordCategory; depth: number }[] {
  const out: { category: RecordCategory; depth: number }[] = [];
  const byParent = new Map<string | null, RecordCategory[]>();
  for (const c of categories) {
    if (opts.activeOnly && !c.isActive) continue;
    const key = c.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  }
  const walk = (parentId: string | null, depth: number) => {
    const children = (byParent.get(parentId) ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
    for (const c of children) {
      out.push({ category: c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
