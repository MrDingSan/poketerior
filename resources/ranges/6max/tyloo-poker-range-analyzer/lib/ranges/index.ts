import { Position, PositionRange, RangeAction } from '../types';
import { utgRange } from './utg';
import { mpRange } from './mp';
import { coRange } from './co';
import { btnRange } from './btn';
import { sbRange } from './sb';
import { bbRange } from './bb';

export const ranges: Record<Position, PositionRange> = {
  UTG: utgRange,
  MP: mpRange,
  CO: coRange,
  BTN: btnRange,
  SB: sbRange,
  BB: bbRange,
};

export function getRangeForPosition(position: Position): PositionRange {
  return ranges[position];
}

export function getHandAction(position: Position, hand: string): RangeAction {
  const range = ranges[position];
  return range[hand] || { raise: 0, call: 0, fold: 100 };
}

export function isHandInRange(position: Position, hand: string): boolean {
  const action = getHandAction(position, hand);
  return action.raise > 0 || action.call > 0;
}

export function getRangePercentage(position: Position): number {
  const range = ranges[position];
  let inRangeCombos = 0;

  for (const hand of Object.keys(range)) {
    const action = range[hand];
    const combos = getHandCombos(hand);
    const freq = (action.raise + action.call) / 100;
    inRangeCombos += combos * freq;
  }

  // Total possible starting hands combos: 1326
  return (inRangeCombos / 1326) * 100;
}

function getHandCombos(hand: string): number {
  if (hand.length === 2) {
    // Pocket pair: 6 combos
    return 6;
  } else if (hand.endsWith('s')) {
    // Suited: 4 combos
    return 4;
  } else {
    // Offsuit: 12 combos
    return 12;
  }
}

export { utgRange, mpRange, coRange, btnRange, sbRange, bbRange };
