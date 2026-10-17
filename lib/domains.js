// The three news sections. Colours here are only the defaults the page falls back to; the CSS owns the theme.
export const DOMAINS = {
  marketing: {
    id: 'marketing', label: 'Marketing', blurb: 'New campaigns and marketing news', color: '#E8475F',
    persona: 'an Indian marketing professional',
    guidance: 'Angle: what the brand or agency did and what a marketer can learn from it.',
    subtabs: [
      { id: 'all', label: 'All' },
      { id: 'campaigns', label: 'Campaigns', tag: 'Campaign', filter: { kind: 'campaign' } },
      { id: 'news', label: 'News', tag: 'News', filter: { kind: 'news' } },
      { id: 'cases', label: 'Case studies', tag: 'Case study', filter: { kind: 'casestudy' } },
    ],
  },
  product: {
    id: 'product', label: 'Product', blurb: 'Product launches, new features and ideas for product managers', color: '#6D5BF6',
    persona: 'a product manager',
    guidance: 'Angle: what shipped or changed, which user problem it addresses, and what product managers can learn from it (scope, positioning, rollout).',
    subtabs: [
      { id: 'all', label: 'All' },
      { id: 'launches', label: 'Launches', tag: 'Launch', filter: { tag: 'launch' } },
      { id: 'features', label: 'Features', tag: 'Feature', filter: { tag: 'feature' } },
      { id: 'pm', label: 'For PMs', tag: 'For PMs', filter: { tag: 'pm' } },
    ],
  },
  finance: {
    id: 'finance', label: 'Finance', blurb: 'Markets, funding, the economy and fintech', color: '#0E9F8E',
    persona: 'a finance professional',
    guidance: 'Angle: what happened and why it matters. NEVER give investment advice, price targets, predictions, or buy/sell/hold views, and never imply the author recommends any security. Stick to what the source reports.',
    subtabs: [
      { id: 'all', label: 'All' },
      { id: 'markets', label: 'Markets', tag: 'Markets', filter: { tag: 'markets' } },
      { id: 'funding', label: 'Funding', tag: 'Funding', filter: { tag: 'funding' } },
      { id: 'economy', label: 'Economy', tag: 'Economy', filter: { tag: 'economy' } },
      { id: 'fintech', label: 'Fintech', tag: 'Fintech', filter: { tag: 'fintech' } },
    ],
  },
  others: {
    id: 'others', label: 'Others', blurb: 'Everything else in the news: India, the world, science, sport and culture', color: '#B45309',
    persona: 'a thoughtful professional sharing a view on the news',
    guidance: 'Angle: what happened and why it matters to people beyond the headline. Keep it balanced and respectful: do not take sides on political, religious or other divisive issues, do not speculate about individuals, and do not present anything beyond the source as fact.',
    subtabs: [
      { id: 'all', label: 'All' },
      { id: 'tech', label: 'Science & tech', tag: 'Science & tech', filter: { tag: 'tech' } },
      { id: 'sport', label: 'Sport', tag: 'Sport', filter: { tag: 'sport' } },
      { id: 'entertainment', label: 'Entertainment', tag: 'Entertainment', filter: { tag: 'entertainment' } },
      { id: 'health', label: 'Health', tag: 'Health', filter: { tag: 'health' } },
    ],
  },
};

export const DOMAIN_IDS = Object.keys(DOMAINS);
export const domainOf = (id) => DOMAINS[id] || DOMAINS.marketing;
export const publicDomains = () => DOMAIN_IDS.map((id) => {
  const { persona, guidance, ...pub } = DOMAINS[id];
  return pub;
});
