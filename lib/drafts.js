// Fallback drafts used when no ANTHROPIC_API_KEY is configured.
// These are scaffolds: they contain ONLY facts present in the source record
// (headline, publisher, date) and leave [bracketed] slots for the author's own view.
// Nothing about the campaign's strategy or results is asserted.

const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

export function scaffoldDrafts(item) {
  const when = fmtDate(item.publishedAt);
  const src = `${item.source}${when ? `, ${when}` : ''}`;
  return [
    {
      angle: 'The one thing I noticed',
      generated: false,
      text: `${item.title}\n\nI came across this via ${src} and one detail stuck with me:\n\n[the single most interesting choice in the work: the insight, the format, the media, the tone]\n\nMost brands in [category] would have [the obvious route]. This one didn't.\n\nWhat I'd steal from it: [one lesson you could actually use in your own work].\n\nCurious how others read it: [a genuine question].\n\nSource: ${item.url}`,
    },
    {
      angle: 'What it teaches',
      generated: false,
      text: `Reading about this today (${src}):\n\n"${item.title}"\n\nThree things I'm taking from it:\n\n1. [observation about the audience or the insight]\n2. [observation about the execution or channel]\n3. [what it means for brands/teams like the ones you work with]\n\nIf you're working on [your area], it's worth a look.\n\nSource: ${item.url}`,
    },
    {
      angle: 'Respectful disagreement',
      generated: false,
      text: `Everyone's talking about this one: ${item.title}\n\nMy honest take, after reading the coverage in ${item.source}:\n\n[what works]\n[what I'm not convinced by, and why]\n\nI'd love to see [the number or result that would settle it].\n\nSource: ${item.url}`,
    },
  ];
}
