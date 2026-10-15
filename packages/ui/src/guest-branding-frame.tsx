import type { CSSProperties, ReactNode } from "react";
import { colorHsl, defaultGuestBranding, readableText, type GuestBranding } from "@exa-foh/shared";

export function GuestBrandingFrame({ branding = defaultGuestBranding(), assetBase, title, subtitle, children, preview = false }: {
  branding?: GuestBranding; assetBase: string; title: string; subtitle?: string; children: ReactNode; preview?: boolean;
}) {
  const asset = (id: string) => `${assetBase}/${encodeURIComponent(id)}`;
  const lightText = readableText(branding.surfaceColor) === "#ffffff";
  const fontFamily = branding.fontAssetId ? `"EXAGuest-${branding.fontAssetId}", system-ui, sans-serif` : {
    system: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif", serif: "Georgia, Cambria, serif", mono: "ui-monospace, SFMono-Regular, Consolas, monospace"
  }[branding.fontPreset];
  const style = {
    "--background": colorHsl(branding.surfaceColor), "--foreground": colorHsl(readableText(branding.surfaceColor)),
    "--card": colorHsl(branding.surfaceColor), "--card-foreground": colorHsl(readableText(branding.surfaceColor)),
    "--primary": colorHsl(branding.accentColor), "--primary-foreground": colorHsl(readableText(branding.accentColor)),
    "--ring": colorHsl(branding.accentColor), "--accent": colorHsl(branding.accentColor),
    "--muted-foreground": lightText ? "0 0% 75%" : "0 0% 35%", "--border": lightText ? "0 0% 30%" : "0 0% 75%",
    "--secondary": lightText ? "0 0% 20%" : "0 0% 90%", "--radius": "0.125rem",
    backgroundColor: branding.backgroundColor, color: readableText(branding.surfaceColor), fontFamily, letterSpacing: 0,
    backgroundImage: branding.backgroundImageId ? `url("${asset(branding.backgroundImageId)}")` : undefined,
    backgroundSize: branding.backgroundMode === "tile" ? "320px auto" : "cover", backgroundRepeat: branding.backgroundMode === "tile" ? "repeat" : "no-repeat", backgroundPosition: "center top"
  } as CSSProperties;
  return <div className={preview ? "w-full min-w-0" : "min-h-screen w-full min-w-0"} style={style} data-guest-branding data-guest-theme={branding.theme ?? "standard"}>
    {branding.theme === "night-market" && <style>{`
      [data-guest-theme="night-market"] { --border: 155 35% 22%; --muted-foreground: 45 18% 75%; }
      [data-guest-theme="night-market"] h1, [data-guest-theme="night-market"] h2 {font-family:Impact,Haettenschweiler,"Arial Narrow",sans-serif; font-weight:400; text-transform:uppercase; letter-spacing:0;}
      [data-guest-theme="night-market"] h1 {color:#ffd21c;}
      [data-guest-theme="night-market"] h2 {color:#ff3825;font-size:28px;line-height:1.15;}
      [data-guest-theme="night-market"] header {border-bottom:2px solid #19a66a;}
      [data-guest-theme="night-market"] header>img {aspect-ratio:3/1;}
      [data-guest-theme="night-market"] [data-menu-card] {background:#080d0a;border-color:#244334;}
      [data-guest-theme="night-market"] [data-menu-card] strong {color:#ffd21c;}
      [data-guest-theme="night-market"] [data-menu-price] {color:#ffd21c;}
      [data-guest-theme="night-market"] [data-menu-section] {color:#39ce8c;}
      [data-guest-theme="night-market"] button {border-radius:2px;}
      [data-guest-theme="night-market"] input {border-radius:2px;}
    `}</style>}
    {branding.theme === "club53" && <style>{`
      @font-face { font-family: "Club53 Titan"; src: url("/fonts/titan-one.woff2") format("woff2"); font-display: swap; font-weight: 400; }
      @font-face { font-family: "Club53 Inter Tight"; src: url("/fonts/inter-tight.woff2") format("woff2"); font-display: swap; font-weight: 100 900; }
      [data-guest-theme="club53"] { --border:240 5% 28%; --muted-foreground:220 12% 78%; background-color:#000!important; background-image:none!important; position:relative; isolation:isolate; }
      [data-guest-theme="club53"]::before {content:"";position:absolute;z-index:-1;top:0;right:-12%;width:48%;height:760px;background:url("/club53-outline.png") right top/contain no-repeat;opacity:.22;filter:grayscale(1) brightness(1.7) drop-shadow(0 0 12px rgba(42,67,177,.4));pointer-events:none;}
      [data-guest-theme="club53"] {font-family:"Club53 Inter Tight",Inter,sans-serif;}
      [data-guest-theme="club53"] h1,[data-guest-theme="club53"] h2 {font-family:"Club53 Titan",Impact,sans-serif;font-weight:400;letter-spacing:0;}
      [data-guest-theme="club53"] h1 {font-size:40px;line-height:1.1;color:#2844a9;text-shadow:0 0 16px rgba(40,68,169,.38);}
      [data-guest-theme="club53"] h2 {font-size:28px;line-height:1.2;color:#d3121c;}
      @property --club53-border-angle { syntax:"<angle>"; inherits:false; initial-value:0deg; }
      @keyframes club53-border-follow { to { --club53-border-angle:360deg; } }
      [data-guest-theme="club53"] header {position:relative;isolation:isolate;border:2px solid transparent;background-color:#050506;box-shadow:0 0 22px rgba(16,30,89,.28),0 0 10px rgba(211,18,28,.24);}
      [data-guest-theme="club53"] header::before {content:"";position:absolute;inset:-2px;z-index:0;padding:2px;border-radius:inherit;background:conic-gradient(from var(--club53-border-angle),#2844a9 0deg,#2844a9 230deg,#ff2735 280deg,#fff 292deg,#ff2735 304deg,#2844a9 350deg,#2844a9 360deg);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:club53-border-follow 3.8s linear infinite;pointer-events:none;}
      [data-guest-theme="club53"] header > * {position:relative;z-index:1;}
      [data-guest-theme="club53"] header.guest-header-club53 {min-height:270px;background-color:#050506;background-blend-mode:screen;background-position:center;}
      [data-guest-theme="club53"] header.guest-header-club53>img {position:absolute;z-index:1;top:10px;left:12px;width:150px;height:92px;padding:0;object-fit:contain;object-position:left top;}
      [data-guest-theme="club53"] header.guest-header-club53>div {position:relative;z-index:2;margin-top:180px;background:linear-gradient(90deg,rgba(5,5,6,.98),rgba(5,5,6,.78),transparent);}
      [data-guest-theme="club53"] header>img {height:180px;aspect-ratio:auto;padding:16px;filter:drop-shadow(0 0 7px rgba(211,18,28,.7)) drop-shadow(0 0 20px rgba(40,68,169,.55));}
      [data-guest-theme="club53"] header>div {background:#050506;}
      [data-guest-theme="club53"] [data-menu-card] {background:#0b0c11;border-color:#3b3d47;border-radius:2px;box-shadow:0 0 0 1px rgba(40,68,169,.1),0 0 18px rgba(19,32,91,.2);}
      [data-guest-theme="club53"] [data-menu-card]:hover {border-color:#d3121c;box-shadow:0 0 0 1px rgba(211,18,28,.4),0 0 22px rgba(211,18,28,.22);}
      [data-guest-theme="club53"] [data-menu-section] {color:#d3121c;text-transform:uppercase;}
      [data-guest-theme="club53"] [data-menu-price] {color:#2844a9;text-shadow:0 0 8px rgba(40,68,169,.55);}
      [data-guest-theme="club53"] section.grid > section {background:linear-gradient(145deg,#080a12,#0b0d19)!important;box-shadow:inset 0 1px 0 rgba(40,68,169,.12);}
      [data-guest-theme="club53"] section.grid > div {background:linear-gradient(145deg,#101322,#0a0c15)!important;border-color:#343b62;box-shadow:0 0 22px rgba(16,35,105,.22),inset 0 1px 0 rgba(211,18,28,.12);}
      [data-guest-theme="club53"] section.grid > section input {background:#05060b;border-color:#343b62;}
      [data-guest-theme="club53"] button,[data-guest-theme="club53"] input {border-radius:2px;}
      [data-guest-theme="club53"] button:disabled {box-shadow:0 0 14px rgba(255,48,214,.24);}
      [data-guest-theme="club53"] nav a[aria-current="page"] {color:#ff3a43;text-shadow:0 0 8px rgba(211,18,28,.7);border:1px solid #d3121c;border-bottom:1px solid #d3121c;border-radius:2px;background:rgba(211,18,28,.08);box-shadow:0 0 8px rgba(211,18,28,.55),0 0 22px rgba(211,18,28,.24),inset 0 0 12px rgba(211,18,28,.08);}
      [data-guest-theme="club53"] footer {border-top:0!important;box-shadow:none;}
    `}</style>}
    {branding.theme === "blueprint" && <style>{`
      [data-guest-theme="blueprint"] { --border:0 0% 45%; position:relative; isolation:isolate; background:#000!important; background-image:none!important; }
      [data-guest-theme="blueprint"]::before {content:"";position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.42;background:url("/blueprint-paper-v2.png") repeat;background-size:min(100vw,1254px);filter:grayscale(1) brightness(.07) contrast(1.5);mix-blend-mode:screen;}
      [data-guest-theme="blueprint"]::after {content:"";position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.16;background:url("/blueprint-paper.png") repeat;background-size:340px;filter:grayscale(1) brightness(.06) contrast(1.7);mix-blend-mode:screen;}
      [data-guest-theme="blueprint"] > * {position:relative;z-index:1;}
      [data-guest-theme="blueprint"] h1,[data-guest-theme="blueprint"] h2 {font-family:Impact,Haettenschweiler,"Arial Narrow",sans-serif;text-transform:uppercase;font-weight:400;letter-spacing:0;}
      [data-guest-theme="blueprint"] h1 {font-size:48px;line-height:1;}
      [data-guest-theme="blueprint"] h2 {font-size:28px;line-height:1.1;}
      [data-guest-theme="blueprint"] h1,[data-guest-theme="blueprint"] h2 {color:#eee8dc;text-shadow:0 1px 0 rgba(255,255,255,.12);}
      [data-guest-theme="blueprint"] header {border-top:6px solid #e7e1d6;}
      [data-guest-theme="blueprint"] header>img {height:170px;aspect-ratio:auto;filter:grayscale(1) invert(1);padding:12px;}
      [data-guest-theme="blueprint"] header>div {background:#e7e1d6;color:#080808;}
      [data-guest-theme="blueprint"] header>div h1 {color:#080808;text-shadow:none;}
      [data-guest-theme="blueprint"] header p {color:#333;}
      [data-guest-theme="blueprint"] [data-menu-card] {border-color:#777;border-radius:2px;}
      [data-guest-theme="blueprint"] section.grid > section,[data-guest-theme="blueprint"] section.grid > div {background:rgba(10,10,10,.44)!important;border-color:rgba(238,232,220,.58);}
      [data-guest-theme="blueprint"] [data-menu-card] {background:rgba(8,8,8,.72);border-color:rgba(238,232,220,.72);}
      [data-guest-theme="blueprint"] [data-menu-section] {color:#eee8dc;text-transform:uppercase;letter-spacing:.08em;}
      [data-guest-theme="blueprint"] [data-menu-price] {color:#eee8dc;}
      [data-guest-theme="blueprint"] button,[data-guest-theme="blueprint"] input {border-radius:2px;}
      [data-guest-theme="blueprint"] nav a[aria-current="page"] {color:#080808;background:#eee8dc;border-color:#eee8dc;}
      [data-guest-theme="blueprint"] footer {border-color:#eee8dc;}
      [data-guest-theme="blueprint"] footer[aria-label="Event sponsors"] {background:rgba(0,0,0,.28);}
      [data-guest-theme="blueprint"] footer[aria-label="Event sponsors"] h2 {font-size:18px;color:#eee8dc;}
      [data-guest-theme="blueprint"] footer[aria-label="Event sponsors"] img {height:52px;width:150px;border:1px solid rgba(238,232,220,.55);object-fit:contain;}
    `}</style>}
    {branding.fontAssetId && <style>{`@font-face{font-family:"EXAGuest-${branding.fontAssetId}";src:url("${asset(branding.fontAssetId)}");font-display:swap;font-weight:100 900;}`}</style>}
    <div className="mx-auto grid w-full max-w-screen-2xl gap-5 p-4 sm:p-6">
        <header className={branding.theme === "club53" ? "guest-header-club53" : undefined} style={{ backgroundColor: branding.surfaceColor, backgroundImage: branding.theme === "club53" && branding.backgroundImageId ? `url("${asset(branding.backgroundImageId)}")` : undefined, backgroundSize: branding.theme === "club53" ? "cover" : undefined, backgroundPosition: branding.theme === "club53" ? "center" : undefined }}>
        {branding.headerImageId && <img src={asset(branding.headerImageId)} alt={`${title} event banner`} className="aspect-[16/5] w-full object-contain" />}
        <div className="border-b border-border px-5 py-6"><h1 className="break-words text-2xl font-semibold sm:text-3xl" style={{ overflowWrap: "anywhere" }}>{title}</h1>{subtitle && <p className="mt-2 break-words text-sm text-muted-foreground">{subtitle}</p>}</div>
      </header>
      {children}
      {branding.theme === "club53" && <footer className="flex flex-wrap items-end justify-between gap-5 border-t border-border py-7"><div><h2>Club53</h2><p className="mt-2 text-sm text-muted-foreground">Where the night belongs to us.</p></div>{branding.socialUrl && <a href={branding.socialUrl} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-4">@club53.ng</a>}</footer>}
      {branding.theme === "blueprint" && <footer className="flex flex-wrap justify-between gap-4 border-t-4 border-primary py-6 text-sm font-semibold uppercase"><span>{title} / Lagos</span>{branding.socialUrl && <a href={branding.socialUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">@theblueprintpro</a>}</footer>}
      {branding.theme === "night-market" && <footer className="flex flex-wrap items-end justify-between gap-5 border-t border-border px-5 py-8">
        <div><h2>{title}</h2><p className="mt-2 text-sm" style={{ color: "#ffd21c" }}>For those who dine after dark.</p></div>
        {branding.socialUrl && <a href={branding.socialUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary underline underline-offset-4">Find us on Instagram</a>}
      </footer>}
      {branding.sponsors.length > 0 && <footer className="border-t border-border px-5 py-6" style={{ backgroundColor: branding.surfaceColor }} aria-label="Event sponsors">
        <h2 className="mb-5 text-sm font-semibold">Our sponsors</h2>
        <div className="flex flex-wrap items-center gap-5">{branding.sponsors.map(sponsor => {
          const logo = <img src={asset(sponsor.logoAssetId)} alt={sponsor.name} className="h-16 w-36 object-contain" loading="lazy" />;
          return sponsor.website ? <a key={sponsor.id} href={sponsor.website} target="_blank" rel="noopener noreferrer" title={sponsor.name}>{logo}</a> : <div key={sponsor.id}>{logo}</div>;
        })}</div>
      </footer>}
    </div>
  </div>;
}
