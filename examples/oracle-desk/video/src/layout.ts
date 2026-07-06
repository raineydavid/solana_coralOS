import type { Beat } from './types';

export const FPS = 30;
export const TITLE_FRAMES = 90; // 3s

/** How long a beat holds on screen — more content, more time; the closing line holds longest. */
export function beatDuration(beat: Beat): number {
  let frames = 78; // ~2.6s base
  if (Array.isArray(beat.wire)) frames += beat.wire.length * 18;
  if (beat.result) frames += 40;
  if (beat.detail) frames += 12;
  if (beat.verdict) frames += 20;
  if (beat.released) frames += beat.released.length * 20 + 20;
  if (beat.closing) frames += 45;
  return frames;
}

export function totalDuration(beats: Beat[]): number {
  return TITLE_FRAMES + beats.reduce((sum, b) => sum + beatDuration(b), 0) + FPS; // +1s tail hold
}

/** Cumulative start frame for each beat, title scene first. */
export function beatStarts(beats: Beat[]): number[] {
  let cursor = TITLE_FRAMES;
  return beats.map((b) => {
    const start = cursor;
    cursor += beatDuration(b);
    return start;
  });
}
