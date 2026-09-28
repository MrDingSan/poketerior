import { PositionRange } from '../types';

// MP (Middle Position) RFI Range - Slightly wider than UTG
// ~18% of hands
export const mpRange: PositionRange = {
  // Premium pairs
  'AA': { raise: 100, call: 0, fold: 0 },
  'KK': { raise: 100, call: 0, fold: 0 },
  'QQ': { raise: 100, call: 0, fold: 0 },
  'JJ': { raise: 100, call: 0, fold: 0 },
  'TT': { raise: 100, call: 0, fold: 0 },
  '99': { raise: 100, call: 0, fold: 0 },
  '88': { raise: 100, call: 0, fold: 0 },
  '77': { raise: 100, call: 0, fold: 0 },
  '66': { raise: 75, call: 0, fold: 25 },
  '55': { raise: 50, call: 0, fold: 50 },
  '44': { raise: 25, call: 0, fold: 75 },

  // Broadway suited
  'AKs': { raise: 100, call: 0, fold: 0 },
  'AQs': { raise: 100, call: 0, fold: 0 },
  'AJs': { raise: 100, call: 0, fold: 0 },
  'ATs': { raise: 100, call: 0, fold: 0 },
  'A9s': { raise: 75, call: 0, fold: 25 },
  'A8s': { raise: 50, call: 0, fold: 50 },
  'A5s': { raise: 75, call: 0, fold: 25 },
  'A4s': { raise: 50, call: 0, fold: 50 },
  'A3s': { raise: 25, call: 0, fold: 75 },
  'KQs': { raise: 100, call: 0, fold: 0 },
  'KJs': { raise: 100, call: 0, fold: 0 },
  'KTs': { raise: 100, call: 0, fold: 0 },
  'K9s': { raise: 25, call: 0, fold: 75 },
  'QJs': { raise: 100, call: 0, fold: 0 },
  'QTs': { raise: 75, call: 0, fold: 25 },
  'Q9s': { raise: 25, call: 0, fold: 75 },
  'JTs': { raise: 100, call: 0, fold: 0 },
  'J9s': { raise: 25, call: 0, fold: 75 },
  'T9s': { raise: 50, call: 0, fold: 50 },

  // Broadway offsuit
  'AKo': { raise: 100, call: 0, fold: 0 },
  'AQo': { raise: 100, call: 0, fold: 0 },
  'AJo': { raise: 100, call: 0, fold: 0 },
  'ATo': { raise: 75, call: 0, fold: 25 },
  'KQo': { raise: 100, call: 0, fold: 0 },
  'KJo': { raise: 50, call: 0, fold: 50 },
  'QJo': { raise: 25, call: 0, fold: 75 },
};
