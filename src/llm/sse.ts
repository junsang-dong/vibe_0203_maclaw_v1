export async function readSseLines(
  response: Response,
  onLine: (line: string) => void
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length > 0) {
        onLine(line);
      }
      index = buffer.indexOf("\n");
    }
  }
  if (buffer.trim().length > 0) {
    onLine(buffer.trim());
  }
}

export function extractSseData(line: string): string | null {
  if (line.startsWith("data:")) {
    return line.slice(5).trim();
  }
  return null;
}
