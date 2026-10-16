import type { Space } from "../../storage/paths.ts";
import { LOOK_TOPICS } from "./look.ts";
import { PLATFORMS_TOPICS } from "./platforms.ts";
import { SLIDES_TOPICS } from "./slides.ts";
import { START_TOPICS } from "./start.ts";
import type { Topic } from "./topic.ts";
import { WIDE_TOPICS } from "./wide.ts";

export { renderBudget, uploadHelp } from "./start.ts";

/** The sections of the guide in the order it is read. */
export const TOPICS: Topic[] = [...START_TOPICS, ...PLATFORMS_TOPICS, ...SLIDES_TOPICS, ...LOOK_TOPICS, ...WIDE_TOPICS];

export const TOPIC_IDS = TOPICS.map((topic) => topic.id) as [string, ...string[]];

const section = (topic: Topic, base: string, space: Space) => `## ${topic.title}\n${topic.body(base, space)}`;

/**
 * The design guide for this server and account: all of it, as get_design_guide has always answered, or one topic
 * of it, for an agent that knows what it is looking for. A topic the guide does not have gets all of it, as it did
 * before topics existed, with the names of the topics first.
 */
export function designGuide(base: string, space: Space, topic?: string): string {
  const one = topic === undefined ? undefined : TOPICS.find((each) => each.id === topic);
  if (one) {
    const others = TOPICS.filter((each) => each !== one).map((each) => each.id);
    return `${section(one, base, space)}\n\nThis is one topic of the design guide. The others: ${others.join(", ")}. get_design_guide without a topic returns all of them.`;
  }
  const unknown = topic === undefined ? "" : `The design guide has no topic ${JSON.stringify(topic)}, so here is all of it. Its topics: ${TOPIC_IDS.join(", ")}.\n\n`;
  return `${unknown}# appShots: App Store screenshot generator\n\n${TOPICS.map((each) => section(each, base, space)).join("\n\n")}`;
}
