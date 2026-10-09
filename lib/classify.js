// Keyword-based classification. Deterministic and transparent: it only labels
// what the headline/summary/feed categories literally say.
const RULES = {
  campaign: /\b(campaign|ad film|commercial|spot|ooh|billboard|launches? (?:a |its |new )?(?:ad|film|campaign)|unveils|teams? up|collab(?:oration)?|film|jingle|tvc|print ad|creative|agency|ad of the)\b/i,
  activation: /\b(activation|experiential|pop-?up|stunt|installation|in-store|event|immersive|takeover|sampling|roadshow|fan zone|booth)\b/i,
  casestudy: /\b(case study|how .{3,40} (?:grew|won|built|turned)|lessons?|behind the (?:scenes|campaign)|results|effectiveness|cannes lions|effie|what worked|works? because|grand prix|lions|award)\b/i,
  digital: /\b(social media|instagram|tiktok|youtube|linkedin|influencer|creator|seo|search|google|meta|performance marketing|ecommerce|e-commerce|retail media|programmatic|ctv|streaming|whatsapp|shorts|reels)\b/i,
  ai: /\b(ai|artificial intelligence|genai|generative|chatgpt|llm|martech|automation|personalisation|personalization|data|cdp|analytics|measurement)\b/i,
  trend: /\b(trend|report|survey|study|forecast|predictions?|gen z|millennial|consumer|shift|rise of|future of|outlook|index)\b/i,
  launch: /\b(launch(?:es|ed)?|debuts?|introduces?|rebrand|new logo|unveil|appoints?|partners?|acquires?|ropes in|brand ambassador)\b/i,
};

export const CATEGORY_LABELS = {
  campaign: 'Campaigns',
  activation: 'Brand activations',
  casestudy: 'Case studies',
  digital: 'Digital & social',
  ai: 'AI & martech',
  trend: 'Trends & insights',
  launch: 'Launches & rebrands',
};

export function classify({ title, summary = '', categories = [] }, source) {
  const hay = `${title} ${categories.join(' ')}`;
  const hayWide = `${hay} ${summary.slice(0, 300)}`;
  const tags = [];
  for (const [k, re] of Object.entries(RULES)) {
    if (re.test(k === 'campaign' || k === 'launch' ? hay : hayWide)) tags.push(k);
  }
  if (source.defaultKind === 'campaign' && !tags.includes('campaign')) tags.unshift('campaign');
  let kind = source.defaultKind || 'news';
  if (tags.includes('casestudy')) kind = 'casestudy';
  else if (kind === 'news' && (tags.includes('campaign') || tags.includes('activation'))) kind = 'campaign';
  return { kind, tags: [...new Set(tags)] };
}

// India relevance for global-labelled sources: mention in headline/summary.
const INDIA = /\b(india|indian|mumbai|delhi|bengaluru|bangalore|chennai|hyderabad|kolkata|ipl|bollywood|diwali|rupee|tata|reliance|amul|zomato|swiggy|cred|flipkart|myntra|nykaa|paytm|ola|hindustan unilever|hul|mahindra|dabur|parle)\b/i;
export function detectRegion({ title, summary = '' }, source) {
  if (source.region === 'india') return 'india';
  return INDIA.test(`${title} ${summary.slice(0, 200)}`) ? 'india' : 'global';
}
