import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {expect,it} from 'vitest';
import {CommunityThreadPanel} from '../../../src/features/community-reply/thread-panel.tsx';
it.each(['en','he']as const)('keeps %s tracking collapsed, explicit and separate from generation or provider activation',locale=>{
 const html=renderToStaticMarkup(React.createElement(CommunityThreadPanel,{locale,posts:[]}));expect(html).toContain('<details class="lsr-panel">');expect(html).toContain(locale==='en'?'Exact link to your manually posted comment':'קישור מדויק לתגובה שפרסמת ידנית');expect(html).toContain('type="checkbox"');expect(html).toContain('disabled=""');expect(html).not.toContain('Delete Demo');expect(html).not.toContain('Send reply');expect(html).toContain(locale==='en'?'No posting, private messages or new scraper runs':'אין פרסום, הודעות פרטיות או הפעלת איסוף חדש');
});
