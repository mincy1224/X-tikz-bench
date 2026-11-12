import type { ReactNode } from "react";

const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function TemplateArtwork({ index }: { index: number }) {
  let drawing: ReactNode;
  switch (index) {
    case 0:
      drawing = <><rect x="14" y="21" width="80" height="45" rx="4" {...line} /><path d="M43 21v45m27-45v45" {...line} /><circle cx="29" cy="43" r="4" fill="currentColor" opacity=".35" /><path d="M53 40h8m-8 6h8m19-6h6m-6 6h6" {...line} /></>;
      break;
    case 1:
      drawing = <><rect x="19" y="15" width="70" height="59" rx="4" {...line} /><path d="M42 15v59m24-59v59M19 35h70M19 55h70" {...line} /><circle cx="30" cy="25" r="2" fill="currentColor" /><circle cx="54" cy="46" r="2" fill="currentColor" /><circle cx="77" cy="65" r="2" fill="currentColor" /></>;
      break;
    case 2:
      drawing = <><rect x="9" y="28" width="25" height="18" rx="5" {...line} /><path d="M34 37h12m-4-4 4 4-4 4M46 37l17-14 17 14-17 14zM80 37h15m-4-4 4 4-4 4" {...line} /><rect x="95" y="28" width="24" height="18" rx="5" {...line} /></>;
      break;
    case 3:
      drawing = <><path d="M17 20h78a7 7 0 0 1 7 7v31a7 7 0 0 1-7 7H51L34 78l3-13H17a7 7 0 0 1-7-7V27a7 7 0 0 1 7-7z" {...line} /><path d="M28 38h51M28 47h37" {...line} /></>;
      break;
    case 4:
      drawing = <><path d="M15 22h24m0 0 3-5 5 10 5-10 5 10 5-5h35v48H15V22" {...line} /><path d="M15 51h-6m12 0h-6m0-11v22M76 70v-8m-6 0h12m-12 5h12" {...line} /></>;
      break;
    case 5:
      drawing = <><circle cx="32" cy="43" r="18" {...line} /><circle cx="87" cy="43" r="18" {...line} /><circle cx="87" cy="43" r="14" {...line} /><path d="M49 37q16-17 32-8m-5-3 5 3-3 5M70 58q-15 12-28 0m5 4-5-4 4-5" {...line} /></>;
      break;
    case 6:
      drawing = <><path d="M14 13v61h96M20 56q17-2 29-23 12-21 27 10 13 28 30-13" {...line} /><path d="M20 50q25-3 43-10 21-8 42-24" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 4" fill="none" opacity=".4" /></>;
      break;
    case 7:
      drawing = <><path d="M13 14v60h96" {...line} /><rect x="29" y="47" width="14" height="27" rx="2" fill="currentColor" opacity=".23" /><rect x="53" y="30" width="14" height="44" rx="2" fill="currentColor" opacity=".45" /><rect x="77" y="39" width="14" height="35" rx="2" fill="currentColor" opacity=".7" /></>;
      break;
    case 8:
      drawing = <><path d="M15 14v60h98M48 25v42m-9-32h18m-18 24h18M38 35h20v24H38zM84 16v58m-10-44h20m-20 34h20M73 30h22v34H73z" {...line} /><path d="M38 47h20M73 47h22" stroke="currentColor" strokeWidth="2.5" /></>;
      break;
    case 9:
      drawing = <><path d="M12 65 35 39 56 53 82 19 112 34" {...line} /><circle cx="12" cy="65" r="3" fill="currentColor" /><circle cx="35" cy="39" r="3" fill="currentColor" /><circle cx="56" cy="53" r="3" fill="currentColor" /><circle cx="82" cy="19" r="3" fill="currentColor" /><circle cx="112" cy="34" r="3" fill="currentColor" /></>;
      break;
    case 10:
      drawing = <path d="M10 64h29V28h32v27h39" {...line} />;
      break;
    case 11:
      drawing = <><path d="M10 65 41 40 70 53 106 20m-9 3 9-3-2 9" {...line} /><circle cx="41" cy="40" r="3" fill="currentColor" /><circle cx="70" cy="53" r="3" fill="currentColor" /></>;
      break;
    case 12:
      drawing = <path d="M16 60 51 70 98 51 81 17 35 12Z" fill="currentColor" fillOpacity=".12" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />;
      break;
    case 13:
      drawing = <><path d="M11 60C39 5 67 81 116 27" {...line} /><path d="M11 60 39 6M116 27 86 76" stroke="currentColor" strokeWidth="1" strokeDasharray="3 4" opacity=".35" fill="none" /><circle cx="11" cy="60" r="3" fill="currentColor" /><circle cx="116" cy="27" r="3" fill="currentColor" /></>;
      break;
    case 14:
      drawing = <><path d="M20 70V13m-4 5 4-5 4 5M20 70h93m-5-4 5 4-5 4M47 67v6M17 43h6" {...line} /></>;
      break;
    default:
      drawing = <><rect x="11" y="29" width="42" height="30" rx="5" {...line} /><path d="M22 36h-4v15h4m20-15h4v15h-4M60 44h14m-4-4 4 4-4 4" {...line} /><rect x="82" y="29" width="36" height="30" rx="5" {...line} /><path d="M93 36h-4v15h4m15-15h4v15h-4" {...line} /></>;
  }
  return <svg viewBox="0 0 128 88" aria-hidden="true" focusable="false">{drawing}</svg>;
}
