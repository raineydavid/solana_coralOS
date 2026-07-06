import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { theme } from './theme';
import { TitleCard } from './scenes/TitleCard';
import { StageCard } from './components/StageCard';
import { TITLE_FRAMES, beatDuration, beatStarts } from './layout';
import type { RunData } from './types';

/** Renders a run (happy path or dispute path) as a title card followed by one scene per beat. */
export const OracleClip: React.FC<{ data: RunData }> = ({ data }) => {
  const starts = beatStarts(data.beats);
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <Sequence from={0} durationInFrames={TITLE_FRAMES}>
        <TitleCard title={data.title} subtitle={data.subtitle} />
      </Sequence>
      {data.beats.map((beat, i) => (
        <Sequence key={beat.stage} from={starts[i]} durationInFrames={beatDuration(beat)}>
          <StageCard beat={beat} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
