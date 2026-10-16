// Reads a stream of Server-Sent Events as GET /api/events sends it, the way a test wants it: the next event of a kind,
// waited for with a deadline, and whether the server has ended the stream.

export interface StreamEvent {
  type: string;
  data: any;
}

export interface EventStream {
  response: Response;
  /** The next event not taken yet, of `type` when given: the ones before it are skipped. Rejects after `ms`. */
  next(type?: string, ms?: number): Promise<StreamEvent>;
  /** Every event received so far, taken or not. */
  received: StreamEvent[];
  /** Everything received so far as text, comments included. */
  text(): string;
  /** Settles once the server has ended the stream, or it was closed here. */
  ended: Promise<void>;
  isEnded(): boolean;
  close(): void;
}

/** Opens a stream with fetch. The response is returned as it is when it is not a stream, such as a 401. */
export async function openEvents(url: string, init: RequestInit = {}): Promise<EventStream> {
  const controller = new AbortController();
  const response = await fetch(url, { ...init, signal: controller.signal });
  const received: StreamEvent[] = [];
  let taken = 0;
  let text = "";
  let done = false;
  let wake = () => {};

  const read = async () => {
    if (!response.body) return;
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of response.body) {
        const part = decoder.decode(chunk, { stream: true });
        text += part;
        buffer += part;
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          let type = "message";
          const data: string[] = [];
          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) type = line.slice(7);
            else if (line.startsWith("data: ")) data.push(line.slice(6));
          }
          if (data.length) received.push({ type, data: JSON.parse(data.join("\n")) });
        }
        wake();
      }
    } catch {
      // Aborted here, or cut off: either way the stream has ended.
    } finally {
      done = true;
      wake();
    }
  };
  const ended = read();

  return {
    response,
    received,
    text: () => text,
    ended,
    isEnded: () => done,
    close: () => controller.abort(),
    async next(type, ms = 5000) {
      const deadline = Date.now() + ms;
      for (;;) {
        while (taken < received.length) {
          const event = received[taken++]!;
          if (!type || event.type === type) return event;
        }
        if (done) throw new Error(`The stream ended before ${type ? `a ${type} event` : "another event"} came`);
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`No ${type ? `${type} event` : "event"} came within ${ms} ms`);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, left);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
    },
  };
}

/** Resolves true when `promise` settles within `ms`, false otherwise. */
export async function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const settled = await Promise.race([promise.then(() => true, () => true), new Promise<boolean>((resolve) => (timer = setTimeout(resolve, ms, false)))]);
  clearTimeout(timer);
  return settled;
}
