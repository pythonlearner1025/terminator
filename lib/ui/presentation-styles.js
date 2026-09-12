export const PRESENTATION_STYLE = `
.tm-menu{background:linear-gradient(90deg,#020609fa 0%,#03090dda 26%,#040a1040 52%,transparent 72%),linear-gradient(0deg,#020609bd,transparent 30%,transparent 85%,#02060966);padding:6%;isolation:isolate}
.tm-menu:after{content:'';position:absolute;inset:0;z-index:-1;box-shadow:inset 0 0 130px #0009;pointer-events:none}
.tm-brand{width:53%;max-width:930px;margin-top:-2%}.tm-brand h1{font-size:clamp(64px,7.5cqw,150px);letter-spacing:-.025em;font-weight:600;color:#d8e0e5;text-shadow:none;filter:drop-shadow(0 6px 16px #0009);background:linear-gradient(#f4f8fa 10%,#8d9ca8 45%,#eff4f7 48%,#7c8c98 95%);background-clip:text;-webkit-text-fill-color:transparent}
.tm-brand-subtitle{font-size:clamp(17px,1.8cqw,35px);letter-spacing:.36em;color:#afbfca;margin:22px 0 65px}
.tm-menu-nav{width:320px;gap:9px}.tm-menu-nav .tm-btn{position:relative;justify-content:flex-start;font-size:27px;min-height:49px;border-left:2px solid #66869440;color:#96a9b6;padding:10px 23px;background:linear-gradient(90deg,#09131a80,transparent);transition:color .15s,background .15s,transform .15s,border-color .15s}
.tm-menu-nav .primary{color:#e5f5ff;border-left:3px solid #c0e7ff;background:linear-gradient(90deg,#48718a65,transparent)}
.tm-menu-nav .tm-btn:hover,.tm-menu-nav .tm-btn:focus-visible{color:#f0faff;border-left-color:#e7f7ff;background:linear-gradient(90deg,#507c965e,transparent);transform:translateX(7px)}
.tm-menu-nav .tm-btn:active{transform:translateX(10px) scale(.985)}
.tm-screen:not(.tm-menu):not(.tm-paused){background:linear-gradient(100deg,#040a10fa 10%,#09121aed 60%,#09121abc),repeating-linear-gradient(135deg,#789aaa08 0 1px,transparent 1px 6px)}
.tm-screen-header{border-bottom:1px solid #a5bdcc30}.tm-screen-header h1{font-size:clamp(36px,4cqw,76px)}
.tm-btn{transition:background .14s,border-color .14s,transform .14s,box-shadow .14s;min-height:48px}
.tm-hud .tm-btn:not(:disabled):hover{box-shadow:inset 0 0 24px #b8dffc18}.tm-hud .tm-btn:not(:disabled):active{transform:translateY(2px) scale(.98)}
.tm-hud .tm-btn:disabled:hover{background:inherit;border-color:inherit}.tm-btn.primary:hover{background:#dcf3ff;color:#06111a}
.tm-screen-header,.tm-lobby-grid,.tm-settings-grid,.tm-party-grid,.tm-trader-grid,.tm-match-stats,.tm-scoreboard-wrap,.tm-bindings-grid,.tm-pause-card{animation:tm-panel-arrive .28s cubic-bezier(.2,.7,.2,1) both}
.tm-lobby-grid,.tm-party-grid{animation-delay:.04s}.tm-screen-footer{animation:tm-panel-arrive .28s .07s both}
.tm-difficulty{display:grid;gap:12px;width:min(390px,100%);margin-top:44px}.tm-difficulty select{appearance:auto;background:#14212be6;color:#e3edf5;border:1px solid #7c9eb855;border-left:3px solid #a6cbdc;padding:14px 20px;font:inherit;letter-spacing:.08em;cursor:pointer}
.tm-difficulty select:focus-visible{outline:2px solid #b9e5ff;outline-offset:3px}
.tm-lobby-grid{max-width:1250px;align-content:center}.tm-install code{min-height:56px;font-size:14px}.tm-status{font-size:23px;letter-spacing:.08em;min-height:34px}
.tm-setting{padding:23px 0}.tm-setting input{height:4px}.tm-settings-grid{width:min(980px,100%)}
.tm-bindings-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 44px;overflow:auto;align-content:start;min-height:0}
.tm-binding{display:grid;grid-template-columns:1fr minmax(85px,130px);gap:10px;align-items:center;border-bottom:1px solid #8fbbd324;padding:11px 0;font-size:22px}
.tm-binding .tm-btn{font-size:18px;min-height:40px;padding:8px 13px;color:#cde6f4}.tm-bind-status{color:#f2b94c;margin-right:auto}
.tm-loading-card{margin:auto;width:min(410px,70%);text-align:center;display:grid;gap:22px;justify-items:center}
.tm-resistance{width:135px;height:135px;color:#abc3cf;filter:drop-shadow(0 0 25px #5791b522)}
.tm-loading-card progress{appearance:none;border:0;width:100%;height:4px;background:#8bacbc24;accent-color:#bddfec}
.tm-loading-card progress::-webkit-progress-bar{background:#8bacbc24}.tm-loading-card progress::-webkit-progress-value{background:#bddfec;box-shadow:0 0 16px #91c6e3}
.tm-loading-card output{font-size:16px;letter-spacing:.2em;color:#829eaf}.tm-loading-card [role=status]{color:#f2b94c}
.tm-hud .tm-screen[data-screen="loading"],.tm-hud .tm-screen[data-screen="controls"],.tm-hud .tm-screen.tm-trader-screen{background:radial-gradient(ellipse at 50% 42%,#12212d 0%,#060d14 55%,#03080d 100%)}
.tm-controls-card{margin:auto;width:min(880px,100%);display:grid;justify-items:center;gap:28px;text-align:center}
.tm-controls-card .tm-resistance{width:90px;height:90px}.tm-controls-card h1{font-size:48px}.tm-controls-card>.tm-btn{min-width:260px}
.tm-controls-grid{width:100%;display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#9cbcd622;border:1px solid #9cbcd622}
.tm-controls-grid>div{display:grid;gap:12px;justify-items:center;background:#0c1822;padding:22px 14px}.tm-controls-grid kbd{font:600 23px Barlow,sans-serif;color:#d7edf9}.tm-controls-grid span{font-size:15px;letter-spacing:.13em;text-transform:uppercase;color:#92aebf}
.tm-controls>button{display:flex;gap:8px;align-items:center}.tm-spectate-controls button{display:flex;gap:8px;align-items:center;font-size:15px!important}
.tm-wave-sub{font-size:13px;letter-spacing:.12em}.tm-wave{min-width:315px}.tm-ready{top:calc(3.2% + 140px)}
.tm-skynet.tm-power{animation:tm-power-on .5s steps(1) both}.tm-wave.slam{animation:tm-wave-impact .4s cubic-bezier(.13,.8,.2,1) both}
@keyframes tm-panel-arrive{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes tm-wave-impact{0%{opacity:0;transform:translate(-50%,-22px) scale(1.18);filter:brightness(2)}45%{opacity:1;transform:translate(-50%,4px) scale(.985)}75%{transform:translate(-50%,-1px) scale(1.01)}100%{transform:translate(-50%,0) scale(1);filter:brightness(1)}}
@keyframes tm-power-on{0%,15%{opacity:.3;filter:brightness(2);clip-path:inset(46% 0)}25%{opacity:1;clip-path:inset(0)}40%{opacity:.5;transform:translateX(3px)}50%{opacity:1;transform:none;filter:brightness(1.7)}100%{opacity:1;filter:brightness(1)}}
@container(max-width:1250px){.tm-binding{font-size:18px;grid-template-columns:1fr 95px;padding:8px 0}.tm-bindings-grid{gap:0 20px}.tm-brand-subtitle{margin-bottom:36px}.tm-menu-nav .tm-btn{font-size:23px;min-height:40px}.tm-menu-nav{gap:5px;width:280px}.tm-setting{padding:17px 0}}
@container(max-height:750px){.tm-binding{font-size:17px;padding:5px 0}.tm-binding .tm-btn{min-height:33px;font-size:15px;padding:5px}.tm-difficulty{margin-top:22px}.tm-controls-card{gap:16px}.tm-controls-grid>div{padding:12px}.tm-resistance{width:95px;height:95px}.tm-menu-nav{gap:2px}.tm-brand-subtitle{margin-bottom:28px}}
@container(max-width:780px){.tm-bindings-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.tm-brand{width:85%}.tm-brand h1{font-size:11cqw}.tm-controls-grid{grid-template-columns:repeat(3,1fr)}.tm-controls-grid kbd{font-size:18px}}
@media(prefers-reduced-motion:reduce){.tm-hud *,.tm-hud *:before,.tm-hud *:after{animation:none!important;transition:none!important}}
`
