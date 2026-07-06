import React from 'react';
import { Composition } from 'remotion';
import { OracleClip } from './OracleClip';
import { totalDuration, FPS } from './layout';
import type { RunData } from './types';
import happyRun from '../data/happy-run.json';
import disputeRun from '../data/dispute-run.json';

const happy = happyRun as RunData;
const dispute = disputeRun as RunData;

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="oracle-happy"
      component={OracleClip}
      durationInFrames={totalDuration(happy.beats)}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ data: happy }}
    />
    <Composition
      id="oracle-dispute"
      component={OracleClip}
      durationInFrames={totalDuration(dispute.beats)}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ data: dispute }}
    />
  </>
);
