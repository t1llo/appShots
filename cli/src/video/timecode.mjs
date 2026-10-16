/**
 * The frame nearest a time, counted from the first frame at 0.
 * @param {number} seconds
 * @param {number} [fps]
 */
export const frameAt = (seconds, fps = 30) => Math.max(0, Math.round(seconds * fps));

/**
 * A time in a preview as App Store Connect's previewFrameTimeCode takes it: hours, minutes, seconds and the frame
 * within that second. The frame is the one nearest the time, so at 30 frames a second 5.5 s is 00:00:05:15.
 * @param {number} seconds
 * @param {number} [fps]
 */
export function timecode(seconds, fps = 30) {
  const frames = frameAt(seconds, fps);
  const whole = Math.floor(frames / fps);
  const two = (/** @type {number} */ value) => String(value).padStart(2, "0");
  return `${two(Math.floor(whole / 3600))}:${two(Math.floor(whole / 60) % 60)}:${two(whole % 60)}:${two(frames % fps)}`;
}

/**
 * The time a timecode stands for, at the start of its frame. Null for anything that is not HH:MM:SS:FF with a
 * frame inside the second.
 * @param {string} code
 * @param {number} [fps]
 */
export function timecodeSeconds(code, fps = 30) {
  const parts = /^(\d{2}):([0-5]\d):([0-5]\d):(\d{2})$/.exec(code);
  if (!parts) return null;
  const [hours, minutes, seconds, frame] = parts.slice(1).map(Number);
  if (frame >= fps) return null;
  return hours * 3600 + minutes * 60 + seconds + frame / fps;
}
