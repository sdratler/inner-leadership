import {currentTrip390Fields} from '../fixtures/trip390-current.ts';
import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AcademyTrip390Page} from '../../src/features/group-application/academy-trip390-page.tsx';
import {trip390InterestSchema,trip390CommandSchema,trip390Quote,trip390Location,trip390CitySuggestions,trip390Copy,trip390Metadata} from '../../src/features/group-application/academy-trip390-contract.ts';
import {trip390Capacity,trip390SeatDecision,trip390ShopHelperCost,trip390AgeOnDate,trip390Readiness,trip390PublicEvent,trip390ReminderPreview,trip390CapabilityDecision,trip390CheckoutBlockers,trip390Checkout,trip390TestOrder} from '../../src/features/group-application/academy-trip390-operations.ts';
const fields=currentTrip390Fields;
describe('trip390 versioned interest candidate',()=>{
 it.each(['en','he'] as const)('preserves the exact single introduction heading through discretionary reflow (%s)',initialLocale=>{
  const html=renderToStaticMarkup(createElement(AcademyTrip390Page,{initialLocale}));
  const headings=[...html.matchAll(/<h2\b[^>]*id="trip390-intro-title"[^>]*>([\s\S]*?)<\/h2>/g)];
  expect(headings).toHaveLength(1);
  const heading=headings[0]![1]!;
  const serializedCopy=renderToStaticMarkup(createElement('span',null,trip390Copy[initialLocale].intro.title));
  expect(heading.replace(/<[^>]*>/g,'')).toBe(serializedCopy.replace(/<[^>]*>/g,''));
  expect(heading.match(/<wbr\s*\/?\s*>/g)??[]).toHaveLength(initialLocale==='en'?1:0);
 });
 it.each(['en','he'] as const)('keeps the readable documents inside genuinely disabled permission controls (%s)',initialLocale=>{
  const html=renderToStaticMarkup(createElement(AcademyTrip390Page,{initialLocale}));
  const permissions=[...html.matchAll(/<fieldset\b[^>]*>[\s\S]*?<\/fieldset>/g)].map(match=>match[0]).filter(value=>value.includes('data-reservation-notice-version='));
  expect(permissions).toHaveLength(1);
  expect(permissions[0]).toMatch(/^<fieldset\b[^>]*disabled=""/);
  const boxes=permissions[0]!.match(/<input\b[^>]*type="checkbox"[^>]*>/g)??[];
  expect(boxes).toHaveLength(3);for(const box of boxes)expect(box).not.toMatch(/\bchecked(?:=|\s|>)/);
  expect(permissions[0]).not.toMatch(/name="guardianTypedName"/);
  expect(html).toMatch(/<button\b(?=[^>]*type="submit")(?=[^>]*disabled="")[^>]*>/);
 });

 it.each(['en','he'] as const)('uses the selected request copy without implying a confirmed place (%s)',locale=>{
  const copy=trip390Copy[locale];
  expect(copy.hero.interest_cta).toBe(locale==='en'?'Reserve Your Spot Now':'שריינו מקום עכשיו');
  expect(copy.form.title).toBe(locale==='en'?'Reserve Your Spot Now':'שריינו מקום עכשיו');
  expect(copy.form.submit).toBe(locale==='en'?'Reserve Your Spot Now':'שריינו מקום עכשיו');
  expect(copy.form.saved).toBe(locale==='en'?'Thank you—your request has been received.':'תודה—בקשתכם התקבלה.');
  expect(copy.form.place_not_confirmed).toBeTruthy();
  expect([copy.hero.interest_cta,copy.form.title,copy.form.submit].join(' ')).not.toMatch(/trip updates|עדכונים על טיולים|↗|→/i);
  expect(copy.price.amount).toBe('$390');expect(copy.price.per_boy).toBeTruthy();
 });
 it('accepts arbitrary typed city without creating legacy fields',()=>{const value=trip390InterestSchema.parse(fields());expect(value).not.toHaveProperty('stagePreference');expect(value).not.toHaveProperty('gradeBand');expect(trip390Location(value)).toEqual({city:'My Local Neighborhood',cityKey:'my local neighborhood',postalCode:'01234-5678',postalCode5:'01234'});});
 it.each(['ירושלים','O’Town','St. Somewhere','My-Local Area'])('accepts custom locality %s',city=>expect(trip390InterestSchema.safeParse({...fields(),city}).success).toBe(true));
 it.each(['','A','A\nTown','<\u0000>','Ab\u202eTown'])('rejects invalid/control-bearing city %j',city=>expect(trip390InterestSchema.safeParse({...fields(),city}).success).toBe(false));
 it.each(['1234','123456','12 345',12345])('rejects invalid ZIP %j',postalCode=>expect(trip390InterestSchema.safeParse({...fields(),postalCode}).success).toBe(false));
 it('suggestions are optional bounded hints, never a validator',()=>{expect(trip390CitySuggestions('beach').length).toBeLessThanOrEqual(8);expect(trip390CitySuggestions('Unlisted Place')).toEqual([]);expect(trip390InterestSchema.safeParse({...fields(),city:'Unlisted Place'}).success).toBe(true);});
 it('requires both acknowledgments and current phone with optional WhatsApp',()=>{expect(trip390InterestSchema.safeParse({...fields(),acknowledgment:{...fields().acknowledgment,conductExplained:false}}).success).toBe(false);expect(trip390InterestSchema.safeParse({...fields(),acknowledgment:{...fields().acknowledgment,interestPrivacySafety:false}}).success).toBe(false);const opted={...fields(),acknowledgment:{...fields().acknowledgment,whatsapp:true}};expect(trip390InterestSchema.safeParse({...opted,phone:undefined}).success).toBe(false);expect(trip390InterestSchema.safeParse({...opted,phone:'+12025550101'}).success).toBe(true);});
 it('does not fabricate eligibility or merge sibling IDs',()=>{expect(trip390InterestSchema.safeParse({...fields(),children:[{...fields().children[0],ageYears:22}]}).success).toBe(false);expect(trip390InterestSchema.safeParse({...fields(),children:[fields().children[0],fields().children[0]]}).success).toBe(false);});
 it('rejects client prices, scopes and fabricated legacy selections',()=>{for(const extra of [{priceCents:1},{workspaceId:'other'},{stagePreference:'foundation'},{password:'secret'}])expect(trip390InterestSchema.safeParse({...fields(),...extra}).success).toBe(false);expect(trip390CommandSchema.safeParse({operationId:'not-an-id',fields:fields()}).success).toBe(false);});
 it('quotes per child without a sibling reduction or renewal',()=>{expect(trip390Quote(2)).toMatchObject({totalCents:78000,discountCents:0,automaticRenewal:false});expect(trip390Quote(3).totalCents).toBe(117000);expect(()=>trip390Quote(0)).toThrow();expect(()=>trip390TestOrder(['same','same'])).toThrow();});
 it('pairs exact EN/HE keys and no legacy sales promotion in metadata',()=>{expect(trip390Copy.en.faqs.map(item=>item.id)).toEqual(trip390Copy.he.faqs.map(item=>item.id));for(const locale of ['en','he'] as const){expect(trip390Metadata(locale).robots).toEqual({index:false,follow:false});expect(JSON.stringify(trip390Metadata(locale))).toContain('390');expect(JSON.stringify(trip390Metadata(locale))).not.toMatch(/650|first 30|self-governance/i);}});
 it.each(['en','he'] as const)('renders %s without old sales controls, login or fake save',initialLocale=>{const html=renderToStaticMarkup(createElement(AcademyTrip390Page,{initialLocale}));expect(html).toContain('390');expect(html).toContain('hero-desktop-20261018.png');expect(html).not.toMatch(/first 30|parent_activation|type="password"|65000/);expect(html.match(/type="checkbox"/g)).toHaveLength(3);expect(html.match(/<input(?=[^>]*name="(?:conduct|interest)")(?=[^>]*required)[^>]*>/g)).toHaveLength(2);expect(html).toContain('disabled=""');expect(html).toContain(`dir="${initialLocale==='he'?'rtl':'ltr'}"`);});
});
describe('trip390 disabled operations candidate',()=>{
 const vehicle={seats:50,staff:5,otherPassengers:0,cargoSeatReduction:0,approvedChildLimit:45,approved:true};
 it('fails closed for missing approvals and calculates actual seats',()=>{expect(trip390Capacity(vehicle)).toBe(45);expect(trip390Capacity({...vehicle,seats:45})).toBe(40);expect(trip390Capacity({...vehicle,cargoSeatReduction:3})).toBe(42);expect(trip390Capacity({...vehicle,approved:false})).toBe(0);expect(trip390Capacity({...vehicle,seats:NaN})).toBe(0);});
 it('never partially accepts siblings or creates a second vehicle',()=>{expect(trip390SeatDecision(45,44,2)).toBe('waitlist');expect(trip390SeatDecision(45,45,1)).toBe('waitlist');expect(trip390SeatDecision(45,43,2)).toBe('available_for_test_hold');});
 it('keeps staffing cost as a planning calculation',()=>expect(trip390ShopHelperCost(2)).toBe(60000));
 it('handles the 16th birthday and invalid civil dates',()=>{expect(trip390AgeOnDate('2014-01-06','2030-01-06')).toBe(16);expect(trip390AgeOnDate('2014-01-06','2030-01-05')).toBe(15);expect(()=>trip390AgeOnDate('2014-02-30','2030-01-06')).toThrow();});
 it('payment is absent from readiness and does not replace preparation',()=>{const ready={firstTime:true,preparation1:true,preparation2:false,returningPreparationVerified:false,guardianConsent:true,emergencyComplete:true,pickupAssigned:true,licenseReviewed:true,ownerApproved:true};expect(trip390Readiness(ready)).toBe(false);expect(trip390Readiness({...ready,preparation2:true})).toBe(true);expect(trip390Readiness({...ready,firstTime:false})).toBe(false);});
 it('serializes only explicitly approved public event fields',()=>{const event={id:'synthetic',status:'proposed' as const,publicApproved:true,publicTitle:'Synthetic date',startsAt:'2030-01-06T08:00:00-05:00',timeZone:'America/New_York' as const,revision:1,roster:['private'],medical:'private',token:'private'};const output=trip390PublicEvent(event);expect(output).not.toHaveProperty('roster');expect(output).not.toHaveProperty('medical');expect(output).not.toHaveProperty('token');expect(output?.bookable).toBe(false);expect(trip390PublicEvent({...event,status:'draft'})).toBeNull();});
 it('preserves unknown/sent and suppresses stale, canceled and nonconsenting reminders',()=>{const reminder={state:'unknown' as const,offerVersion:'JLFA-KEYS390-v1',channel:'whatsapp' as const,whatsappConsent:false,bookingActive:false,scheduleRevision:1,currentRevision:2,language:'he' as const};const before=JSON.stringify(reminder);expect(trip390ReminderPreview(reminder)).toEqual({send:false,state:'held',reasons:['historical_or_unreconciled','inactive_booking','stale_schedule','no_whatsapp_consent']});expect(JSON.stringify(reminder)).toBe(before);expect(trip390ReminderPreview({...reminder,state:'queued',whatsappConsent:true,bookingActive:true,scheduleRevision:2})).toEqual({send:false,state:'dry_run',reasons:[]});});
 it('does not bypass existing auth or apply a fishing gate to another business',()=>{expect(trip390CapabilityDecision({scope:'unrelated',role:'parent',inventoryAdmitted:true})).toBe('defer_to_existing_policy');expect(trip390CapabilityDecision({scope:'fishing',role:'owner',inventoryAdmitted:true})).toBe('require_existing_owner_authorization');expect(trip390CapabilityDecision({scope:'fishing',role:'parent',inventoryAdmitted:false})).toBe('cutover_not_admitted');expect(trip390CapabilityDecision({scope:'fishing',role:'student',inventoryAdmitted:true})).toBe('deny_fishing_customer_capability');});
 it('checkout remains disabled even with all candidate evidence',()=>{expect(trip390CheckoutBlockers()).toHaveLength(12);expect(trip390Checkout()).toMatchObject({enabled:false});});
});
