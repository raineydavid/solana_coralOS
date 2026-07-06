import React from 'react';
import { useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';
import { theme } from '../theme';
import { WireLine } from './WireLine';
import type { Beat } from '../types';

const Pill: React.FC<{ text: string; tone: 'accent' | 'amber' | 'red' }> = ({ text, tone }) => {
  const color = tone === 'accent' ? theme.accent : tone === 'amber' ? theme.amber : theme.red;
  return (
    <span
      style={{
        fontFamily: theme.mono, fontSize: 20, color, border: `1px solid ${color}`,
        borderRadius: 999, padding: '4px 14px', letterSpacing: 0.5,
      }}
    >
      {text}
    </span>
  );
};

/** One beat of the market lifecycle, rendered full-screen. Entrance fades/slides the whole card in. */
export const StageCard: React.FC<{ beat: Beat }> = ({ beat }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 18 });
  const opacity = interpolate(enter, [0, 1], [0, 1]);
  const y = interpolate(enter, [0, 1], [16, 0]);

  const wireLines = Array.isArray(beat.wire) ? beat.wire : beat.wire ? [beat.wire] : [];
  const recTone = beat.result
    ? beat.result.dishonest
      ? 'red'
      : beat.result.recommendation === 'safe-to-escrow'
        ? 'accent'
        : 'amber'
    : 'accent';

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 100px', opacity, transform: `translateY(${y}px)` }}>
      <div style={{ fontFamily: theme.mono, fontSize: 20, letterSpacing: 3, textTransform: 'uppercase', color: theme.accent, marginBottom: 10 }}>
        [{beat.stage}] {beat.label}
      </div>

      {beat.speaker && beat.line && (
        <div style={{ fontFamily: theme.sans, fontSize: 30, color: theme.ink, marginBottom: 18, fontWeight: 600, maxWidth: 1000 }}>
          <span style={{ color: theme.inkSoft, fontWeight: 700 }}>{beat.speaker}</span> {beat.line}
        </div>
      )}

      {wireLines.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
          {wireLines.map((w, i) => (
            <WireLine key={i} text={w} delay={20 + i * 8} />
          ))}
        </div>
      )}

      {beat.result && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 24, marginTop: 8 }}>
          <span style={{ fontFamily: theme.mono, fontSize: 72, fontWeight: 700, color: recTone === 'red' ? theme.red : theme.accent, fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(interpolate(frame, [8, 28], [0, beat.result.trustScore], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }))}/100
          </span>
          <Pill text={beat.result.recommendation} tone={recTone} />
        </div>
      )}
      {beat.detail && <div style={{ fontFamily: theme.mono, fontSize: 20, color: theme.inkFaint, marginTop: 12 }}>{beat.detail}</div>}

      {beat.verdict && (
        <div style={{ fontFamily: theme.mono, fontSize: 26, color: theme.red, marginTop: 10, maxWidth: 1000 }}>{beat.verdict}</div>
      )}

      {beat.released && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          {beat.released.map((r, i) => (
            <div key={i} style={{ fontFamily: theme.mono, fontSize: 28, fontWeight: 700, color: theme.accent, opacity: interpolate(frame, [30 + i * 14, 42 + i * 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
              ✓ RELEASED {r.amount} → {r.to}
            </div>
          ))}
        </div>
      )}

      {beat.closing && (
        <div
          style={{
            fontFamily: theme.sans, fontSize: 30, fontWeight: 650, color: beat.verdict ? theme.amber : theme.ink,
            marginTop: 28, maxWidth: 980, lineHeight: 1.35,
            opacity: interpolate(frame, [50, 66], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          }}
        >
          {beat.closing}
        </div>
      )}
    </div>
  );
};
