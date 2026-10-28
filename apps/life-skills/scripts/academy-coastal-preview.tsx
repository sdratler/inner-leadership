// Local design evidence only. No production services or registration writes.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AcademyWebsite} from '../src/features/group-application/academy-website.tsx';
import {AcademyStage} from '../src/features/group-application/academy-stage.tsx';
import {AcademyIntakePage} from '../src/features/group-application/academy-intake-page.tsx';
import {AcademyPricing} from '../src/features/group-application/academy-pricing.tsx';
import {AcademySiteFrame} from '../src/features/group-application/academy-site-frame.tsx';
import {AcademyPublicRoute} from '../src/features/group-application/academy-route-context.tsx';
import {AcademyFounderConfirm} from '../src/features/group-application/academy-founder-confirm.tsx';
function Preview(){
 const [locale,setLocale]=useState<'en'|'he'>(location.pathname.startsWith('/he/')?'he':'en');
 const path=location.pathname;
 return <AcademyPublicRoute mode="bna"><>{path.includes('/confirm')?<AcademyFounderConfirm locale={locale}/>:path.includes('/apply')?<AcademyIntakePage locale={locale}/>:path.includes('/stages/')?<AcademyStage locale={locale} slug={path.split('/').at(-1)!}/>:path.endsWith('/pricing')?<AcademySiteFrame locale={locale}><AcademyPricing locale={locale}/></AcademySiteFrame>:<AcademyWebsite locale={locale} onLocaleChange={setLocale}/>}</></AcademyPublicRoute>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
