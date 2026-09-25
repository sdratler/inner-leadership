import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntakeSummaryCard } from '../../../src/features/prospects/summary-card.tsx';

describe('calendar intake state', () => {
  for (const [locale, expected] of [['en', 'Loading intake data'], ['he', 'טוענים נתוני קליטה']] as const) {
    it(`${locale}: identifies a pending CRM read without inventing a zero count`, () => {
      const html = renderToStaticMarkup(React.createElement(IntakeSummaryCard, { locale }));
      expect(html).toContain(expected);
      expect(html).toContain('aria-busy="true"');
      expect(html).not.toContain('Follow-ups due');
    });
  }
});
