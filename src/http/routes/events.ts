import express, { type Router } from "express";
import { type EventBus, events, type SpaceEvent } from "../../services/events.ts";
import { spaceOf, stillSignedIn } from "../auth.ts";

/** How often a comment goes down a quiet stream, so that a proxy in between does not take it for dead and close it. */
export const HEARTBEAT_MS = 20_000;
/** Streams one account may hold open at once: one for each tab of the Studio, and some to spare. */
export const MAX_STREAMS = 10;
/** How long a browser waits before it opens a stream again that was cut off. */
const RETRY_MS = 5000;
/** What may wait to go out to a client that does not read. Past it the stream ends, and the client asks for everything again. */
const MAX_BUFFERED = 1024 * 1024;

const frame = (name: string, data: object) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

/** An event as a stream sends it: its type as the event's name, the rest as JSON on one line. */
export const eventFrame = ({ type, ...data }: SpaceEvent) => frame(type, data);

export interface EventRouteOptions {
  heartbeatMs?: number;
  maxStreams?: number;
  bus?: EventBus;
}

/**
 * GET /api/events: what changes in the account, as Server-Sent Events, for as long as the connection stays open. The
 * stream ends when the sign-in it was opened with ends, and when the server stops. A client then opens it again and
 * asks for what it shows once more, since it may have missed something meanwhile.
 */
export function eventRoutes(options: EventRouteOptions = {}): Router {
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const maxStreams = options.maxStreams ?? MAX_STREAMS;
  const bus = options.bus ?? events;
  const api = express.Router();

  api.get("/events", (req, res) => {
    const space = spaceOf(res);
    if (bus.followers(space.id) >= maxStreams) {
      res.status(429).set({ "Retry-After": "60", "Cache-Control": "no-store" });
      return void res.json({ error: `This account has ${maxStreams} event streams open already. Close a tab of the Studio, or try again in a minute.` });
    }
    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform keeps a proxy from compressing the stream, which would hold events back until a block is full.
      "Cache-Control": "private, no-store, no-transform",
      // nginx, and the proxies that follow it, pass each event on at once instead of collecting the answer first.
      "X-Accel-Buffering": "no",
    });
    if (req.method === "HEAD") return void res.end();
    res.flushHeaders();
    // Events are small and few: each goes out as it is written rather than wait for more to fill a packet.
    req.socket.setNoDelay(true);

    const signedIn = stillSignedIn(req, res);
    let open = true;
    const end = () => {
      if (!open) return;
      open = false;
      clearInterval(heartbeat);
      unfollow();
      res.end();
    };
    const write = (text: string) => {
      if (!open) return;
      if (res.writableLength > MAX_BUFFERED) return end();
      res.write(text);
    };
    const check = () => {
      if (!signedIn()) end();
    };
    const heartbeat = setInterval(() => {
      check();
      write(": heartbeat\n\n");
    }, heartbeatMs);
    heartbeat.unref();
    const unfollow = bus.follow(space.id, {
      send(event) {
        check();
        write(eventFrame(event));
      },
      recheck: check,
      end,
    });
    res.on("close", end);
    // Gone before it was followed: no close would come to end it.
    if (res.destroyed || req.socket.destroyed) return end();
    // `ready` says that the stream works from end to end. A client that does not get it, such as one behind a proxy
    // that holds the answer back, goes on asking on its own.
    write(`retry: ${RETRY_MS}\n\n${frame("ready", { heartbeatMs })}`);
  });

  return api;
}
