// Used when no ANTHROPIC_API_KEY is set. Contains only facts from the source record
// (headline, publisher) plus [brackets] for the author's own view. Asserts nothing else.
export function scaffoldPost(item) {
  return `${item.title}

[Your hook: what made you stop scrolling?]

The move, in one line:
[what the brand actually did]

Most brands would have [the usual route].

This one [what was different].

And that's the part most people miss:
[the real lesson]

Everyone talks about [the headline].
Very few notice [what it teaches].

[A question for your network]

Source: ${item.source}`;
}
