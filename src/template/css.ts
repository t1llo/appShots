const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .9 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#000;overflow:hidden}
.canvas{position:relative;overflow:hidden;display:flex;flex-direction:column;align-items:center;color:var(--text);font-family:var(--body);font-synthesis:none;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.bg,.noise{position:absolute;inset:0}
.noise{background-image:${NOISE};mix-blend-mode:overlay}
.copy{position:relative;z-index:2;flex:none;width:100%;padding:calc(var(--u)*12.5) calc(var(--u)*7) 0;display:flex;flex-direction:column;align-items:center;text-align:center}
.align-left .copy{align-items:flex-start;text-align:start;padding-inline:calc(var(--u)*8)}
.eyebrow{font-size:calc(var(--u)*3.1*var(--ts));font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:calc(var(--u)*2.6)}
.eyebrow.muted{color:var(--text);opacity:.7}
.headline{max-width:100%;font-family:var(--font);font-size:calc(var(--u)*10.8*var(--ts)*var(--fs));font-weight:var(--hw);line-height:1.05;letter-spacing:var(--track);text-wrap:balance}
.headline em{font-style:normal;color:var(--accent)}
.headline.two-tone{color:color-mix(in srgb,var(--text) 58%,transparent)}
.headline.two-tone em{color:var(--text)}
.sub{font-size:calc(var(--u)*4.3*var(--ts));font-weight:500;line-height:1.27;letter-spacing:-.01em;opacity:.8;margin-top:calc(var(--u)*2.9);max-width:calc(var(--u)*82);text-wrap:balance}
.stage{position:relative;z-index:1;flex:1 1 0;min-height:0;width:100%;display:flex;justify-content:center;align-items:flex-start;padding-top:calc(var(--u)*6.5)}
.stage.fits{align-items:center;padding-bottom:calc(var(--u)*6.5)}
.layout-device-top{flex-direction:column-reverse}
.layout-device-top .copy{padding-top:0;padding-bottom:calc(var(--u)*11.5)}
.layout-device-top .stage{align-items:flex-end;padding:0 0 calc(var(--u)*6.5)}
.layout-device-top .stage.fits{align-items:center;padding-top:calc(var(--u)*6.5)}
.layout-device-center .stage,.layout-floating .stage{align-items:center;padding:calc(var(--u)*5.5) 0 calc(var(--u)*9)}
.stage.multi{display:block}
.stage.multi .device{position:absolute;left:50%}
.no-device{justify-content:center}
.no-device .copy{padding-top:0;padding-bottom:0}
.defs{position:absolute;width:0;height:0}
.dark{--card:color-mix(in srgb,#fff 9%,transparent);--card-line:rgba(255,255,255,.13);--card-shadow:0 0 0 transparent}
.light{--card:rgba(255,255,255,.66);--card-line:rgba(255,255,255,.7);--card-shadow:0 calc(var(--u)*.9) calc(var(--u)*3.2) rgba(20,20,40,.08)}
.board{justify-content:center;padding:calc(var(--u)*11) 0}
.board .copy{padding-top:0}
.features{position:relative;z-index:1;flex:0 1 auto;min-height:0;width:100%;display:flex;justify-content:center;padding:calc(var(--u)*6.5) calc(var(--u)*7) 0}
.features.alone{padding-top:0}
.align-left .features{padding-inline:calc(var(--u)*8)}
.f-grid{--f:calc(var(--u)*var(--fz));flex:1;min-width:0;min-height:0;display:grid}
.fs-cards .f-grid,.fs-list .f-grid{max-width:calc(var(--u)*98)}
.fs-list .f-grid{flex:0 1 auto}
.align-left .features{justify-content:flex-start}
.f-tile{position:relative;overflow:hidden;min-width:0;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:calc(var(--f)*2.3);padding:calc(var(--f)*3.2);border-radius:calc(var(--u)*4.4);background:var(--card);box-shadow:inset 0 0 0 calc(var(--u)*.14) var(--card-line),var(--card-shadow)}
.f-tile.wash{background:linear-gradient(145deg,color-mix(in srgb,var(--c) 30%,transparent),color-mix(in srgb,var(--c) 7%,transparent) 72%),var(--card)}
.f-tile.hero{gap:calc(var(--f)*3)}
.align-left .f-tile{align-items:flex-start;justify-content:space-between;text-align:start}
.f-tile.row{flex-direction:row;align-items:center;justify-content:center;text-align:start;gap:calc(var(--f)*3.2)}
.align-left .f-tile.row,.fs-cards .f-tile,.fs-list .f-tile{justify-content:flex-start}
.f-lead{flex:none;display:flex;align-items:center;justify-content:center;line-height:0}
.f-icon{display:block;height:calc(var(--f)*11);width:auto;fill:var(--g)}
.f-img{display:block;height:calc(var(--f)*13);width:auto;max-width:100%;object-fit:contain}
.f-value{font-family:var(--font);font-size:calc(var(--f)*11*var(--fs));font-weight:var(--hw);line-height:.95;letter-spacing:-.04em;white-space:nowrap;color:transparent;background:linear-gradient(135deg,color-mix(in srgb,var(--c) 60%,var(--text)),var(--c));-webkit-background-clip:text;background-clip:text}
.f-text{min-width:0;display:flex;flex-direction:column;gap:calc(var(--f)*.9)}
.f-title{font-family:var(--font);font-size:calc(var(--f)*4.4*var(--fs));font-weight:var(--hw);line-height:1.08;letter-spacing:var(--track);text-wrap:balance}
.f-title em{font-style:normal;color:var(--c)}
.f-detail{font-size:calc(var(--f)*2.9);font-weight:500;line-height:1.26;letter-spacing:-.005em;opacity:.72;text-wrap:balance}
.f-tile.hero .f-icon{height:calc(var(--f)*16)}
.f-tile.hero .f-img{height:calc(var(--f)*19)}
.f-tile.hero .f-value{font-size:calc(var(--f)*18*var(--fs))}
.f-tile.hero .f-title{font-size:calc(var(--f)*6.2*var(--fs))}
.f-tile.hero .f-detail{font-size:calc(var(--f)*3.4)}
.f-tile.tall .f-icon{height:calc(var(--f)*13.5)}
.f-tile.tall .f-img{height:calc(var(--f)*16)}
.f-tile.tall .f-value{font-size:calc(var(--f)*14*var(--fs))}
.f-tile.tall .f-title,.f-tile.wide .f-title{font-size:calc(var(--f)*4.8*var(--fs))}
.f-tile.wide .f-detail{font-size:calc(var(--f)*3.1)}
.fs-cards .f-tile{padding:calc(var(--f)*2.6) calc(var(--f)*3.2);border-radius:calc(var(--u)*4)}
.fs-cards .f-lead{min-width:calc(var(--f)*11.6);height:calc(var(--f)*11.6);padding:0 calc(var(--f)*2);border-radius:calc(var(--f)*3.1);background:color-mix(in srgb,var(--c) 17%,transparent)}
.fs-cards .f-icon{height:calc(var(--f)*6.4)}
.fs-cards .f-value{font-size:calc(var(--f)*4.8*var(--fs))}
.fs-cards .f-title,.fs-list .f-title{font-size:calc(var(--f)*3.9*var(--fs))}
.fs-cards .f-detail,.fs-list .f-detail{font-size:calc(var(--f)*2.75)}
.fs-list .f-tile{overflow:visible;padding:0;border-radius:0;background:none;box-shadow:none;gap:calc(var(--f)*3.6)}
.fs-list .f-lead{min-width:calc(var(--f)*10)}
.fs-list .f-icon{height:calc(var(--f)*9.4)}
.fs-list .f-value{font-size:calc(var(--f)*6.2*var(--fs))}
.fl-tint .f-tile{background:linear-gradient(145deg,color-mix(in srgb,var(--c) 36%,transparent),color-mix(in srgb,var(--c) 13%,transparent)),var(--card);box-shadow:inset 0 0 0 calc(var(--u)*.14) color-mix(in srgb,var(--c) 36%,transparent),var(--card-shadow)}
.fl-solid .f-tile{color:var(--ci);background:linear-gradient(150deg,color-mix(in srgb,var(--c) 84%,#fff),var(--c));box-shadow:var(--card-shadow)}
.fl-solid .f-icon{fill:var(--ci)}
.fl-solid .f-value{color:var(--ci);background:none}
.fl-solid .f-title em{color:inherit}
.fl-solid .f-detail{opacity:.84}
.fl-outline .f-tile{background:none;box-shadow:inset 0 0 0 calc(var(--u)*.26) color-mix(in srgb,var(--text) 24%,transparent)}
.fl-outline .f-tile.wash{background:none;box-shadow:inset 0 0 0 calc(var(--u)*.34) var(--c)}
.fs-list .f-tile,.fs-list .f-tile.wash{color:inherit;background:none;box-shadow:none}
.fs-list .f-value{color:transparent;background:linear-gradient(135deg,color-mix(in srgb,var(--c) 60%,var(--text)),var(--c));-webkit-background-clip:text;background-clip:text}
.fi-plain .f-icon{fill:var(--text)}
.fl-solid.fi-plain .f-icon,.fs-list.fl-solid.fi-gradient .f-icon{fill:var(--ci)}
.fs-list.fl-solid.fi-gradient .f-icon{fill:var(--g)}
.f-lead.badge{width:calc(var(--f)*13.5);height:calc(var(--f)*13.5);min-width:0;padding:0;border-radius:27%;background:linear-gradient(160deg,color-mix(in srgb,var(--c) 74%,#fff),var(--c));box-shadow:0 calc(var(--f)*.9) calc(var(--f)*2.4) color-mix(in srgb,var(--c) 36%,transparent),inset 0 0 0 calc(var(--f)*.12) rgba(255,255,255,.2)}
.f-lead.badge .f-icon{height:54%;fill:var(--ci)}
.f-tile.hero .f-lead.badge{width:calc(var(--f)*19);height:calc(var(--f)*19)}
.f-tile.tall .f-lead.badge{width:calc(var(--f)*16);height:calc(var(--f)*16)}
.fs-cards .f-lead.badge,.fs-list .f-lead.badge{width:calc(var(--f)*11.6);height:calc(var(--f)*11.6)}
.fl-solid:not(.fs-list) .f-lead.badge{background:var(--ci);box-shadow:none}
.fl-solid:not(.fs-list) .f-lead.badge .f-icon{fill:var(--c)}
.fs-cards .f-lead.art{padding:0;background:none}
.fs-cards .f-img,.fs-list .f-img{height:calc(var(--f)*11.6)}
.f-lead.thumb{width:calc(var(--f)*11.6);height:calc(var(--f)*11.6);min-width:0;padding:0;overflow:hidden;border-radius:calc(var(--f)*2.6);background:#101012;box-shadow:0 0 0 calc(var(--u)*.12) rgba(128,128,128,.3)}
.f-lead.thumb img{display:block;width:100%;height:100%;object-fit:cover;object-position:top center}
.f-tile.pic{justify-content:flex-start;gap:calc(var(--f)*2.8);padding-bottom:0}
.f-tile.pic .f-text{flex:none}
.f-shot{flex:1 1 0;align-self:center;width:72%;min-height:calc(var(--f)*12);container-type:inline-size}
.f-shot.land{width:92%}
.f-shot-in{height:100%;overflow:hidden;border-radius:var(--sr) var(--sr) 0 0;background:#101012;box-shadow:0 0 0 calc(var(--u)*.12) rgba(128,128,128,.3),0 calc(var(--u)*-.4) calc(var(--u)*2.8) rgba(0,0,0,.2)}
.f-shot-in img{display:block;width:100%;height:100%;object-fit:cover;object-position:top center}
.f-tile.pic.row{align-items:stretch;justify-content:space-between}
.f-tile.pic.row .f-text{flex:1 1 0;align-self:center;padding-bottom:calc(var(--f)*3.2)}
.f-tile.pic.row .f-shot{flex:0 0 36%;align-self:stretch;width:auto;min-height:0}
.f-tile.pic.row .f-shot.land{flex-basis:50%}
.stat{--s:calc(var(--u)*var(--sz));position:relative;z-index:1;flex:0 1 auto;min-height:0;width:100%;display:flex;flex-direction:column;align-items:center;text-align:center;padding:calc(var(--u)*5.5) calc(var(--u)*7) 0}
.align-left .stat{align-items:flex-start;text-align:start;padding-inline:calc(var(--u)*8)}
.st-main,.st-item{display:flex;flex-direction:column;align-items:inherit;min-width:0;max-width:100%}
.st-value{font-family:var(--font);font-weight:var(--hw);white-space:nowrap;color:transparent;background:linear-gradient(135deg,color-mix(in srgb,var(--c) 55%,var(--text)),var(--c));-webkit-background-clip:text;background-clip:text}
.st-icon{display:block;width:auto;fill:var(--g)}
.st-main .st-value{font-size:calc(var(--s)*var(--sv)*var(--fs));line-height:.92;letter-spacing:-.05em;padding:0 .05em}
.st-main .st-icon{height:calc(var(--s)*var(--sv)*.8)}
.st-main .st-title{font-family:var(--font);font-size:calc(var(--s)*6.6*var(--fs));font-weight:var(--hw);line-height:1.08;letter-spacing:var(--track);margin-top:calc(var(--s)*2.6);text-wrap:balance}
.st-title em{font-style:normal;color:var(--c)}
.st-main .st-detail{font-size:calc(var(--s)*3.9);font-weight:500;line-height:1.27;letter-spacing:-.01em;opacity:.76;margin-top:calc(var(--s)*1.7);max-width:calc(var(--u)*78);text-wrap:balance}
.st-row{display:grid;grid-template-columns:repeat(var(--sc),minmax(0,1fr));gap:calc(var(--s)*5) calc(var(--s)*4.5);width:100%;max-width:calc(var(--u)*33*var(--sc));margin-top:calc(var(--s)*9)}
.st-item{gap:calc(var(--s)*1);padding-top:calc(var(--s)*3.4);border-top:calc(var(--u)*.3) solid color-mix(in srgb,var(--text) 18%,transparent)}
.st-item .st-value{font-size:calc(var(--s)*8.8*var(--fs));line-height:1;letter-spacing:-.035em}
.st-item .st-icon{height:calc(var(--s)*8)}
.st-item .st-title{font-size:calc(var(--s)*3.3);font-weight:600;line-height:1.2;letter-spacing:-.005em;opacity:.88;text-wrap:balance}
.st-item .st-detail{font-size:calc(var(--s)*2.7);font-weight:500;line-height:1.25;opacity:.62;text-wrap:balance}
.steps{--p:calc(var(--u)*var(--pz));position:relative;z-index:1;flex:0 1 auto;min-height:0;width:100%;display:flex;justify-content:center;padding:calc(var(--u)*7.5) calc(var(--u)*8) 0}
.align-left .steps{justify-content:flex-start}
.sp-list{display:flex;flex-direction:column;gap:calc(var(--p)*6.4);width:100%;max-width:calc(var(--u)*124);min-width:0}
.sp-step{position:relative;display:flex;align-items:flex-start;gap:calc(var(--p)*4.2);min-width:0}
.sp-rail{flex:none;line-height:0}
.sp-num{display:grid;place-items:center;min-width:calc(var(--p)*12);height:calc(var(--p)*12);padding:0 calc(var(--p)*2.6);border-radius:calc(var(--p)*6);background:linear-gradient(150deg,color-mix(in srgb,var(--c) 76%,#fff),var(--c));color:var(--ci);font-family:var(--font);font-size:calc(var(--p)*5.6*var(--fs));font-weight:var(--hw);line-height:1;letter-spacing:-.02em;white-space:nowrap;box-shadow:0 calc(var(--p)*.8) calc(var(--p)*2.4) color-mix(in srgb,var(--c) 34%,transparent)}
.sp-step:not(:last-child) .sp-rail::after{content:"";position:absolute;inset-inline-start:calc(var(--p)*6);top:calc(var(--p)*13.8);bottom:calc(var(--p)*-4.6);width:calc(var(--u)*.44);margin-inline-start:calc(var(--u)*-.22);border-radius:99px;background:color-mix(in srgb,var(--text) 22%,transparent)}
.sp-text{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:calc(var(--p)*1.3);padding-top:calc(var(--p)*1.5);text-align:start}
.sp-title{font-family:var(--font);font-size:calc(var(--p)*5.7*var(--fs));font-weight:var(--hw);line-height:1.08;letter-spacing:var(--track);text-wrap:balance}
.sp-title em{font-style:normal;color:var(--c)}
.sp-detail{font-size:calc(var(--p)*3.7);font-weight:500;line-height:1.28;letter-spacing:-.005em;opacity:.76;text-wrap:pretty}
.sp-pic{flex:none;width:calc(var(--p)*27);aspect-ratio:3/4;overflow:hidden;border-radius:calc(var(--p)*3);background:#101012;box-shadow:0 calc(var(--p)*1.2) calc(var(--p)*3.4) rgba(0,0,0,.28),0 0 0 calc(var(--u)*.12) rgba(128,128,128,.3)}
.sp-pic.land{width:calc(var(--p)*40);aspect-ratio:var(--ar)}
.sp-pic img{display:block;width:100%;height:100%;object-fit:cover;object-position:top center}
.roomy .sp-pic{width:calc(var(--p)*30);aspect-ratio:1/1}
.roomy .sp-pic.land{width:calc(var(--p)*40);aspect-ratio:var(--ar)}
.wide .sp-list{flex-direction:row;gap:calc(var(--p)*6);max-width:none}
.wide .sp-step{flex:1 1 0;flex-direction:column;gap:calc(var(--p)*3.2)}
.wide .sp-step:not(:last-child) .sp-rail::after{inset-inline:calc(var(--p)*14) calc(var(--p)*-4);top:calc(var(--p)*6);bottom:auto;width:auto;height:calc(var(--u)*.44);margin-block:calc(var(--u)*-.22) 0;margin-inline:0}
.wide .sp-text{flex:none;padding-top:0}
.wide .sp-pic{width:100%;aspect-ratio:5/4;margin-top:calc(var(--p)*1.4)}
.wide .sp-pic.land{width:100%;aspect-ratio:var(--ar)}
.reviews{--b:calc(var(--u)*var(--rz));position:relative;z-index:1;flex:0 1 auto;min-height:0;width:100%;display:flex;justify-content:center;padding:calc(var(--u)*6.5) calc(var(--u)*7) 0}
.align-left .reviews{justify-content:flex-start;padding-inline:calc(var(--u)*8)}
.rv-wall{width:100%;max-width:calc(var(--u)*var(--rw));column-count:var(--rc);column-gap:calc(var(--u)*2.6)}
.rv-card{break-inside:avoid;display:flex;flex-direction:column;align-items:flex-start;gap:calc(var(--b)*1.9);margin-bottom:calc(var(--u)*2.6);padding:calc(var(--b)*3.6) calc(var(--b)*3.8);border-radius:calc(var(--u)*4.2);background:var(--card);box-shadow:inset 0 0 0 calc(var(--u)*.14) var(--card-line),var(--card-shadow);text-align:start}
.rv-card .stars{height:calc(var(--b)*3.2)}
.rv-quote{font-family:var(--font);font-size:calc(var(--b)*4.2*var(--fs));font-weight:600;line-height:1.24;letter-spacing:-.012em;text-wrap:pretty}
.rv-by{font-size:calc(var(--b)*2.4);font-weight:700;line-height:1.2;letter-spacing:.08em;text-transform:uppercase;opacity:.6}
.rv-card.gold .s-fg polygon{fill:url(#b-gold);stroke:url(#b-gold)}
.layout-statement .headline{font-size:calc(var(--u)*18*var(--ts)*var(--fs));line-height:.99}
.layout-statement .eyebrow{font-size:calc(var(--u)*3.5*var(--ts));margin-bottom:calc(var(--u)*4.4)}
.layout-statement .sub{font-size:calc(var(--u)*5*var(--ts));margin-top:calc(var(--u)*5.2)}
.em-marker .headline em{color:var(--mi);background:linear-gradient(var(--accent),var(--accent)) 0 58%/100% 84% no-repeat;padding:0 .13em;margin:0 -.05em;border-radius:.13em;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.em-underline .headline em{color:inherit;text-decoration:underline;text-decoration-color:var(--accent);text-decoration-thickness:.085em;text-underline-offset:.1em;text-decoration-skip-ink:none}
.device{position:relative;flex:none;width:var(--dw);transform-origin:50% 35%;direction:ltr}
.frame{position:relative;z-index:1;border-radius:calc(var(--dw)*var(--ro));padding:calc(var(--dw)*var(--band));background:linear-gradient(135deg,var(--f1),var(--f2) 28%,var(--f3) 62%,var(--f4));box-shadow:var(--shadow)}
.frame::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 calc(var(--dw)*.0018) rgba(255,255,255,.3),inset 0 0 calc(var(--dw)*.006) rgba(0,0,0,.45);pointer-events:none}
.bezel{background:#000;border-radius:calc(var(--dw)*(var(--ro) - var(--band)));padding:calc(var(--dw)*var(--bezy,var(--bez))) calc(var(--dw)*var(--bez))}
.screen{position:relative;overflow:hidden;background:#101012;border-radius:calc(var(--dw)*var(--ri));aspect-ratio:var(--ar)}
.screen.bare{box-shadow:var(--shadow),0 0 0 calc(var(--dw)*.0015) rgba(255,255,255,.14)}
.screen img{display:block;width:100%;height:100%;object-fit:cover;object-position:top center}
.placeholder{width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;background:linear-gradient(160deg,#2a2a31,#17171b);color:rgba(255,255,255,.55);font:500 calc(var(--dw)*.045)/1.35 var(--body)}
.placeholder b{color:#fff;font-weight:700}
.island{position:absolute;left:50%;top:calc(var(--sw)*.0311);width:calc(var(--sw)*.2854);height:calc(var(--sw)*.088);margin-left:calc(var(--sw)*-.1427);border-radius:999px;background:#000}
.notch{position:absolute;left:50%;top:0;width:calc(var(--sw)*.5);height:calc(var(--sw)*.074);margin-left:calc(var(--sw)*-.25);border-radius:0 0 calc(var(--sw)*.052) calc(var(--sw)*.052);background:#000}
.notch::before,.notch::after{content:"";position:absolute;top:0;width:calc(var(--sw)*.02);height:calc(var(--sw)*.02)}
.notch::before{right:100%;background:radial-gradient(circle at 0 100%,transparent 70.7%,#000 71%)}
.notch::after{left:100%;background:radial-gradient(circle at 100% 100%,transparent 70.7%,#000 71%)}
.speaker,.cam,.home-btn{position:absolute;left:50%;transform:translate(-50%,-50%)}
.speaker,.cam{top:calc(var(--dw)*(var(--band) + var(--bezy)/2));background:#202024;box-shadow:inset 0 0 0 calc(var(--dw)*.0015) rgba(255,255,255,.08)}
.speaker{width:calc(var(--dw)*.15);height:calc(var(--dw)*.013);border-radius:999px}
.cam{width:calc(var(--dw)*.012);height:calc(var(--dw)*.012);border-radius:50%}
.home-btn{top:calc(100% - var(--dw)*(var(--band) + var(--bezy)/2));width:calc(var(--dw)*var(--hb));height:calc(var(--dw)*var(--hb));border-radius:50%;background:#0c0c0e;box-shadow:inset 0 0 0 calc(var(--dw)*var(--hb)*.055) #2c2c31}
.land .speaker,.land .cam{left:calc(var(--dw)*(var(--band) + var(--bez)/2));top:50%}
.land .speaker{width:calc(var(--dw)*var(--k)*.013);height:calc(var(--dw)*var(--k)*.15)}
.land .cam{width:calc(var(--dw)*var(--k)*.012);height:calc(var(--dw)*var(--k)*.012)}
.land .home-btn{left:calc(100% - var(--dw)*(var(--band) + var(--bez)/2));top:50%}
.sb{position:absolute;left:0;top:0;width:100%;height:calc(var(--sw)*.141);--mid:calc(var(--sw)*.0751);--pad:calc(var(--sw)*.012);font:600 calc(var(--sw)*.0395)/1 'Inter Variable',system-ui,sans-serif;letter-spacing:-.015em;font-variant-numeric:tabular-nums}
.sb.light{color:#fff}
.sb.dark{color:#000}
.sb-fill{position:absolute;inset:0;-webkit-mask-image:linear-gradient(#000 84%,transparent);mask-image:linear-gradient(#000 84%,transparent)}
.sb-time,.sb-icons{position:absolute;top:var(--mid);transform:translateY(-50%);width:35.7%;display:flex;align-items:center;justify-content:center}
.sb-time{left:0;padding-left:var(--pad)}
.sb-icons{right:0;padding-right:var(--pad);gap:calc(var(--sw)*.0145)}
.sb svg{display:block;flex:none;width:auto;fill:currentColor}
.sb-signal,.sb-wifi{height:calc(var(--sw)*.0273)}
.sb-battery{height:calc(var(--sw)*.0295)}
.sb-ipad,.sb-duo{height:calc(var(--sw)*.027);--mid:calc(var(--sw)*.0118);--pad:calc(var(--sw)*.0195);font-size:calc(var(--sw)*.0122)}
.sb-duo{height:calc(var(--sw)*.058);--mid:calc(var(--sw)*.028);--pad:calc(var(--sw)*.045);font-size:calc(var(--sw)*.0235)}
.sb-ipad .sb-time,.sb-ipad .sb-icons,.sb-duo .sb-time,.sb-duo .sb-icons{width:auto;padding:0}
.sb-ipad .sb-time,.sb-duo .sb-time{left:var(--pad)}
.sb-ipad .sb-icons,.sb-duo .sb-icons{right:var(--pad);gap:calc(var(--sw)*.0062)}
.sb-ipad .sb-wifi{height:calc(var(--sw)*.0108)}
.sb-ipad .sb-battery{height:calc(var(--sw)*.0116)}
.sb-duo .sb-icons{gap:calc(var(--sw)*.011)}
.sb-duo .sb-wifi{height:calc(var(--sw)*.019)}
.sb-duo .sb-battery{height:calc(var(--sw)*.0205)}
.sb-home{height:calc(var(--sw)*.0533);--mid:calc(var(--sw)*.0267);--pad:calc(var(--sw)*.016);font-size:calc(var(--sw)*.032)}
.sb-home .sb-time{width:100%;padding:0}
.sb-home .sb-icons{width:auto;right:var(--pad);padding:0}
.sb-net{position:absolute;left:var(--pad);top:var(--mid);transform:translateY(-50%);display:flex;align-items:center;gap:calc(var(--sw)*.012)}
.sb-home .sb-signal,.sb-home .sb-wifi{height:calc(var(--sw)*.022)}
.sb-home .sb-battery{height:calc(var(--sw)*.024)}
.device.clay .frame{background:var(--f3);box-shadow:var(--shadow),inset 0 calc(var(--dw)*.005) calc(var(--dw)*.008) rgba(255,255,255,.3),inset 0 calc(var(--dw)*-.006) calc(var(--dw)*.01) rgba(0,0,0,.2)}
.device.clay .frame::after{display:none}
.device.clay .bezel{background:var(--f3)}
.device.clay .screen{box-shadow:0 0 0 calc(var(--dw)*.0035) color-mix(in srgb,var(--f3) 80%,#000)}
.device.clay .btn{background:color-mix(in srgb,var(--f3) 86%,#000)}
.device.drawn .frame{padding:calc(var(--dw)*(var(--band) + var(--bezy,var(--bez)))) calc(var(--dw)*(var(--band) + var(--bez)));background:none;box-shadow:none}
.device.drawn .frame::after{border:calc(var(--dw)*.0085) solid var(--line);box-shadow:none}
.device.drawn .bezel{padding:0;background:none}
.device.drawn .screen{box-shadow:var(--shadow),0 0 0 calc(var(--dw)*.003) color-mix(in srgb,var(--line) 45%,transparent)}
.device.drawn .btn{background:var(--line);left:auto;right:auto}
.device.drawn .btn.l{left:calc(var(--dw)*-.011)}
.device.drawn .btn.r{right:calc(var(--dw)*-.011)}
.device.sketch .frame::after{filter:var(--pen)}
.device.sketch .frame::before{content:"";position:absolute;inset:calc(var(--dw)*-.004);border-radius:calc(var(--dw)*var(--ro));border:calc(var(--dw)*.004) solid var(--line);opacity:.55;transform:rotate(.35deg);filter:var(--pen);pointer-events:none}
.device.sketch .btn,.device.sketch .home-btn,.device.sketch .speaker,.device.sketch .cam{filter:var(--pen)}
.device.clay .speaker,.device.clay .cam{background:color-mix(in srgb,var(--f3) 78%,#000);box-shadow:none}
.device.clay .home-btn{background:color-mix(in srgb,var(--f3) 90%,#000);box-shadow:inset 0 0 0 calc(var(--dw)*var(--hb)*.055) color-mix(in srgb,var(--f3) 76%,#000)}
.device.drawn .speaker,.device.drawn .cam{background:none;box-shadow:none;border:calc(var(--dw)*.004) solid var(--line)}
.device.drawn .home-btn{background:none;box-shadow:none;border:calc(var(--dw)*.006) solid var(--line)}
.btn{position:absolute;width:calc(var(--dw)*.014);background:linear-gradient(90deg,var(--f2),var(--f3));border-radius:calc(var(--dw)*.004)}
.device.window .screen{background:none}
.device.mac{--top:calc(var(--dw)*var(--ro));--foot:calc(var(--dw)*.0035)}
.device.mac .frame{width:calc(var(--dw)*var(--lid));margin:0 auto;border-radius:var(--top) var(--top) var(--foot) var(--foot);box-shadow:none}
.device.mac .bezel{position:relative;border-radius:calc(var(--top) - var(--dw)*var(--band)) calc(var(--top) - var(--dw)*var(--band)) calc(var(--foot)*.5) calc(var(--foot)*.5)}
.device.mac .bezel::before{content:"";position:absolute;left:50%;top:calc(var(--dw)*var(--bez)*.5);width:calc(var(--dw)*.0034);height:calc(var(--dw)*.0034);margin:calc(var(--dw)*-.0017);border-radius:50%;background:#26262c;box-shadow:inset 0 0 0 calc(var(--dw)*.0008) #0c0c0f}
.device.mac .screen{border-radius:calc(var(--dw)*var(--ri)) calc(var(--dw)*var(--ri)) 0 0}
.base{display:block;position:relative;z-index:1;height:calc(var(--dw)*var(--bh));border-radius:calc(var(--dw)*.0025) calc(var(--dw)*.0025) calc(var(--dw)*.045) calc(var(--dw)*.045)/calc(var(--dw)*.0025) calc(var(--dw)*.0025) 86% 86%;background:linear-gradient(180deg,var(--f1),var(--f3) 26%,var(--f3) 58%,var(--f4));box-shadow:inset 0 calc(var(--dw)*.0012) 0 rgba(255,255,255,.45),inset 0 calc(var(--dw)*-.003) calc(var(--dw)*.004) rgba(0,0,0,.28)}
.base::before{content:"";position:absolute;left:50%;top:0;width:calc(var(--dw)*.124);height:calc(var(--dw)*var(--bh)*.36);margin-left:calc(var(--dw)*-.062);border-radius:0 0 calc(var(--dw)*.006) calc(var(--dw)*.006);background:linear-gradient(180deg,var(--f4),var(--f2));box-shadow:inset 0 calc(var(--dw)*.0012) calc(var(--dw)*.002) rgba(0,0,0,.35)}
.device.mac::before,.device.mac::after{content:"";position:absolute;z-index:0;box-shadow:var(--shadow);pointer-events:none}
.device.mac::before{left:calc(var(--dw)*(1 - var(--lid))/2);right:calc(var(--dw)*(1 - var(--lid))/2);top:0;bottom:calc(var(--dw)*var(--bh));border-radius:var(--top) var(--top) 0 0}
.device.mac::after{left:calc(var(--dw)*.012);right:calc(var(--dw)*.012);bottom:0;height:calc(var(--dw)*var(--bh));border-radius:0 0 calc(var(--dw)*.03) calc(var(--dw)*.03)}
.device.clay.mac .frame{box-shadow:inset 0 calc(var(--dw)*.0025) calc(var(--dw)*.004) rgba(255,255,255,.3),inset 0 calc(var(--dw)*-.003) calc(var(--dw)*.005) rgba(0,0,0,.2)}
.device.clay.mac .bezel::before{background:color-mix(in srgb,var(--f3) 78%,#000);box-shadow:none}
.device.clay .base{background:color-mix(in srgb,var(--f3) 93%,#000);box-shadow:inset 0 calc(var(--dw)*.0025) calc(var(--dw)*.004) rgba(255,255,255,.3),inset 0 calc(var(--dw)*-.003) calc(var(--dw)*.005) rgba(0,0,0,.2)}
.device.clay .base::before{background:color-mix(in srgb,var(--f3) 80%,#000);box-shadow:none}
.device.drawn.mac .frame::after{border-width:calc(var(--dw)*.005)}
.device.drawn.mac .bezel::before,.device.drawn.mac::before,.device.drawn.mac::after{display:none}
.device.drawn .base{background:none;box-shadow:none;border:calc(var(--dw)*.005) solid var(--line);border-top-width:0}
.device.drawn .base::before{top:0;background:none;box-shadow:none;border:calc(var(--dw)*.004) solid var(--line);border-top-width:0}
.device.sketch .base{filter:var(--pen)}
.btn.l{left:calc(var(--dw)*-.006)}
.btn.r{right:calc(var(--dw)*-.006)}
.land .btn{width:auto;height:calc(var(--dw)*var(--k)*.014);background:linear-gradient(180deg,var(--f2),var(--f3))}
.btn.t{top:calc(var(--dw)*var(--k)*-.006)}
.btn.b{bottom:calc(var(--dw)*var(--k)*-.006)}
.device.drawn .btn.t{top:calc(var(--dw)*var(--k)*-.011)}
.device.drawn .btn.b{bottom:calc(var(--dw)*var(--k)*-.011)}
.points{--p:calc(var(--u)*var(--ts));display:grid;grid-template-columns:repeat(var(--pc),minmax(0,1fr));gap:calc(var(--p)*3) calc(var(--p)*2);max-width:100%;margin-top:calc(var(--u)*5.5);text-align:start}
.points.two{width:100%}
.point{display:flex;align-items:center;gap:calc(var(--p)*2.6);min-width:0}
.p-lead{flex:none;display:grid;place-items:center;min-width:calc(var(--p)*8);height:calc(var(--p)*8);padding:0 calc(var(--p)*1.4);border-radius:calc(var(--p)*2.3);background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent)}
.p-lead .icon{display:block;height:calc(var(--p)*4.5);width:auto}
.p-value{font-family:var(--font);font-size:calc(var(--p)*3.2*var(--fs));font-weight:var(--hw);line-height:1;letter-spacing:-.03em;white-space:nowrap}
.p-text{min-width:0;display:flex;flex-direction:column;gap:calc(var(--p)*.6)}
.p-title{font-family:var(--font);font-size:calc(var(--p)*4*var(--fs));font-weight:var(--hw);line-height:1.1;letter-spacing:var(--track)}
.p-title em{font-style:normal;color:var(--accent)}
.p-detail{font-size:calc(var(--p)*3);font-weight:500;line-height:1.26;letter-spacing:-.005em;opacity:.74}
.ps-cards{gap:calc(var(--p)*1.7)}
.ps-cards .point{padding-block:calc(var(--p)*2.1);padding-inline:calc(var(--p)*2.1) calc(var(--p)*2.8);border-radius:calc(var(--p)*3.4);background:var(--card);box-shadow:inset 0 0 0 calc(var(--u)*.14) var(--card-line),var(--card-shadow)}
.ps-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:calc(var(--p)*1.6)}
.align-left .ps-chips{justify-content:flex-start}
.ps-chips .point{gap:calc(var(--p)*1.3);padding-block:calc(var(--p)*1.5);padding-inline:calc(var(--p)*2.1) calc(var(--p)*2.8);border-radius:999px;background:color-mix(in srgb,var(--text) 12%,transparent);box-shadow:inset 0 0 0 calc(var(--u)*.14) color-mix(in srgb,var(--text) 18%,transparent)}
.ps-chips .p-lead{min-width:0;height:auto;padding:0;border-radius:0;background:none}
.ps-chips .p-lead .icon{height:calc(var(--p)*3.7)}
.ps-chips .p-title{font-size:calc(var(--p)*3.2*var(--fs));white-space:nowrap}
.wide .copy{padding-top:calc(var(--u)*9.5)}
.wide .sub{max-width:calc(var(--u)*130)}
.side{flex-direction:row;align-items:center}
.side.layout-device-left{flex-direction:row-reverse}
.side .copy{flex:0 0 56%;width:auto;padding-block:0;padding-inline:calc(var(--u)*8) 0}
.side.layout-device-left .copy{padding-inline:calc(var(--u)*1) calc(var(--u)*7)}
.side .headline{font-size:calc(var(--u)*9*var(--ts)*var(--fs))}
.wide.side .copy{flex-basis:41%;padding-top:0}
.wide.side .sub{max-width:100%}
.side .stage,.side .stage.fits{flex:1 1 0;width:auto;min-width:0;align-self:stretch;align-items:center;justify-content:flex-start;padding-block:0;padding-inline:calc(var(--u)*5) 0}
.side.layout-device-left .stage,.side.layout-device-left .stage.fits{justify-content:flex-end;padding-inline:0 calc(var(--u)*5)}
.logo{flex:none;max-width:100%;margin-bottom:calc(var(--u)*4.4*var(--ts))}
.logo img{display:block;width:100%;height:100%;object-fit:contain}
.logo-app-icon img,.logo-circle img{object-fit:cover}
.logo-app-icon img{border-radius:22.5%;box-shadow:0 calc(var(--u)*1.2) calc(var(--u)*3.4) rgba(0,0,0,.3),0 0 0 calc(var(--u)*.1) rgba(128,128,128,.22)}
.logo-circle img{border-radius:50%}
.art{position:absolute;inset:0;pointer-events:none}
.art.behind{z-index:0}
.art.front{z-index:3}
.art img{position:absolute;display:block;height:auto;max-width:none}
.art .shadow-soft{filter:drop-shadow(0 calc(var(--u)*1.2) calc(var(--u)*2.2) rgba(0,0,0,.28))}
.art .shadow-strong{filter:drop-shadow(0 calc(var(--u)*2.6) calc(var(--u)*4.4) rgba(0,0,0,.5))}
.icon-row{display:flex;flex-direction:column;align-items:center;gap:calc(var(--u)*2.4);max-width:100%}
.align-left .icon-row{align-items:flex-start}
.icon-row.top{margin-bottom:calc(var(--u)*5.5)}
.icon-row.bottom{margin-top:calc(var(--u)*5.5)}
.ir-label{font-size:calc(var(--u)*2.7);font-weight:700;letter-spacing:.14em;text-transform:uppercase;opacity:.62}
.ir-items{display:flex;align-items:center;gap:calc(var(--i)*var(--ig))}
.ir-item{flex:none;display:grid;place-items:center;width:var(--i);height:var(--i);border-radius:calc(var(--i)*.235);background:color-mix(in srgb,var(--text) 11%,transparent);color:var(--accent);box-shadow:inset 0 0 0 calc(var(--i)*.012) color-mix(in srgb,var(--text) 14%,transparent)}
.ir-item .icon{display:block;width:58%;height:58%}
.ir-item.brand{box-shadow:0 calc(var(--i)*.07) calc(var(--i)*.18) rgba(0,0,0,.24),inset 0 0 0 calc(var(--i)*.012) rgba(128,128,128,.28)}
.ir-circles .ir-item{border-radius:50%}
.ir-circles .ir-item .icon{width:54%;height:54%}
.ir-plain .ir-item{width:auto;background:none;box-shadow:none}
.ir-plain .ir-item .icon{width:auto;height:100%}
.tone-text .ir-item{color:var(--text)}
.badges{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;max-width:100%;gap:calc(var(--u)*3) calc(var(--u)*5*var(--bs))}
.align-left .badges{justify-content:flex-start}
.badges.top{margin-bottom:calc(var(--u)*5.5)}
.badges.bottom{margin-top:calc(var(--u)*6)}
.badge{--b:calc(var(--u)*var(--bs));display:flex;align-items:center;color:var(--text)}
.badge.laurel{gap:calc(var(--b)*.6)}
.wreath{flex:none;height:calc(var(--b)*15.5);width:auto;opacity:.92}
.wreath.r{transform:scaleX(-1)}
[dir=rtl] .wreath.l{transform:scaleX(-1)}
[dir=rtl] .wreath.r{transform:none}
.b-body{display:flex;flex-direction:column;align-items:center;text-align:center;gap:calc(var(--b)*.75)}
.b-title{font-family:var(--font);font-size:calc(var(--b)*5.6);font-weight:var(--hw);line-height:1;letter-spacing:-.03em;white-space:nowrap}
.b-sub{font-size:calc(var(--b)*2.1);font-weight:700;line-height:1.15;letter-spacing:.09em;text-transform:uppercase;opacity:.82;white-space:nowrap}
.stars{position:relative;display:block;height:calc(var(--b)*2.9);line-height:0}
.stars svg{display:block;height:100%;width:auto;max-width:none}
.s-bg{height:100%;opacity:.28}
.s-fg{position:absolute;inset-inline-start:0;top:0;height:100%;width:var(--fill);overflow:hidden;color:var(--star)}
.b-body>.icon{height:calc(var(--b)*4.2);width:auto;color:var(--star)}
.badge.with-icon{gap:calc(var(--b)*1.8)}
.badge.with-icon>.icon{flex:none;height:calc(var(--b)*8.5);width:auto;color:var(--star)}
.badge.with-icon .b-body{align-items:flex-start;text-align:start}
.badge.with-icon .b-title{font-size:calc(var(--b)*4.4)}
.badge.pill{gap:calc(var(--b)*1.1);padding:calc(var(--b)*1.5) calc(var(--b)*3.2);border-radius:999px;background:color-mix(in srgb,var(--text) 13%,transparent);box-shadow:inset 0 0 0 calc(var(--b)*.14) color-mix(in srgb,var(--text) 20%,transparent);font-size:calc(var(--b)*2.9);font-weight:700;letter-spacing:-.005em;white-space:nowrap}
.badge.pill .icon{height:calc(var(--b)*3.2);width:auto;color:var(--star)}
.badge.card{padding:calc(var(--b)*2.5) calc(var(--b)*3.3);border-radius:calc(var(--b)*3.6);background:var(--card);box-shadow:inset 0 0 0 calc(var(--b)*.14) var(--card-line),var(--card-shadow)}
.badge.rating{gap:calc(var(--b)*2.3)}
.badge.rating .b-title{font-size:calc(var(--b)*8.4);letter-spacing:-.04em}
.badge.rating .b-body{align-items:flex-start;text-align:start;gap:calc(var(--b)*1)}
.badge.rating .stars{height:calc(var(--b)*3.1)}
.badge.review{flex-direction:column;align-items:flex-start;text-align:start;gap:calc(var(--b)*1.5);max-width:calc(var(--b)*46)}
.badge.review .stars{height:calc(var(--b)*2.8)}
.b-quote{font-family:var(--font);font-size:calc(var(--b)*3.5);font-weight:600;line-height:1.22;letter-spacing:-.012em;text-wrap:pretty}
.badge.review .b-sub{opacity:.62}
.badge.gold .wreath{opacity:1;color:#D9A845}
.badge.gold .wreath path[fill=currentColor],.badge.gold .icon{fill:url(#b-gold)}
.badge.gold .s-fg polygon{fill:url(#b-gold);stroke:url(#b-gold)}
`;
