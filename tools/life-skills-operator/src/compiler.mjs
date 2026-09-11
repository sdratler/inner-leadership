import { ExecutionContractSchema } from './contracts.mjs';

const OPENART_PROJECT = 'YNFWEmEe4mvjjbLz7KLc';
const PHOTO_A_REFERENCE_IDS = ['5Fidhb5Gy4pLhCzTIkNO', '2JRZlpK8Gy3hAoYp3XMv'];
const WEBSITE_LIVE_ORDER = [
  'header/toolbar',
  'headline',
  'service line',
  'age line',
  'centered photo/art plate',
  'real WhatsApp link button',
  'three live benefit items',
];
const WEBSITE_STATIC_PLATE = [
  'real founder-and-boy photograph',
  'teal atmospheric shading',
  'photo-to-teal/cream transition',
  'reserved negative space',
  'restrained decorative bottom curve/background treatment',
];
const WEBSITE_BENEFITS_EN = ['Self-governance', 'Emotional regulation', 'Responsibility'];
const WEBSITE_BENEFITS_HE = ['הנהגה עצמית', 'ויסות רגשי', 'אחריות'];
const WEBSITE_BENEFIT_ICONS = ['self-governance.svg', 'emotional-regulation.svg', 'responsibility.svg'];

function sameValues(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, i) => value === expected[i]);
}

function assertSafeEffects(contract) {
  if (contract.effects.publish || contract.effects.spend || contract.effects.deploy || contract.effects.providerMutation) {
    throw new Error('Unsafe creative contract effects');
  }
  if (contract.mode === 'plan' && contract.effects.generateImage) throw new Error('Plan contract cannot generate images');
}

const REQUIRED_READS = [
  'START HERE CURRENT',
  'Build Control CURRENT',
  'Operating Protocol CURRENT',
  'fresh Git main',
  'MKT-060 CURRENT for creative rendering',
  'Website Brief CURRENT for website hero',
  'MKT-050 CURRENT for ad/caption copy',
];

export function compileContract(intent, state, mode = 'plan') {
  const base = {
    schemaVersion: 1,
    mode,
    classification: intent.classification,
    domain: intent.domain,
    outcome: intent.summary,
    requiredReads: REQUIRED_READS,
    exactAssets: {},
    rendering: {},
    layering: {},
    copy: {},
    validations: [],
    forbidden: [...state.policy.rules.filter((x) => x.startsWith('No '))],
    stopConditions: [],
    effects: { generateImage: false, publish: false, spend: false, deploy: false, providerMutation: false },
  };

  if (intent.domain === 'website_hero') {
    const plateGeneration = state.brand.website_hero.plate_generation;
    base.exactAssets = {
      visualTargetReferenceOnly: state.brand.website_hero.visual_target,
      logoPostLayer: state.brand.logo,
      photoA: state.assets.assets.photo_a,
      project: { name: plateGeneration.project_name, id: plateGeneration.project_id },
    };
    base.rendering = {
      type: 'static_art_plate_plus_live_html',
      provider: plateGeneration.provider,
      primary: plateGeneration.primary_model,
      visualReferences: plateGeneration.visual_references_exactly_two,
      staticPlate: state.brand.website_hero.static_plate_must_contain_only,
      generatedUIForbidden: state.brand.website_hero.static_plate_must_not_contain,
      desktopRule: state.brand.website_hero.desktop_rule,
      mobileRule: state.brand.website_hero.mobile_rule,
      cssArtDirection: state.brand.website_hero.css_art_direction,
      noChaining: true,
      desktopTarget: plateGeneration.desktop_target,
      mobileTarget: plateGeneration.mobile_target,
      proofPolicy: plateGeneration.proof_policy,
    };
    base.layering = {
      liveOrder: state.brand.website_hero.live_html_order,
      header: state.brand.website_hero.header,
      whatsappButton: state.brand.website_hero.whatsapp_button,
      benefits: state.brand.website_hero.benefits,
    };
    base.copy = { source: 'Website Brief CURRENT; do not invent or bake copy into plate' };
    base.validations = [
      'Static plate contains no toolbar, logo, text, WhatsApp glyph/button, benefits, navigation, locale control or hamburger.',
      'Desktop and mobile preserve centered hierarchy; desktop must not be side-split.',
      'Every website-plate OpenArt generation explicitly uses projectId YNFWEmEe4mvjjbLz7KLc.',
      'Website plate visualReferences are exactly [5Fidhb5Gy4pLhCzTIkNO, 2JRZlpK8Gy3hAoYp3XMv] in that order.',
      'The UI-rich style master is reference only and is never installed as the website plate.',
      'WhatsApp is a real live anchor to https://wa.me/972534932631.',
      'HE/EN toolbar mirrors exactly and uses live near-black Life Skills wordmark.',
      'At 390x844 and 360x800 the full CTA and all three benefits are visible before first scroll.',
    ];
    base.stopConditions = [
      'Stop if the proposed desktop plate is side-split.',
      'Stop if any UI is baked into the website static plate.',
      'Stop if OpenArt project or the two ordered reference IDs differ from the locked values.',
      'Stop if an unapproved generated image is proposed as another generation reference.',
    ];
    base.effects.generateImage = mode === 'execute';
  }

  if (intent.domain === 'ad_creative') {
    const openart = state.brand.ads.openart;
    if (intent.photoId === 'B') {
      throw new Error('Photo B is fail-closed: exact source/hash/OpenArt upload ID are not registered');
    }
    base.exactAssets = {
      project: { name: openart.project_name, id: openart.project_id },
      styleMaster: state.assets.assets.style_master,
      photoA: state.assets.assets.photo_a,
      photoB: state.assets.assets.photo_b,
      logoPostComposite: state.assets.assets.logo,
    };
    base.rendering = {
      artDirector: 'OpenArt MCP',
      primary: openart.primary_model,
      fallback: openart.fallback_model,
      visualReferences: openart.visual_references_exactly_two,
      referenceAllowlist: state.assets.reference_allowlist_for_c01_photo_a,
      noChaining: true,
      finalComposite: 'exact raster compositing for logo/copy/WhatsApp glyph/benefit SVGs only',
    };
    base.layering = { rasterCta: state.brand.ads.raster_cta, metaInteraction: state.brand.ads.meta_interaction };
    base.copy = { source: 'MKT-050 / current accepted concept copy', locale: intent.locale, conceptId: intent.conceptId };
    base.validations = [
      'Every OpenArt generation explicitly uses projectId YNFWEmEe4mvjjbLz7KLc.',
      'For Photo A proof, visualReferences are exactly [5Fidhb5Gy4pLhCzTIkNO, 2JRZlpK8Gy3hAoYp3XMv] in that order.',
      'No logo/icon/intermediate proof is passed as an OpenArt reference.',
      'Nano Banana Pro is first; Sunburst only after owner rejection of the primary proof.',
      'One proof first after visual-pipeline changes; never batch before owner visual acceptance.',
      'On-image WhatsApp CTA is visual; Meta clickable CTA/destination is separate.',
    ];
    base.forbidden.push(...state.brand.ads.do_not_use);
    base.stopConditions = [
      'Stop if projectId is missing or different.',
      'Stop if reference count is not exactly two for Photo A proof.',
      'Stop if any reference ID is outside the allowlist.',
      'Stop before Photo B jobs until its exact OpenArt upload ID and hash are registered.',
      'Stop after one proof for owner visual acceptance.',
    ];
    base.effects.generateImage = mode === 'execute';
  }

  return ExecutionContractSchema.parse(base);
}

export function assertCreativeContract(contract) {
  if (!['ad_creative', 'website_hero'].includes(contract.domain)) return;
  const refs = contract.rendering.visualReferences;
  const ids = refs.map((r) => r.id);
  if (contract.exactAssets.project.id !== OPENART_PROJECT) throw new Error('Wrong OpenArt project');
  if (!sameValues(ids, PHOTO_A_REFERENCE_IDS)) throw new Error(`Wrong OpenArt reference contract: ${ids.join(',')}`);
  if (contract.rendering.noChaining !== true) throw new Error('Generated-reference chaining is forbidden');
  assertSafeEffects(contract);

  if (contract.domain === 'website_hero') {
    if (contract.rendering.type !== 'static_art_plate_plus_live_html') throw new Error('Website hero must use a static art plate plus live HTML');
    if (!sameValues(contract.layering.liveOrder, WEBSITE_LIVE_ORDER)) throw new Error('Wrong website live-layer order');
    if (!sameValues(contract.rendering.staticPlate, WEBSITE_STATIC_PLATE)) throw new Error('Static hero plate allowlist drifted');
    if (!contract.rendering.desktopRule.includes('no photo-left/text-right') || !contract.rendering.desktopTarget.includes('centered UI-free')) {
      throw new Error('Side-split desktop hero is forbidden');
    }
    if (!contract.rendering.mobileTarget.includes('centered UI-free')) throw new Error('Mobile hero plate must be centered and UI-free');
    if (!contract.rendering.cssArtDirection.startsWith('forbidden;')) throw new Error('CSS-generated hero art direction is forbidden');
    if (!sameValues(contract.rendering.generatedUIForbidden, [
      'toolbar/header', 'Life Skills wordmark or logo', 'headline', 'service line', 'age line',
      'WhatsApp button or WhatsApp glyph', 'benefit icons or labels', 'navigation', 'language switch', 'hamburger',
    ])) throw new Error('Static hero plate UI boundary drifted');
    const button = contract.layering.whatsappButton;
    if (!button || button.href !== 'https://wa.me/972534932631'
      || button.en !== 'Message on WhatsApp' || button.he !== 'שלחו הודעה בוואטסאפ'
      || button.min_height_px !== 54 || button.desktop_min_height_px !== 58
      || button.radius_px !== 999 || button.padding_inline_px !== 24
      || button.background !== 'linear-gradient(135deg,#0A5E50 0%,#024942 100%)') {
      throw new Error('Wrong website WhatsApp anchor');
    }
    if (!contract.layering.header.both_locales.includes('separate live Life Skills wordmark')
      || contract.layering.header.he !== 'brand right; EN and hamburger left'
      || contract.layering.header.en !== 'brand left; HE and hamburger right') {
      throw new Error('Life Skills toolbar must remain live and locale-mirrored');
    }
    if (!sameValues(contract.layering.benefits.en, WEBSITE_BENEFITS_EN)
      || !sameValues(contract.layering.benefits.he, WEBSITE_BENEFITS_HE)
      || !sameValues(contract.layering.benefits.icons, WEBSITE_BENEFIT_ICONS)) {
      throw new Error('Website benefit contract drifted');
    }
  }

  if (contract.domain === 'ad_creative') {
    if (contract.rendering.primary.id !== 'nano-banana-pro'
      || contract.rendering.primary.mode !== 'image2image'
      || contract.rendering.primary.resolution !== '2K') {
      throw new Error('Wrong OpenArt primary model contract');
    }
    if (!sameValues(contract.rendering.referenceAllowlist, PHOTO_A_REFERENCE_IDS)
      || ids.some((id) => !contract.rendering.referenceAllowlist.includes(id))) {
      throw new Error('OpenArt reference allowlist drifted');
    }
    if (contract.exactAssets.logoPostComposite.allowed_as_reference !== false) throw new Error('Logo cannot be an image-model reference');
    if (!contract.layering.rasterCta.required_current_family
      || contract.layering.rasterCta.en !== 'Message on WhatsApp'
      || contract.layering.rasterCta.he !== 'שלחו הודעה בוואטסאפ'
      || contract.layering.metaInteraction.platform_cta_is_separate !== true
      || contract.layering.metaInteraction.raster_is_not_clickable !== true) {
      throw new Error('Ad raster and Meta CTA boundaries drifted');
    }
  }
}
