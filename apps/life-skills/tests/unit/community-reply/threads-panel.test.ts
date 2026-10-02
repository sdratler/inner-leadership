import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {expect,it} from 'vitest';
import {CommunityThreadPanel,captureReasonLabel} from '../../../src/features/community-reply/thread-panel.tsx';
it.each(['en','he']as const)('keeps %s tracking collapsed, explicit and separate from generation or provider activation',locale=>{
 const html=renderToStaticMarkup(React.createElement(CommunityThreadPanel,{locale,posts:[]}));expect(html).toContain('<details class="lsr-panel">');expect(html).toContain(locale==='en'?'Exact link to your manually posted comment':'קישור מדויק לתגובה שפרסמת ידנית');expect(html).toContain('type="checkbox"');expect(html).toContain('disabled=""');expect(html).not.toContain('Delete Demo');expect(html).not.toContain('Send reply');expect(html).toContain(locale==='en'?'No posting, private messages or new scraper runs':'אין פרסום, הודעות פרטיות או הפעלת איסוף חדש');
});
it.each(['en','he']as const)('groups the %s confirmation checkbox and uses readable capture explanations',locale=>{
 const html=renderToStaticMarkup(React.createElement(CommunityThreadPanel,{locale,posts:[]}));expect(html).toContain('<label class="lsr-community-review"><input type="checkbox"');
 for(const reason of ['bounded_or_partial_capture','collection_not_authorized','thread_limits_or_groups_unavailable','numeric_budget_unavailable','comment_mapping_unavailable','verified_run_or_cost_unavailable','observed_run_budget_exceeded']){const text=captureReasonLabel(locale,reason);expect(text.length).toBeGreaterThan(15);expect(text).not.toContain(reason);expect(text).not.toContain('_');}
 expect(captureReasonLabel(locale,'bounded_or_partial_capture')).toBe(locale==='en'?'Only a bounded or partial set of responses was captured.':'נקלטה רק קבוצה מוגבלת או חלקית של תגובות.');
 expect(captureReasonLabel(locale,null)).toBe('');expect(captureReasonLabel(locale,undefined)).toBe('');
 for(const reason of ['constructor','__proto__','toString','future_provider_reason'])expect(captureReasonLabel(locale,reason)).toBe(locale==='en'?'Response capture status could not be verified.':'לא ניתן לאמת את מצב קליטת התגובות.');
});
