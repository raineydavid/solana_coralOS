import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { theme } from '../theme';

/** A single market-protocol wire message, styled like the CLI/deck's monospace log lines. */
export const WireLine: React.FC<{ text: string; delay?: number; accent?: boolean }> = ({ text, delay = 0, accent }) => {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const opacity = interpolate(local, [0, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const x = interpolate(local, [0, 12], [-10, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div
      style={{
        fontFamily: theme.mono,
        fontSize: 22,
        color: accent ? theme.accent : theme.inkFaint,
        opacity,
        transform: `translateX(${x}px)`,
        whiteSpace: 'pre',
      }}
    >
      {text}
    </div>
  );
};
