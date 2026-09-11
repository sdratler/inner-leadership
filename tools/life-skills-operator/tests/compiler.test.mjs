import test from 'node:test';
import assert from 'node:assert/strict';
import { loadState } from '../src/state.mjs';
import { compileContract, assertCreativeContract } from '../src/compiler.mjs';

const state = loadState();

const baseIntent = {
  classification:'owner_correction', summary:'test', preserve:[], requestedChanges:[], locale:'both', format:'multiple', conceptId:null, photoId:'A', ownerApprovalRequired:false, rationale:'test'
};

test('website hero never bakes live UI into static plate and uses exact OpenArt assets', () => {
  const intent = { ...baseIntent, domain:'website_hero' };
  const c = compileContract(intent,state,'plan');
  assertCreativeContract(c);
  const forbidden = c.rendering.generatedUIForbidden.join('|');
  assert.match(forbidden,/toolbar\/header/);
  assert.match(forbidden,/WhatsApp button/);
  assert.match(forbidden,/benefit icons/);
  assert.match(c.rendering.desktopRule,/no photo-left\/text-right/);
  assert.match(c.rendering.cssArtDirection,/^forbidden;/);
  assert.equal(c.rendering.noChaining,true);
  assert.deepEqual(c.layering.liveOrder,[
    'header/toolbar','headline','service line','age line','centered photo/art plate','real WhatsApp link button','three live benefit items'
  ]);
  assert.equal(c.layering.whatsappButton.href,'https://wa.me/972534932631');
  assert.deepEqual(c.rendering.visualReferences.map(x=>x.id),['5Fidhb5Gy4pLhCzTIkNO','2JRZlpK8Gy3hAoYp3XMv']);
  assert.equal(c.exactAssets.visualTargetReferenceOnly.role.includes('reference only'),true);
});

test('Photo A ad reference contract is exact and ordered', () => {
  const intent = {
    ...baseIntent, classification:'execute_approved_intent', domain:'ad_creative', summary:'C01 proof', locale:'he', format:'feed', conceptId:'C01', ownerApprovalRequired:true
  };
  const c = compileContract(intent,state,'plan');
  assertCreativeContract(c);
  assert.equal(c.exactAssets.project.id,'YNFWEmEe4mvjjbLz7KLc');
  assert.deepEqual(c.rendering.visualReferences.map(x=>x.id),['5Fidhb5Gy4pLhCzTIkNO','2JRZlpK8Gy3hAoYp3XMv']);
  assert.deepEqual(c.rendering.referenceAllowlist,['5Fidhb5Gy4pLhCzTIkNO','2JRZlpK8Gy3hAoYp3XMv']);
  assert.equal(c.rendering.noChaining,true);
  assert.equal(c.exactAssets.logoPostComposite.allowed_as_reference,false);
  assert.equal(c.layering.rasterCta.en,'Message on WhatsApp');
  assert.equal(c.layering.metaInteraction.platform_cta_is_separate,true);
  assert.equal(c.layering.metaInteraction.raster_is_not_clickable,true);
});

test('post-compile validation fails closed on website layering or CSS art-direction drift', () => {
  const intent = { ...baseIntent, domain:'website_hero' };
  const c = compileContract(intent,state,'plan');
  c.rendering.cssArtDirection = 'CSS gradient allowed';
  assert.throws(()=>assertCreativeContract(c),/CSS-generated hero art direction is forbidden/);

  const sideSplit = compileContract(intent,state,'plan');
  sideSplit.rendering.desktopRule = 'photo-left/text-right';
  assert.throws(()=>assertCreativeContract(sideSplit),/Side-split desktop hero is forbidden/);

  const bakedUi = compileContract(intent,state,'plan');
  bakedUi.rendering.staticPlate.push('toolbar/header');
  assert.throws(()=>assertCreativeContract(bakedUi),/Static hero plate allowlist drifted/);
});

test('post-compile validation fails closed on chaining, allowlist or unsafe-effect drift', () => {
  const intent = {
    ...baseIntent, classification:'execute_approved_intent', domain:'ad_creative', summary:'C01 proof', locale:'he', format:'feed', conceptId:'C01', ownerApprovalRequired:true
  };
  const chained = compileContract(intent,state,'plan');
  chained.rendering.noChaining = false;
  assert.throws(()=>assertCreativeContract(chained),/Generated-reference chaining is forbidden/);

  const logoRef = compileContract(intent,state,'plan');
  logoRef.rendering.referenceAllowlist.push('oukvPUpJ5PYmgbA0hy0B');
  assert.throws(()=>assertCreativeContract(logoRef),/OpenArt reference allowlist drifted/);

  const paidPlan = compileContract(intent,state,'plan');
  paidPlan.effects.spend = true;
  assert.throws(()=>assertCreativeContract(paidPlan),/Unsafe creative contract effects/);
});

test('Photo B is explicit and fail-closed until exact OpenArt upload is registered', () => {
  assert.equal(state.assets.assets.photo_b.status,'OPENART_UPLOAD_ID_REQUIRED');
  assert.equal(state.assets.assets.photo_b.allowed_as_reference,false);
  assert.equal(state.brand.ads.openart.photo_b.status,'OPENART_UPLOAD_ID_REQUIRED_BEFORE_B_JOBS');
  const intent = {
    ...baseIntent, classification:'execute_approved_intent', domain:'ad_creative', photoId:'B', locale:'he', format:'feed', conceptId:'C01'
  };
  assert.throws(()=>compileContract(intent,state,'plan'),/Photo B is fail-closed/);
});
