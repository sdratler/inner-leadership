import type {ContentVoiceSnapshot} from '../content-voice/source.ts';
import {ContentVoiceView} from '../content-voice/source-view.tsx';
import {CommunityReplyWorkspace} from './workspace.tsx';
import {CommunitySettingsPanel} from './settings-panel.tsx';
import {communityViews,type CommunityView} from './views.ts';

export function CommunitySection({locale,view,source=null}:{locale:'he'|'en';view:CommunityView;source?:ContentVoiceSnapshot|null}){
 const selected=communityViews.find(item=>item.key===view)!;
 return <section className="lsw-stack" lang={locale} dir={locale==='he'?'rtl':'ltr'}>
  <header className="lsw-page-header"><div><p className="lsw-eyebrow">{locale==='he'?'קהילה':'Community'}</p><h1>{selected[locale]}</h1></div></header>
  {view==='opportunities'&&<CommunityReplyWorkspace locale={locale}/>}
  {(view==='sources'||view==='budget')&&<CommunitySettingsPanel locale={locale} view={view}/>}
  {view==='writing_rules'&&<ContentVoiceView locale={locale} source={source}/>}
 </section>;
}
