import type { Locale } from '@prisma/client';
import { unstable_cache } from 'next/cache';
import type { CategoryNodeDTO } from '@/features/catalog/dto';
import { db } from '@/lib/db';
import { pickTranslation } from '@/lib/i18n/pick-translation';

async function loadCategoryTree(locale: Locale): Promise<CategoryNodeDTO[]> {
  const rows = await db.category.findMany({
    where: { isActive: true },
    orderBy: [{ depth: 'asc' }, { position: 'asc' }],
    include: { translations: true },
  });

  const nodes = new Map<string, CategoryNodeDTO>();
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      slug: row.slug,
      path: row.path,
      name: pickTranslation(row.translations, locale)?.name ?? row.slug,
      iconName: row.iconName,
      children: [],
    });
  }

  const roots: CategoryNodeDTO[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id);
    if (!node) continue;
    const parent = row.parentId ? nodes.get(row.parentId) : undefined;
    if (parent) parent.children.push(node);
    else if (!row.parentId) roots.push(node);
  }
  return roots;
}

/** 04 §3: cached with tag `catalog`; admin mutations invalidate the tag in Phase 5. */
export async function getCategoryTree(locale: Locale): Promise<CategoryNodeDTO[]> {
  return unstable_cache(() => loadCategoryTree(locale), ['category-tree', locale], {
    tags: ['catalog'],
    revalidate: 3600,
  })();
}
