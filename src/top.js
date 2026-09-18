'use strict';

// Category + keyword filtering for `freedium top`.

function topCategoryLabel(category) {
  const cat = String(category || 'latest').toLowerCase();
  if (cat === 'week' || cat === 'this-week' || cat === 'thisweek') return 'this week';
  if (cat === 'long' || cat === 'long-reads' || cat === 'longreads') return 'long reads';
  return cat;
}

function filterTopItems(items, category) {
  const cat = String(category || 'latest').trim().toLowerCase();

  if (cat === 'trending' || cat === 'all') return items;

  if (cat === 'week' || cat === 'this-week' || cat === 'thisweek') {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return items.filter((i) => Date.parse(i.publishedAt) >= cutoff);
  }

  if (cat === 'long' || cat === 'long-reads' || cat === 'longreads') {
    return items.filter((i) => i.readingTime >= 7).sort((a, b) => b.readingTime - a.readingTime);
  }

  if (['', 'latest', 'new', 'recent'].includes(cat)) {
    return [...items].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  }

  // Anything else is treated as a keyword/topic filter, e.g. "top ai". Match on
  // whole words so "ai" does not match "against".
  const words = cat.split(/[\s,]+/).filter(Boolean);
  return items.filter((i) => {
    const hay = [i.title, i.excerpt, i.creator, i.collection].filter(Boolean).join(' ').toLowerCase();
    return words.every((w) => {
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(hay);
    });
  });
}

function topItemLabel(item) {
  const meta = [item.creator, item.readingTime ? item.readingTime + ' min' : ''].filter(Boolean).join('  ·  ');
  return meta ? `${item.title}  ·  ${meta}` : item.title;
}

module.exports = { filterTopItems, topCategoryLabel, topItemLabel };
