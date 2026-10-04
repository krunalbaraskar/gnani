/**
 * Removes <think>…</think> blocks that reasoning models (DeepSeek-R1, Qwen3 via Ollama)
 * put before their answer, while streaming. Text that might be the start of a tag is
 * held back until the next chunk decides it.
 */
export class ThinkFilter {
  private inside = false;
  private held = '';

  push(chunk: string): string {
    let s = this.held + chunk;
    this.held = '';
    let out = '';
    for (;;) {
      const tag = this.inside ? '</think>' : '<think>';
      const i = s.indexOf(tag);
      if (i >= 0) {
        if (!this.inside) out += s.slice(0, i);
        s = s.slice(i + tag.length);
        this.inside = !this.inside;
        continue;
      }
      // Hold back a suffix that could be a partial tag.
      let keep = 0;
      for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) {
        if (tag.startsWith(s.slice(s.length - k))) {
          keep = k;
          break;
        }
      }
      if (!this.inside) out += s.slice(0, s.length - keep);
      this.held = s.slice(s.length - keep);
      return out;
    }
  }

  end(): string {
    const rest = this.inside ? '' : this.held;
    this.held = '';
    return rest;
  }
}
