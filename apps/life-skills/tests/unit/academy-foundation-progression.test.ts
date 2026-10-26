import {expect,it} from 'vitest';
import {academyFoundationProgression,academyStages} from '../../src/features/group-application/academy-public-program.ts';
it('keeps the adopted five Foundation groups with Bass Pro second and practical assembly third',()=>{
 expect(academyFoundationProgression.map(s=>s.label.en)).toEqual(['Meeting 1','Meeting 2','Meeting 3','Meeting 4','Meetings 5–12']);
 expect(academyFoundationProgression.map(s=>s.label.he)).toEqual(['מפגש 1','מפגש 2','מפגש 3','מפגש 4','מפגשים 5–12']);
 const [intro,store,assembly,outing,later]=academyFoundationProgression;
 expect(intro!.body.en).toMatch(/existing equipment, safety and collaboration/);expect(intro!.body.he).toContain('בטיחות ושיתוף פעולה');
 expect(store!.title.en).toContain('Bass Pro Shops');expect(store!.title.he).toContain('Bass Pro Shops');
 expect(assembly!.body.en).toContain('load line, tie rigs and practise safe casting');expect(assembly!.body.he).toContain('קושרים ריגים');
 expect(outing!.body.en).toContain('readiness and a confirmed suitable site');expect(outing!.body.he).toContain('מוכנות');
 expect(later!.body.en).toContain('replaces');expect(later!.body.he).toContain('מחליף');
 expect(intro!.body.en).toContain('Ordinary meetings last three hours');expect(intro!.body.he).toContain('מפגשים רגילים נמשכים שלוש שעות');
 expect(JSON.stringify(academyFoundationProgression)).not.toMatch(/2 hours each|two separate preparation|שעתיים כל אחד|Meeting 3 ·/);
 expect(academyStages.map(s=>s.slug)).toEqual(['foundation','independent','advanced','leadership']);
});
