import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { CoreNavigation } from '../../../src/ui/workspace/core-navigation.tsx';

it.each(['en','he'] as const)('practitioner desktop and mobile calendar links resolve to the implemented %s route',locale=>{
 const markup=renderToStaticMarkup(CoreNavigation({locale,role:'practitioner',children:'Synthetic content'}));
 expect(markup.match(new RegExp(`href="/${locale}/app/calendar"`,'g'))).toHaveLength(2);
 expect(markup).not.toContain(`href="/${locale}/calendar"`);
 expect(existsSync(resolve(import.meta.dirname,'../../../src/app/[locale]/app/calendar/page.tsx'))).toBe(true);
});
