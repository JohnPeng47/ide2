/** ECMAScript line boundaries, with CRLF counted once and UTF-16 offsets retained. */
export function sourceLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 13) {
      if (text.charCodeAt(index + 1) === 10) index++;
      starts.push(index + 1);
    } else if (code === 10 || code === 0x2028 || code === 0x2029) starts.push(index + 1);
  }
  return starts;
}

export function sourceLineCount(text: string): number {
  if (!text.length) return 0;
  const starts = sourceLineStarts(text);
  return starts.length - (starts[starts.length - 1] === text.length ? 1 : 0);
}
