// Used when no ANTHROPIC_API_KEY is set. Contains only facts from the source record
// (headline, publisher) plus [brackets] for the author's own view. Asserts nothing else.
const wrap = (item, body) => `${body}\n\nSource: ${item.source}`;

export function scaffoldPosts(item) {
  return [
    { angle: 'Story-led', card: null, text: wrap(item, `${item.title}\n\n[Your hook: what made you stop scrolling?]\n\nThe move, in one line:\n[what actually happened]\n\nMost teams would have [the usual route].\n\nThis one [what was different].\n\nEveryone talks about [the headline].\nVery few notice [what it teaches].`) },
    { angle: 'Lesson-led', card: null, text: wrap(item, `[The one lesson, in a sentence]\n\nI came across ${item.source}'s story on this: ${item.title}\n\nWhat stood out:\n[detail 1]\n[detail 2]\n\nIf you work on [your area], steal this:\n[the takeaway]`) },
    { angle: 'Question-led', card: null, text: wrap(item, `[A sharp question about this move?]\n\n${item.title}\n\nMy honest read:\n[what works]\n[what I'm not sure about]\n\nI'd love to know [the result that would settle it].\n\nWhat do you think?`) },
  ];
}
