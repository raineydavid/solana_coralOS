import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { theme } from '../theme';

export const TitleCard: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  const y = interpolate(frame, [0, 20], [14, 0], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 120px', textAlign: 'center', opacity, transform: `translateY(${y}px)` }}>
      <div style={{ fontFamily: theme.mono, fontSize: 18, letterSpacing: 4, textTransform: 'uppercase', color: theme.accent, marginBottom: 18 }}>
        Solana × CoralOS · STUK
      </div>
      <div style={{ fontFamily: theme.sans, fontSize: 56, fontWeight: 700, color: theme.ink, letterSpacing: -1, lineHeight: 1.08, marginBottom: 20 }}>
        {title}
      </div>
      <div style={{ fontFamily: theme.sans, fontSize: 26, color: theme.inkSoft, maxWidth: 900, lineHeight: 1.4 }}>
        {subtitle}
      </div>
    </div>
  );
};
