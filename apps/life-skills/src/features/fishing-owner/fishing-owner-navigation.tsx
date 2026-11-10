import {fishingOwnerNavigation,type FishingOwnerNavigationInput,type FishingOwnerNavigationItem} from './fishing-owner-navigation-model.ts';
import styles from './fishing-owner-navigation.module.css';

function Destination({item}:{item:FishingOwnerNavigationItem}){
 return item.state==='available'?
  <a className={styles.link} href={item.href} aria-current={item.current?'page':undefined} data-fishing-owner-destination={item.key}>
   {item.label}
  </a>:
  <span className={styles.unavailable} data-fishing-owner-destination={item.key} data-availability="unavailable">
   <span className={styles.label}>{item.label}</span><span className={styles.reason}>{item.reason}</span>
  </span>;
}

/** Unmounted presentation component. It performs no scope lookup, request or
 * activation; the existing guarded application shell owns its eventual use. */
export function FishingOwnerNavigation(props:FishingOwnerNavigationInput){
 const model=fishingOwnerNavigation(props);if(!model)return null;
 return <nav className={styles.root} lang={model.locale} dir={model.locale==='he'?'rtl':'ltr'} aria-label={model.navigationLabel} data-fishing-owner-navigation="true">
  <header className={styles.header}><p className={styles.heading}>{model.heading}</p><p className={styles.context}>{model.contextLabel}</p></header>
  <ul className={styles.areas}>{model.areas.map(area=><li className={styles.area} key={area.key} data-fishing-owner-area={area.key}>
   {area.reason?<span className={styles.unavailable} data-availability="unavailable"><span className={styles.label}>{area.label}</span><span className={styles.reason}>{area.reason}</span></span>:
    area.items.length===1?<Destination item={area.items[0]!}/>:
    <><p className={styles.areaLabel}>{area.label}</p><ul className={styles.destinations}>{area.items.map(item=><li key={item.key}><Destination item={item}/></li>)}</ul></>}
  </li>)}</ul>
 </nav>;
}
