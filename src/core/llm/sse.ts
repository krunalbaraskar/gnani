/**
 * Incremental Server-Sent Events parser. Feed it decoded text in whatever pieces the
 * network delivers; it returns the `data` payload of each complete event.
 */
export class SseParser {
  private buffer = '';
  private data: string[] = [];

  push(chunk: string): string[] {
    this.buffer += chunk;
    const events: string[] = [];
    let nl: number;
    while ((nl = this.buffer.search(/\r\n|\r|\n/)) >= 0) {
      const line = this.buffer.slice(0, nl);
      const sepLen = this.buffer.startsWith('\r\n', nl) ? 2 : 1;
      // A lone trailing \r might be the first half of \r\n — wait for more input.
      if (sepLen === 1 && this.buffer[nl] === '\r' && nl === this.buffer.length - 1) break;
      this.buffer = this.buffer.slice(nl + sepLen);
      if (line === '') {
        if (this.data.length) events.push(this.data.join('\n'));
        this.data = [];
      } else if (line.startsWith('data:')) {
        this.data.push(line.slice(line[5] === ' ' ? 6 : 5));
      }
      // Comments (":") and other fields (event, id, retry) are ignored.
    }
    return events;
  }

  /** Returns a final event if the stream ended without a blank line. */
  end(): string[] {
    const rest = this.push('\n\n');
    this.buffer = '';
    return rest;
  }
}
