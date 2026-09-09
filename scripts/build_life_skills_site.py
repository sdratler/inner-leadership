#!/usr/bin/env python3
"""LS-105 prepared central wiring: an allowlisted public-only static build.
Install exactly as scripts/build_life_skills_site.py after ownership/preflight.
No dependencies, legacy page generator, app files, credentials, or external calls.
Production requires verified details AND separate actual deployment authorization.
Config flags are checks, not evidence that legal/photo/operator approvals exist.
"""
from __future__ import annotations
import argparse, hashlib, json, re, shutil, subprocess, sys
from pathlib import Path

VERSIONED_ASSETS=('assets/css/site.css','assets/js/config.js','assets/js/site-react.js')
PUBLIC_ASSETS=(
    *VERSIONED_ASSETS,
    'assets/js/site.js',
    'assets/fonts/FrankRuhlLibre-wght.ttf',
    'assets/fonts/Heebo-wght.ttf',
    'assets/fonts/OFL-Frank-Ruhl-Libre.txt',
    'assets/fonts/OFL-Heebo.txt',
    'assets/images/founder-boy-hero-desktop.webp',
    'assets/images/founder-boy-hero-mobile.webp',
    'assets/images/founder-grass-group.webp',
    'assets/images/l-bars-2024.png',
    'assets/images/meir-bunny.png',
    'assets/images/bna-logo-nobg.png',
    'assets/images/v43-approved-twig.png',
    'assets/images/LS-WEB-04__p03__r01.webp',
    'assets/images/LS-CUR-W02__p03__r01.webp',
    'assets/images/LS-CUR-W03__p02__r01.webp',
    'assets/images/LS-CUR-W04__p03__r01.webp',
    'assets/images/LS-CUR-W07__p03__r01.webp',
    'assets/images/LS-CUR-W09__p03__r01.webp',
    'assets/images/LS-CUR-W10__p03__r01.webp',
    'assets/images/LS-CUR-W11__p03__r01.webp',
    'assets/images/LS-WEB-02__p02__r01.webp',
    'assets/images/LS-WEB-03__p03__r01.webp',
    'assets/images/LS-AD-A07__p03__r01.webp',
    'assets/icons/self-governance.svg',
    'assets/icons/emotional-regulation.svg',
    'assets/icons/responsibility.svg',
    'assets/icons/parent-guidance.svg',
)

def config_result(root: Path) -> dict:
    script = r'''
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=process.argv[1],sandbox={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'assets/js/config.js'),'utf8'),sandbox,{timeout:1000});
const api=require(path.join(root,'assets/js/site.js'));
const config=sandbox.window.LIFE_SKILLS_CONFIG || {};
console.log(JSON.stringify({config,photo:api.photoPath(config),problems:api.publicationProblems(config)}));
'''
    run=subprocess.run(['node','-e',script,str(root.resolve())],capture_output=True,text=True,timeout=5,check=True)
    return json.loads(run.stdout)

def build(root: Path, production: bool=False) -> dict:
    root=root.resolve();dest=root/'dist/site';disabled=root/'dist/disabled-functions'
    # Only generated, fixed paths may be replaced; never follow symlinks into private storage.
    for p in [root/'dist',dest,disabled]:
        if p.is_symlink():raise ValueError('SYMLINK_OUTPUT_DENIED')
    if dest.exists():
        # Windows may preserve a read-only directory bit after local preview use.
        for candidate in sorted(dest.rglob('*'),key=lambda p:len(p.parts),reverse=True):
            if not candidate.is_symlink():candidate.chmod(0o700)
        dest.chmod(0o700);shutil.rmtree(dest)
    info=config_result(root)
    problems=list(info['problems'])
    testimonial_public = (
        info['config'].get('testimonialConsentOwnerConfirmed') is True
        and info['config'].get('testimonialConsentReference') == 'LS-LB-CONSENT-20260909-001'
    )
    if info['config'].get('privateTestimonialPreview') is True and not testimonial_public:
        problems.append('PRIVATE_TESTIMONIAL_CONSENT_UNVERIFIED')
    photo=info['photo']
    if photo:
        src=root/photo
        if not src.is_file() or src.is_symlink() or root not in src.resolve().parents:
            problems.append('APPROVED_PHOTO_FILE_MISSING_OR_UNSAFE')
        elif src.stat().st_size>8*1024*1024:
            problems.append('APPROVED_PHOTO_TOO_LARGE')
    if production and problems:
        raise ValueError('PUBLICATION_BLOCKED: '+','.join(problems))
    dest.mkdir(parents=True);disabled.mkdir(parents=True,exist_ok=True)
    if any(disabled.iterdir()):raise ValueError('DISABLED_FUNCTION_DIRECTORY_NOT_EMPTY')
    for relative in ['index.html',*PUBLIC_ASSETS]:
        src=root/relative
        if not src.is_file() or src.is_symlink() or root not in src.resolve().parents:
            raise ValueError('UNSAFE_OR_MISSING_PUBLIC_SOURCE')
        target=dest/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,target)
    if production:
        config_path=dest/'assets/js/config.js'
        public_config=config_path.read_text(encoding='utf-8').replace('reviewPreview: true','reviewPreview: false')
        if public_config == config_path.read_text(encoding='utf-8'):
            raise ValueError('PUBLIC_REVIEW_FLAG_NOT_FOUND')
        config_path.write_text(public_config,encoding='utf-8')
    if photo and photo not in PUBLIC_ASSETS:
        raise ValueError('APPROVED_PHOTO_NOT_IN_PUBLIC_ASSET_MANIFEST')
    html=(dest/'index.html').read_text(encoding='utf-8')
    # Bust old year-long immutable legacy caches without introducing a remote asset service.
    for relative in VERSIONED_ASSETS:
        digest=hashlib.sha256((dest/relative).read_bytes()).hexdigest()[:12]
        html=re.sub(re.escape(relative)+r'(?:\?v=[a-zA-Z0-9_-]+)?(?=")',relative+'?v='+digest,html)
    if production:
        html=html.replace('content="noindex, nofollow"','content="index, follow"')
        html=html.replace('יש להפעיל JavaScript כדי לראות את תצוגת האתר. Enable JavaScript to view this website preview.',
                          'יש להפעיל JavaScript כדי לראות את האתר. Enable JavaScript to view this website.')
    (dest/'index.html').write_text(html,encoding='utf-8')
    (dest/'404.html').write_text('''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>Page not found | Life Skills</title><link rel="stylesheet" href="assets/css/site.css"></head><body><main class="container section"><h1>Page not found</h1><p><a href="./?lang=en">Return to Life Skills</a></p><p lang="he" dir="rtl"><a href="./?lang=he">חזרה לעמוד של Life Skills</a></p></main></body></html>''',encoding='utf-8')
    referenced=set()
    for source in (html,(dest/'assets/js/config.js').read_text(encoding='utf-8')):
        referenced.update(re.findall(r'assets/[A-Za-z0-9_./-]+\.(?:css|js|jpe?g|png|webp|svg)',source))
    missing=sorted(relative for relative in referenced if not (dest/relative).is_file())
    if missing:
        raise ValueError('REFERENCED_PUBLIC_ASSET_MISSING: '+','.join(missing))
    (dest/'robots.txt').write_text('User-agent: *\n'+('Allow: /\n' if production else 'Disallow: /\n'),encoding='utf-8')
    files=sorted(p.relative_to(dest).as_posix() for p in dest.rglob('*') if p.is_file())
    result={'mode':'production' if production else 'review-preview','files':files,'publication_blockers':problems,
       'no_deployment_performed':True,'no_function_bundle':True}
    # Neutral metadata only, outside the publicly published directory.
    (root/'dist/site-build-report.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    return result

def main() -> int:
    ap=argparse.ArgumentParser();ap.add_argument('--production',action='store_true');a=ap.parse_args()
    try:print(json.dumps(build(Path(__file__).resolve().parents[1],a.production),indent=2));return 0
    except (ValueError,OSError,subprocess.SubprocessError,json.JSONDecodeError) as exc:
        print('STATIC_BUILD_BLOCKED: '+str(exc),file=sys.stderr);return 3
if __name__=='__main__':raise SystemExit(main())
