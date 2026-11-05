/** Derived current Brand placement projection. Null means a real unresolved original, never a substitute. */
export const trip390LearningAssets=[
  {
    "assetId": "GEAR-CONVENTIONAL-REEL-D",
    "src": "?academy-image=reel",
    "filePath": "/groups/academy/skills/golden_reel_on_a_sunlit_coastal_bridge.png",
    "alt": {
      "en": "Fishing rod with a conventional reel.",
      "he": "חכה עם רולר קונבנציונלי."
    }
  },
  {
    "assetId": "GEAR-KNOT-01-D",
    "src": null,
    "alt": {
      "en": "Close-up illustration of a fishing knot.",
      "he": "איור תקריב של קשר דיג."
    }
  },
  {
    "assetId": "GEAR-HOOKS-01-D",
    "src": "?academy-image=hooks",
    "filePath": "/groups/academy/skills/sunlit_fishing_tackle_by_the_sea.png",
    "alt": {
      "en": "Fishing hooks and tackle arranged by the water.",
      "he": "קרסים וציוד דיג מסודרים ליד המים."
    }
  },
  {
    "assetId": "GEAR-RIG-READY-D",
    "src": null,
    "alt": {
      "en": "Fishing setup ready for use by the water.",
      "he": "מערך דיג מוכן לשימוש ליד המים."
    }
  },
  {
    "assetId": "FISH-TARPON-STRIKE-D",
    "src": "/groups/academy/scenes/advanced.webp",
    "alt": {
      "en": "Tarpon feeding near the water’s surface, an illustration.",
      "he": "איור של דג טרפון הניזון סמוך לפני המים."
    }
  },
  {
    "assetId": "GEAR-ORGANIZED-02-D",
    "src": null,
    "alt": {
      "en": "Fishing tackle arranged neatly for use and storage.",
      "he": "ציוד דיג מסודר לשימוש ולאחסון."
    }
  }
] as const;
export const trip390LearningImagesReady=trip390LearningAssets.every(asset=>asset.src!==null);

// These exact landing-page image representations retain their original public bytes.
export const trip390SkillFiles=trip390LearningAssets.filter(asset=>'filePath' in asset);
