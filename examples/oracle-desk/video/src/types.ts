export interface OracleResult {
  trustScore: number;
  band: string;
  recommendation: string;
  dishonest?: boolean;
}

export interface Beat {
  stage: number;
  label: string;
  speaker?: string;
  line?: string;
  wire?: string | string[];
  result?: OracleResult;
  detail?: string;
  verdict?: string;
  released?: { amount: string; to: string }[];
  closing?: string;
}

export interface RunData {
  title: string;
  subtitle: string;
  beats: Beat[];
}
