'use strict';

// Topics merged for the shortcut categories when no specific topic is given.
const DEFAULT_TOPICS = [
  'technology',
  'programming',
  'artificial-intelligence',
  'data-science',
  'software-development',
  'startup',
];

function slugifyTopic(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function withinDays(days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return (item) => Date.parse(item.publishedAt) >= cutoff;
}

const byClaps = (a, b) => (b.claps || 0) - (a.claps || 0);
const byDate = (a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0);

// Decide what to fetch (which Medium topics, which feed mode) and how to order
// the result, based on the user's category.
function planTopQuery(category) {
  const raw = String(category || '').trim();
  const cat = raw.toLowerCase();

  switch (cat) {
    case '':
    case 'latest':
    case 'new':
    case 'recent':
      return { label: 'latest', topics: DEFAULT_TOPICS, mode: 'NEW', sort: byDate };
    case 'trending':
    case 'top':
      return { label: 'trending', topics: DEFAULT_TOPICS, mode: 'TOP_WEEK', sort: byClaps };
    case 'week':
    case 'this-week':
    case 'thisweek':
      return {
        label: 'this week',
        topics: DEFAULT_TOPICS,
        mode: 'TOP_WEEK',
        filter: withinDays(7),
        sort: byClaps,
      };
    case 'long':
    case 'long-reads':
    case 'longreads':
      return {
        label: 'long reads',
        topics: DEFAULT_TOPICS,
        mode: 'TOP_MONTH',
        filter: (i) => (i.readingTime || 0) >= 7,
        sort: (a, b) => (b.readingTime || 0) - (a.readingTime || 0),
      };
    case 'all':
      return { label: 'all time', topics: DEFAULT_TOPICS, mode: 'TOP_ALL_TIME', sort: byClaps };
    default: {
      const topic = slugifyTopic(raw) || cat;
      return { label: raw, topics: [topic], mode: 'TOP_WEEK', sort: byClaps };
    }
  }
}

function applyTopPlan(items, plan) {
  let out = Array.isArray(items) ? items : [];
  if (plan && plan.filter) out = out.filter(plan.filter);
  if (plan && plan.sort) out = [...out].sort(plan.sort);
  return out;
}

function formatClaps(n) {
  if (!n) return '';
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
}

function topItemLabel(item) {
  const meta = [
    item.creator,
    item.readingTime ? `${item.readingTime} min` : '',
    item.claps ? `${formatClaps(item.claps)} claps` : '',
  ]
    .filter(Boolean)
    .join('  ·  ');
  return meta ? `${item.title}  ·  ${meta}` : item.title;
}

module.exports = { planTopQuery, applyTopPlan, topItemLabel, slugifyTopic, DEFAULT_TOPICS };
