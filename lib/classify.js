// Keyword-based classification. Deterministic and transparent: it only labels
// what the headline/summary/feed categories literally say.
const MARKETING = {
  campaign: /\b(campaign|ad film|commercial|spot|ooh|billboard|launches? (?:a |its |new )?(?:ad|film|campaign)|unveils|teams? up|collab(?:oration)?|film|jingle|tvc|print ad|creative|agency|ad of the)\b/i,
  activation: /\b(activation|experiential|pop-?up|stunt|installation|in-store|event|immersive|takeover|sampling|roadshow|fan zone|booth)\b/i,
  casestudy: /\b(case study|how .{3,40} (?:grew|won|built|turned)|lessons?|behind the (?:scenes|campaign)|results|effectiveness|cannes lions|effie|what worked|works? because|grand prix|lions|award)\b/i,
  digital: /\b(social media|instagram|tiktok|youtube|linkedin|influencer|creator|seo|search|google|meta|performance marketing|ecommerce|e-commerce|retail media|programmatic|ctv|streaming|whatsapp|shorts|reels)\b/i,
  ai: /\b(ai|artificial intelligence|genai|generative|chatgpt|llm|martech|automation|personalisation|personalization|data|cdp|analytics|measurement)\b/i,
  trend: /\b(trend|report|survey|study|forecast|predictions?|gen z|millennial|consumer|shift|rise of|future of|outlook|index)\b/i,
  launch: /\b(launch(?:es|ed)?|debuts?|introduces?|rebrand|new logo|unveil|appoints?|partners?|acquires?|ropes in|brand ambassador)\b/i,
};

const PRODUCT = {
  launch: /\b(launch(?:es|ed)?|unveils?|debuts?|introduces?|announces?|releases?|ships?|now available|goes live|rolls? out)\b/i,
  feature: /\b(features?|update[sd]?|upgrade[sd]?|adds?|new tool|integrations?|beta|preview|redesign|version \d|v\d|rolls? out|rolling out)\b/i,
  pm: /\b(product managers?|product management|roadmaps?|product[- ]led|plg|prioriti[sz]\w*|product discovery|north star|retention|activation rate|onboarding|a\/b test\w*|experiment\w*|user research|product strategy)\b/i,
};

const FINANCE = {
  markets: /\b(sensex|nifty|stocks?|shares?|equity|equities|markets?|rally|sell-?off|bse|nse|wall street|dow|nasdaq|bonds?|yields?)\b/i,
  funding: /\b(funding|raises?|raised|series [a-e]|seed round|valuation|venture|vcs?|investors?|acquires?|acquisition|unicorn|ipo)\b/i,
  economy: /\b(rbi|inflation|gdp|interest rates?|repo|budget|tax(?:es)?|gst|fiscal|monetary|economy|economic|trade deficit|rupee|fed)\b/i,
  fintech: /\b(fintech|upi|payments?|lending|neobank|nbfc|credit|wallet|insurtech|wealthtech|bnpl|loans?)\b/i,
};

function match(rules, hay, wide, narrowKeys = []) {
  return Object.entries(rules).filter(([k, re]) => re.test(narrowKeys.includes(k) ? hay : wide)).map(([k]) => k);
}

export function classify({ title, summary = '', categories = [] }, source) {
  const domain = source.domain || 'marketing';
  const hay = `${title} ${categories.join(' ')}`;
  const wide = `${hay} ${summary.slice(0, 300)}`;

  if (domain === 'product') {
    const tags = match(PRODUCT, hay, wide, ['launch']);
    const kind = tags.includes('launch') ? 'launch' : tags.includes('feature') ? 'feature' : 'news';
    return { kind, tags };
  }
  if (domain === 'finance') return { kind: 'news', tags: match(FINANCE, hay, wide, ['markets', 'funding']) };

  const tags = match(MARKETING, hay, wide, ['campaign', 'launch']);
  if (source.defaultKind === 'campaign' && !tags.includes('campaign')) tags.unshift('campaign');
  let kind = source.defaultKind || 'news';
  if (tags.includes('casestudy')) kind = 'casestudy';
  else if (kind === 'news' && (tags.includes('campaign') || tags.includes('activation'))) kind = 'campaign';
  return { kind, tags: [...new Set(tags)] };
}

// India relevance for global-labelled sources: mention in headline/summary.
const INDIA = /\b(india|indian|mumbai|delhi|bengaluru|bangalore|chennai|hyderabad|kolkata|ipl|bollywood|diwali|rupee|tata|reliance|amul|zomato|swiggy|cred|flipkart|myntra|nykaa|paytm|ola|hindustan unilever|hul|mahindra|dabur|parle|sensex|nifty|rbi|sebi|bse|nse|upi|inr|infosys|wipro|hdfc|icici|sbi|adani)\b/i;
export function detectRegion({ title, summary = '' }, source) {
  if (source.region === 'india') return 'india';
  return INDIA.test(`${title} ${summary.slice(0, 200)}`) ? 'india' : 'global';
}
