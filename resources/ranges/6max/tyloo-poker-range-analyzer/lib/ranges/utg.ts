import { PositionRange } from '../types';

// UTG (Under the Gun) RFI Range - Tightest position
// ~15% of hands
export const utgRange: PositionRange = {
  // Premium pairs - always raise
  'AA': { raise: 100, call: 0, fold: 0 },
  'KK': { raise: 100, call: 0, fold: 0 },
  'QQ': { raise: 100, call: 0, fold: 0 },
  'JJ': { raise: 100, call: 0, fold: 0 },
  'TT': { raise: 100, call: 0, fold: 0 },
  '99': { raise: 100, call: 0, fold: 0 },
  '88': { raise: 100, call: 0, fold: 0 },
  '77': { raise: 100, call: 0, fold: 0 },
  '66': { raise: 50, call: 0, fold: 50 },
  '55': { raise: 25, call: 0, fold: 75 },

  // Broadway suited
  'AKs': { raise: 100, call: 0, fold: 0 },
  'AQs': { raise: 100, call: 0, fold: 0 },
  'AJs': { raise: 100, call: 0, fold: 0 },
  'ATs': { raise: 100, call: 0, fold: 0 },
  'KQs': { raise: 100, call: 0, fold: 0 },
  'KJs': { raise: 100, call: 0, fold: 0 },
  'KTs': { raise: 75, call: 0, fold: 25 },
  'QJs': { raise: 100, call: 0, fold: 0 },
  'QTs': { raise: 50, call: 0, fold: 50 },
  'JTs': { raise: 100, call: 0, fold: 0 },

  // Suited aces
  'A9s': { raise: 50, call: 0, fold: 50 },
  'A8s': { raise: 25, call: 0, fold: 75 },
  'A5s': { raise: 50, call: 0, fold: 50 },
  'A4s': { raise: 25, call: 0, fold: 75 },

  // Broadway offsuit
  'AKo': { raise: 100, call: 0, fold: 0 },
  'AQo': { raise: 100, call: 0, fold: 0 },
  'AJo': { raise: 100, call: 0, fold: 0 },
  'ATo': { raise: 50, call: 0, fold: 50 },
  'KQo': { raise: 75, call: 0, fold: 25 },
};
