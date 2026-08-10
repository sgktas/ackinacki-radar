export type ChainEpochClock = {
  epochStart: string;
  currentSeqNo: number;
  nextEpochSeqNo: number;
  remainingSeconds: number;
  chainTimestamp: number;
  observedAt: string;
  source: "chain" | "estimated";
};

let currentClock: ChainEpochClock | null = null;

export function setChainEpochClock(clock: ChainEpochClock) {
  currentClock = { ...clock };
}

export function getChainEpochClock(): ChainEpochClock | null {
  return currentClock ? { ...currentClock } : null;
}
