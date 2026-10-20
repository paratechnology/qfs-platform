Objective
- Clone https://q-ledgerpro.live/ (a WordPress/Elementor "Deroly"-family QFS landing page) as a Next.js app in D:\qfs, matching its design, fonts, text, and scroll animations exactly.
Requirements
- Same scroll animations (fadeInUp/fadeIn with per-element delays), fonts (DM Sans), colors, gradients, and copy as the original.
- Use images already in D:\qfs\public; reference D:\qfs\qfs1 (full saved copy) for anything missing.
- Build in Next.js on this machine (Node v24.21.0, npm 11.19.0 verified).
Decisions
- D:\qfs is the Next.js project root; existing public/ used directly; qfs1/ untouched as reference.
- App Router; DM Sans via next/font/google (weights 400/500); plain <img> tags (not next/image) for fidelity; planned deps next@15.1.6, react@19.0.0.
- Scroll reveal via client Reveal component (IntersectionObserver) adding .animated fadeInUp/fadeIn with inline animation-delay.
- Live site blocks curl/webfetch (403); saved qfs1 HTML is authoritative.
- Missing originals already replaced in public/: icons icon2_1-recovery.svg/icon2_4-humanitarian.svg, banners/xrp-banner.svg + banners/how-it-works.svg (replace xrp-banner-1.jpg, 2149220702-1.jpg), get-started/card.png (user's screenshot copy), patterns/lines.svg + lines-footer.svg, avatars/avatar4.jpg (crop substituting the 404 hero avatar #1).
- CORRECTION vs earlier note: features (06b8e09) and services (db94b79) sections have NO background in CSS → white (body is background:#fff). Only why-choose/progress/how-we-work are #F8F8F8; get-started #0F0F0F; hero/footer/about-block #000.
- Header "Log In" button (732efd5) is a transparent white-text arrow button (NOT a gradient button; the gradient bd64548 button is empty/unused in the original).
- Section 34d41bf (#F8F8F8, z-4) exists in CSS but is absent from saved HTML — skip it.
Work State
Completed
- Read full saved HTML (lines 484–1997): all copy captured (header nav, hero, features, about, services, why-choose, progress, how-we-work, get-started, footer, copyright bar, footer link lists).
- Extracted complete design system from post-366446644-16644.css, post-47741e741e-1741e.css, post-446741e741e-1741e.css, post-448741e741e-1741e.css, widget-styles459e459e-1459e.css.
- Verified asset matches in public/: carousel card1–4.jpg == 4 original carousel jpgs; avatar1–3.jpg == 3 original hero avatars; avatar4.jpg == crop replacement; all card/award/logo/icon files present.
- Confirmed section backgrounds, paddings, button variants, skill-bar styles, glow-btn ripple, divider widths (70px #00000033 1.2px), etc. (details in Important Context).
Active
- Next.js scaffolding in D:\qfs has NOT been created (root has only public/ and qfs1/).
Blocked
- (none)
Next Move
1. Scaffold project: package.json, next.config.mjs, tsconfig.json, app/layout.tsx (metadata title "QFS – Your Financial Freedom Begins here", description from twitter meta), app/globals.css with all design tokens/utilities below, then npm install.
2. Build components/Reveal.tsx and components/icons.tsx (inline SVGs: right-arrow, right-arrow1, play, credit-card, coins1, credit-card1, growth, house-1, finance-book, document, customer-service, bubble, socials facebook/twitter/youtube/linkedin).
3. Build components: Header.tsx (black, logo 75% + right border #FFFFFF52, nav Home(active)/About(#about)/Services(#services)/Contact(#contact)/Connect Wallet/Login/Register + transparent white "Log In" arrow btn; mobile hamburger panel w/ logo_Asset-7), Hero.tsx, Features.tsx, About.tsx, Services.tsx, WhyChoose.tsx, ProgressBars.tsx, HowWeWork.tsx, GetStarted.tsx, Footer.tsx; wire into app/page.tsx with anchor ids #about/#services/#contact.
4. Copy exact text (incl. support@Qledgerpro.live, "Copyright © 2025 Qledgerpro.live", footer let's-talk/quicklinks/support lists) and stagger delays per section (hero 0/200/400/600/800; features 0/100/200/300 + label/h2 0/200 block 400; about 0/200/400 + cols 400/500 + carousel 600; services 0/200 + cards 400/500/600; why-choose 0/200 + 400/500; how-we-work rows 400/500/600; get-started 0/200/400).
5. npm run build then next dev; browser-preview to sanity-check layout.
Relevant Files
- D:\qfs\qfs1\QFS – Your Financial Freedom Begins here.html: full saved page (authoritative copy/structure).
- D:\qfs\qfs1\QFS – Your Financial Freedom Begins here_files\post-47741e741e-1741e.css: all page-section styles/paddings/hovers.
- D:\qfs\qfs1\QFS – Your Financial Freedom Begins here_files\post-366446644-16644.css: global tokens + responsive font sizes (65/45/25/21/19/16/15/13px typography).
- D:\qfs\qfs1\QFS – Your Financial Freedom Begins here_files\post-446741e741e-1741e.css: header styles (minified; logo border, Log In button).
- D:\qfs\qfs1\QFS – Your Financial Freedom Begins here_files\post-448741e741e-1741e.css: footer styles (col headings, link colors, copyright bar).
- D:\qfs\qfs1\QFS – Your Financial Freedom Begins here_files\widget-styles459e459e-1459e.css: .glow-btn ripple (3s infinite, ::after .3s, ::before .9s, opacity .6, color rgba(255,255,255,.5)).
- D:\qfs\public\: all site images (cards/cc1-3, logo/Asset-5+7, avatars/1-4, award, carousel/1-4, icons/2_1-2_4, banners/, patterns/, get-started/card.png, people/Screenshot…).
Important Context
- Design tokens: --primary:#000000; --accent:#992c92; --accent2:#a3309c; --text:#7A7A7A; --bg-soft:#F8F8F8; --bg-dark:#0F0F0F. DM Sans: h1 65/1.2/400, h2 45/1.4/400, h3 25/1.5, h4 21/1.6 (all #000), body 15/1.8 #7A7A7A, label 5b71a98 15/500 uppercase ls 5px, subtitle 3b3c285 13/500 uppercase ls 1px, buttons 14/500.
- Buttons (radius 30): hero Connect Wallet & Get-Started "Get Started" = linear-gradient(60deg,#992c92,#E1FF63) black text, padding 15px 32px; standard gradient (features Get Started, QFS Manual) = linear-gradient(60deg,#992c92,#a3309c) black text; arrow buttons (Join Us/Login/Contact Us/header Log In) = transparent white text + right-arrow icon, hover #992c92, margin-left 20px.
- Hero: black + public/patterns/lines.svg overlay (opacity .14, bottom center, cover); left col padding 120px 0 70px; label accent "Quantum Financial System"; h1 white; bordered text block (border-left 1px #fff, padding 0 0 5px 30px, color #DADADA, margin-right 200px, buttons row margin-bottom 70px); avatars 45px circles border:2px solid #000, overlap -15px; counter 45px white "12.5M+" animated 2000ms (margin -12px 0 -13px 20px); "World Enrolled Users" #DADADA + 9px accent dot; award 48px img + 185px text "2025 The ' Best QFS Platform"; right col cards: cc1 90% right z5 mb-200 → cc3 80% center z4 mb-200 → cc2 84% right z3 mb-62, col padding-top 20px.
- Features (white, 100px pads): 2x2 boxes — Asset Protection black (pad 50px 50px 50px 40px, widget margin -20px 0 0 -20px), others white border:1px solid #00000012, pad 40px, hover bg black + title white + p #EAEAEA; icon 60px, title 21px mb 15px; right col margin-left 100px: label #9F9F9F "QFS is Coming!", h2 "Get Ready for revolutionary Financial System QFS Nesara Official" (mb 10px), bordered block (border-left #000, pad-left 30px) + Get Started/Login buttons.
- About (black block, pad 100px 100px 30px): label accent + h2 white "Quantum Financial System"; right-aligned "QFS Manual" btn → https://q-ledgerpro.live/Original%20Nesara%20PDF-1.pdf; 2 text cols #DADADA with border-bottom:1px solid #fff, 30px gaps, pad-bottom 30px, row mb 70px; carousel margin 0 -100px -5px -100px, 3-up autoplay 5s, 4 images (card1–4.jpg).
- Services (white, 100px pads): centered label #9F9F9F "Our Services"; h2 "ISO20022: GLOBAL ECONOMIC SECURITY AND REFORMATION ACT" (margin 0 250px 50px 250px); 6 cards (Wallet Security/Stolen & Asset Recovery/Sync Your Wallet/Humanitarian Project/Assets & Conversion/Decentralization) pad 40px, icon 45px black→#992c92 hover, p mb 30px, 50px-circle gradient arrow button (pad 15px 13px 15px 17px, icon 20px), hover card→black.
- Why Choose (#F8F8F8, 100px pads): left col xrp-banner.svg bg cover pad 30px align-end; play btn 80px white, border:1px solid #FFFFFF78, icon 29px, hover bg #992c92, ripple color rgba(255,255,255,.5); right col margin 70px 0 70px 50px; rows mb 50px; h3 25px w/ 70px #00000033 divider (1.2px, pad 5px); p margins -5px 0 -15px.
- Progress (#F8F8F8, pad 0 0 100px): cols 50px apart; label uppercase 13px ls1; track 3px #000; fill linear-gradient(60deg,#992c92,#a3309c); values Sync 90 / Decentralization 85 / Security 99 / Transparency 95, animate on view 3.5s.
- How We Work (#F8F8F8, 100px pads): left col how-it-works.svg cover, margin-right 50px, top 30px divider spacer; right col margin 50px 0 50px 50px; label #9F9F9F + h2 "QUANTUM FINANCIAL SYSTEM" (mb 50px); 3 rows (Step 01/02/03 headings + 40px black icon + content box border:1px solid #0000001A pad 30px 35px, hover border accent), rows mb 20px.
- Get Started (#0F0F0F, pad 50px 0 0): label accent, h2 white "Your Financial Freedom Begins here", p #DADADA margin-right 200px, left col pad-bottom 100px; buttons Get Started (accent→#E1FF63) + Contact Us (arrow); right col card.png 55% centered, slow fade.
- Footer (black, pad 100px 0, lines-footer overlay opacity .15 top center cover): logo 77% + tagline #DADADA + socials (transparent, 14px, white→#992c92 hover); right 2/3 cols: Quicklinks (Home/About/Services/Contact/Login), Email (support@Qledgerpro.live) + Support (Help Center/Privacy Policy/Disclaimer/FAQs/Contact), Let's Talk! (p + Live Chat underline button border-bottom:#992c92 pad 0 0 4px, hover border #CEFF0C); headings white 21px; links #DADADA→accent; copyright bar border-top:1px solid #E2E5F133 pad 15px, left white "Copyright © 2025 Qledgerpro.live", right text buttons Privacy Policy + Terms & Services.
- Elementor nav-link defaults found only generically; use summary values (13px/500 uppercase ls 1px, #FFFFFF80, hover #992c92, active white, nav padding 0 25px).
- Linked URLs: /user/user/connect (Connect Wallet), /user/user/login, /user/user/register; socials + footer links point to https://q-ledgerpro.live/# (placeholders).