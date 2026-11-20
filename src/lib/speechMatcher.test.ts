import { describe, expect, it } from 'vitest';
import { buildTargetMatchForms, extractPrimaryLearnTerm, matchesSpokenText } from './speechMatcher';

describe('speechMatcher', () => {
  it('extracts primary learn term without parenthetical readings', () => {
    expect(extractPrimaryLearnTerm('林檎 (りんご)')).toBe('林檎');
    expect(extractPrimaryLearnTerm('Iced Latte')).toBe('Iced Latte');
  });

  it('matches spoken text across scripts, diacritics, and minor ASR typos', () => {
    const jpForms = buildTargetMatchForms('珈琲 (コーヒー)', 'こーひー');
    expect(matchesSpokenText('コーヒー ください', jpForms)).toBe(true);
    expect(matchesSpokenText('珈琲', jpForms)).toBe(true);

    const esForms = buildTargetMatchForms('Café con leche', 'ka-FE kon LE-che');
    expect(matchesSpokenText('cafe con leche', esForms)).toBe(true);

    const enForms = buildTargetMatchForms('Croissant');
    expect(matchesSpokenText('croisant', enForms)).toBe(true); // 1-edit tolerance
    expect(matchesSpokenText('banana', enForms)).toBe(false);
  });
});
