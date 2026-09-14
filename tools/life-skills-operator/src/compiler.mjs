import { ExecutionContractSchema } from './contracts.mjs';
import { findAdCopy, findAsset } from './state.mjs';

const REQUIRED_READS = [
  'creative/manifests/brand.json',
  'creative/manifests/assets.json',
  'creative/manifests/copy.json',
  'creative/manifests/production-policy.json',
  'creative/manifests/website-hero-masters.json',
];

const FULL_STATIC_AD_LAYERS = [
  'approved photograph',
  'approved on-image copy',
  'approved logo',
  'service and age',
  'three labeled benefit icons',
  'baked visual WhatsApp CTA',
];

function assertNoUnsafeEffects(contract) {
  if (
    contract.effects.publish
    || contract.effects.deploy
    || contract.effects.providerMutation
    || contract.effects.sendMessages
    || contract.effects.automaticWhatsAppReplies
  ) {
    throw new Error('Operator contract cannot authorize publish, deploy, provider configuration or messaging');
  }
  if (contract.mode === 'plan' && (contract.effects.generateImage || contract.effects.spend)) {
    throw new Error('Local plan cannot generate images or spend credits');
  }
}

function websiteContract(base, state) {
  const masters = state.websiteMasters.masters.map(({ id, locale, orientation, status, asset, controls }) => ({
    id, locale, orientation, status, asset, controls,
  }));
  return {
    ...base,
    exactAssets: { masters },
    rendering: {
      type: 'exact_registered_raster_master',
      responsiveSelection: 'locale plus orientation',
      proportionalScalingOnly: true,
      assetReencoding: false,
      cssRecolor: false,
      crop: false,
      visibleRasterLayers: state.policy.website.baked_layers,
    },
    layering: {
      visibleLiveLayers: state.policy.website.visible_live_layers,
      hiddenSemantics: state.policy.website.hidden_semantics,
      whatsappBounds: masters.map((master) => ({ id: master.id, bounds: master.controls.whatsapp.bounds })),
    },
    copy: { website: state.copy.website, whatsapp: state.copy.whatsapp },
    validations: [
      'Selected bytes match the registered SHA256 and intrinsic dimensions.',
      'Visible headline, service, age, photograph, benefit icons and labels come from the approved raster.',
      'Only header/toolbar and the real WhatsApp anchor are visible live layers.',
      'No recolor, mirror, crop, re-encode or visible copy/icon reconstruction.',
    ],
    forbidden: [...base.forbidden, 'OpenArt generation for an already approved website hero master'],
    stopConditions: [...base.stopConditions, 'Stop if the selected master is not OWNER_APPROVED_MASTER.'],
  };
}

function adContract(base, intent, state) {
  const surface = intent.creativeSurface === 'unspecified' ? 'full_static_ad' : intent.creativeSurface;
  if (!['full_static_ad', 'link_preview_card', 'organic_card'].includes(surface)) {
    throw new Error(`Invalid ad creative surface: ${surface}`);
  }

  if (surface !== 'full_static_ad') {
    const unresolved = [
      ...base.unresolved,
      `No canonical ${surface} master is registered in creative/manifests/** at this commit.`,
    ];
    return {
      ...base,
      creativeSurface: surface,
      exactAssets: { surfaceMaster: null },
      rendering: {
        surface,
        fullStaticAdMaster: false,
        rule: 'A link-preview or organic card follows its own recorded asset approval; it is never promoted to a full static-ad master.',
        mayBeSimplerThanFullStaticAd: true,
      },
      layering: {
        rule: 'Do not infer the full-ad service, age, three benefit labels/icons or baked WhatsApp CTA for a simpler card.',
      },
      copy: {},
      unresolved,
      validations: [
        'Resolve the exact approved surface-specific asset or saved provider receipt before execution.',
        'Never use a link-preview or organic card as a full static-ad ratio or localization master.',
        'Resume a saved provider history before considering any new submission.',
      ],
      stopConditions: [
        ...base.stopConditions,
        ...unresolved.map((item) => `Block production: ${item}`),
      ],
    };
  }

  const copy = intent.conceptId ? findAdCopy(state, intent.conceptId) : null;
  const photo = intent.photoId ? findAsset(state, intent.photoId) : null;
  const fullStaticMaster = state.assets.assets.find((asset) => (
    asset.kind === 'approved_full_static_ad_master'
    && (!asset.locale || asset.locale === intent.locale)
    && (!asset.placement || asset.placement === intent.format)
  )) || null;
  const queue = state.monthlyQueue;
  const unresolved = [...base.unresolved];
  if (!fullStaticMaster) unresolved.push('No approved full static-ad master is registered for this locale and placement.');
  if (!copy) unresolved.push('A registered conceptId is required.');
  if (copy && (copy.allowProduction === false || copy.finalBilingualRasterApproval === false)) {
    unresolved.push(`Copy ${copy.id} is not approved for production.`);
  }
  if (!photo) unresolved.push('A registered photoId is required.');
  if (intent.photoId === 'LS-PHOTO-B') unresolved.push('Photo B has no verified OpenArt upload binding.');
  if (queue.execution.creditCap == null) unresolved.push('No explicit image-credit cap is registered.');
  if (!queue.execution.model || !queue.execution.providerProjectId) unresolved.push('Provider/model execution settings are not promoted in the queue.');

  return {
    ...base,
    creativeSurface: surface,
    exactAssets: {
      fullStaticMaster,
      concept: copy,
      photo,
      styleReference: findAsset(state, 'LS-AD-VISUAL-REFERENCE-APPROVED-20260910'),
      approvedLogo: findAsset(state, 'LS-LOGO-HE-LEAF-01'),
    },
    rendering: {
      providerPolicy: state.policy.openart,
      ratios: state.policy.bulk.ratios,
      deduplicationKey: state.policy.bulk.deduplicationKey,
      exactPixelLockAvailable: state.policy.openart.exactPixelLockAvailable,
      fullStaticAdMaster: true,
      requiredRasterLayers: FULL_STATIC_AD_LAYERS,
    },
    layering: {
      rule: 'A full static ad is one finished raster containing the approved photograph, copy, logo, service/age, all three labeled benefit icons and baked visual WhatsApp CTA. The platform supplies the actual clickable destination.',
    },
    copy: { concept: copy, locale: intent.locale },
    unresolved,
    validations: [
      'Resolve exact private provider bindings at runtime; do not persist them in public Git.',
      'Quote the exact job before submit and compare it with the explicit image-credit cap.',
      'Persist history ID before polling and never resubmit an ambiguous request.',
      'One checked proof precedes any batch after a visual-policy change.',
      'Do not substitute a simpler link-preview or organic card for a full static-ad master.',
    ],
    stopConditions: [
      ...base.stopConditions,
      ...unresolved.map((item) => `Block production: ${item}`),
    ],
  };
}

export function compileContract(intent, state, options = {}) {
  const mode = options.mode || 'plan';
  const method = options.intentMethod || 'structured_local';
  const base = {
    schemaVersion: 2,
    mode,
    classification: intent.classification,
    domain: intent.domain,
    creativeSurface: intent.domain === 'website_hero'
      ? 'website_hero'
      : intent.creativeSurface,
    outcome: intent.summary,
    intentResolution: { method, modelCalls: method === 'model_interpretation' ? 1 : 0 },
    requiredReads: REQUIRED_READS,
    exactAssets: {}, rendering: {}, layering: {}, copy: {},
    proposedDiff: intent.changes,
    preserve: intent.preserve,
    unresolved: intent.unresolved,
    validations: [],
    forbidden: ['Unapproved asset substitution', 'Silent canonical-source mutation'],
    stopConditions: [],
    effects: {
      generateImage: false,
      publish: false,
      spend: false,
      deploy: false,
      providerMutation: false,
      sendMessages: false,
      automaticWhatsAppReplies: false,
    },
  };
  const compiled = intent.domain === 'website_hero'
    ? websiteContract(base, state)
    : intent.domain === 'ad_creative'
      ? adContract(base, intent, state)
      : base;
  return ExecutionContractSchema.parse(compiled);
}

export function assertCreativeContract(contract) {
  assertNoUnsafeEffects(contract);
  if (contract.domain === 'website_hero') {
    if (contract.rendering.type !== 'exact_registered_raster_master') throw new Error('Website must consume an exact approved raster master');
    if (contract.layering.visibleLiveLayers.join(',') !== 'header,whatsapp') throw new Error('Website visible live-layer boundary drifted');
    if (contract.exactAssets.masters.length !== 4 || contract.exactAssets.masters.some((master) => master.status !== 'OWNER_APPROVED_MASTER')) {
      throw new Error('Four approved website masters are required');
    }
  }
  if (contract.domain === 'ad_creative' && contract.mode === 'execute' && contract.unresolved.length) {
    throw new Error(`Ad execution blocked: ${contract.unresolved.join(' | ')}`);
  }
  if (contract.domain === 'ad_creative' && contract.creativeSurface === 'full_static_ad') {
    if (contract.rendering.fullStaticAdMaster !== true) throw new Error('Full static-ad boundary drifted');
    if (contract.rendering.requiredRasterLayers.join(',') !== FULL_STATIC_AD_LAYERS.join(',')) {
      throw new Error('Full static-ad raster layer contract drifted');
    }
  }
}
