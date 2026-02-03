export function streamText(text: string, onDelta: (chunk: string) => void): void {
  const chunkSize = 24;
  for (let i = 0; i < text.length; i += chunkSize) {
    onDelta(text.slice(i, i + chunkSize));
  }
}
