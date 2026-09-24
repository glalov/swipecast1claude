// Round 8 checks (2026-09-23): listings written the way real casting boards
// write them (304 live Backstage postings, Sept 2026). Written independently
// of the generator's r8Problems — own format lists, own regexes, own brand list.
module.exports=function register({check:check0,addBoard:addBoard0,real,sentences,clean,parseRoleRate,ACG,famous}){
  // Every round-8 check reads the listing as printed, not the legacy view.
  const check=(st,k,l,fn)=>check0(st,k,l,fn?(L=>fn(real(L))):null);
  const addBoard=(fn,labels)=>addBoard0((ls,add)=>fn(ls.map(real),add),labels);
  const BRAND=/^(Commercial|Spec Commercial|Branded Content|Social Media Ad|Influencer \/ UGC Content|Product Demo|Corporate Video|Industrial \/ Training Video|Educational Video|Photo Shoot|Print Campaign|Modeling|Live Event|Promo Video|Ad Campaign|Public Service Announcement|Voiceover)$/;
  const DOCU=/^(Documentary|Reality \/ Docu-Series|Lifestyle \/ Unscripted|Hosting \/ Presenter)$/;
  const JOB=/^(Background \/ Extras|Stand-In|Body Double|Stunts)$/;
  const FN=/^(Commercial|Spec Commercial|Branded Content|Social Media Ad|Influencer \/ UGC Content|Corporate Video|Industrial \/ Training Video|Educational Video|Product Demo|Public Service Announcement|Promo Video|Ad Campaign|Print Campaign|Photo Shoot|Modeling|Live Event|Background \/ Extras|Stand-In|Body Double|Stunts|Music Video|Voiceover)$/;
  const kind=t=>BRAND.test(t)?"brand":DOCU.test(t)?"docu":JOB.test(t)?"job":"narr";
  const FORMAT_WORD=/\b(Commercial|Ad|TVC|Content|Video|Videos|Short|Shoot|Campaign|UGC|Demo|Series|Photo|Print|Event|Activation|Promo|PSA|Announcement|Voiceover|Spot|Brand)\b/;
  const POETIC=["Lobby Level","Present Tense","Long Way Home"];
  // Real brands / networks / streamers / trademarks (independent list).
  const REAL=/\b(Nike|Adidas|Coca-Cola|Pepsi|Starbucks|McDonald'?s|Burger King|Walmart|Costco|Home Depot|IKEA|Sephora|Maybelline|Gillette|Amazon|Google|YouTube|Facebook|Instagram|TikTok|Snapchat|Microsoft|Samsung|iPhone|Verizon|AT&T|T-Mobile|Netflix|Hulu|HBO|Disney|Pixar|Marvel|Paramount|Peacock|Showtime|NBC|CBS|ABC|CNN|ESPN|MTV|Spotify|Uber|Lyft|DoorDash|Airbnb|Marriott|Hilton|Toyota|Honda|Chevrolet|Tesla|BMW|Mercedes|Geico|State Farm|Allstate|Visa|Mastercard|PayPal|Budweiser|Heineken|Oreo|Doritos|Levi'?s|Gucci|Prada|Chanel|Peloton|FedEx|Lego|LEGO|Etsy|eBay|Zoom|Apple TV|Prime Video)\b/;
  const persons=L=>(L._raw._roles||[]).filter(r=>!r._group&&!r._job);
  const isFull=n=>/^[A-Z][a-z'’.-]+ [A-Z][a-z'’-]+$/.test(String(n));
  const isFirst=n=>/^[A-Z][a-z'’.-]+(, .+)?$/.test(String(n))&&!/ /.test(String(n).split(",")[0]);

  check(14,"r8_title_rule","Title rule by format (brand: plain label; narrative: quoted; docu: label or quoted)",L=>{
    const t=String(L.title||""),k=kind(L.type);
    if(k==="brand"){
      if(/^['‘"“]/.test(t))return [{detail:`${L.type} quoted: ${t}`}];
      if(!FORMAT_WORD.test(t))return [{detail:`${L.type} no format word: ${t}`}];
      const stems=(L._raw._r8Stems||[]).concat(POETIC).map(clean).filter(x=>x.length>4);
      const hit=stems.find(x=>clean(t).indexOf(x)>-1&&!/^(commercial|campaign|photo shoot)$/.test(x));
      return hit?[{detail:`${L.type} invented title "${hit}": ${t}`}]:[];
    }
    if(/^Untitled [A-Z]/.test(t))return [];
    if(/^'.+'(,? [A-Z][\w -]+)?$/.test(t))return [];
    if(k==="docu"&&/^[A-Z][\w -]+, [A-Z][\w' -]+$/.test(t))return [];
    return [{detail:`${L.type}: ${t}`}];
  });
  check(14,"r8_summary_opener","Summary doesn't open with 'Casting…' or 'Seeking…'",L=>/^(Casting|Seeking)\b/.test(String(L.synopsis))?[]:[{detail:String(L.synopsis).slice(0,80)}]);
  check(14,"r8_real_brands","Real brand, company, network, streamer or celebrity name anywhere",L=>{
    const t=[L.title,L.tagline,L.synopsis,L.pay,L.schedule_note,L.submission_requirements,L.prod,L.crew_credits,...L.roles.map(r=>`${r.name} ${r.description}`)].join("\n");
    const out=[];const m=t.match(REAL);if(m)out.push({detail:m[0]});
    const w=t.replace(/[^A-Za-z'’ -]/g," ").split(/\s+/);
    for(let i=0;i+1<w.length;i++){const two=`${w[i]} ${w[i+1]}`;if(/^[A-Z]/.test(w[i])&&/^[A-Z]/.test(w[i+1])&&famous.has(clean(two)))out.push({detail:two});}
    return out.slice(0,1);
  });
  check(14,"r8_role_type","Role type off the list, or not the one the format calls for (UGC→Content Creators, stills→Models, reality→Real People)",L=>{
    const ok=/^(Lead|Supporting|Principal|Featured|Day Player|Background|Real People|Content Creators|Models|Voiceover|Host|Co-Star|Series Regular|Recurring|Guest Star|Stand-In|Body Double|Stunt Performer|Photo Double|Featured Background|Dancer|Singer|Ensemble|Understudy|Swing)$/;
    const out=[];
    L.roles.forEach(r=>{
      const t=String(r.role_type||"");
      if(!ok.test(t))out.push({detail:`${r.name}: "${t}"`});
      else if(t!=="Background"&&L.type==="Influencer / UGC Content"&&t!=="Content Creators")out.push({detail:`UGC ${r.name}: ${t}`});
      else if(t!=="Background"&&/^(Photo Shoot|Print Campaign|Modeling)$/.test(L.type)&&t!=="Models")out.push({detail:`stills ${r.name}: ${t}`});
      else if(t!=="Background"&&/^(Reality \/ Docu-Series|Lifestyle \/ Unscripted)$/.test(L.type)&&t!=="Real People")out.push({detail:`reality ${r.name}: ${t}`});
    });
    return out;
  });
  check(14,"r8_role_caps","Commercial role printed in capitals, or a full person name on a commercial role",L=>{
    if(!FN.test(L.type))return [];
    return persons(L).filter(r=>/[A-Z]{3}/.test(r.name.replace(/\b(UGC|PSA|TV|DJ|EMT|CEO|NYC)\b/g,""))||(isFull(r.name)&&r.name===r._person)).map(r=>({detail:r.name}));
  });
  check(14,"r8_dates_line","Dates line not in board format",L=>{
    const line=ACG.datesLine(L._raw);
    const MON="(Jan\\.|Feb\\.|March|April|May|June|July|Aug\\.|Sept\\.|Oct\\.|Nov\\.|Dec\\.)";
    const ok=[
      new RegExp(`^(Shoots|Records|Works|Reads) ${MON} \\d{1,2}(-(${MON} )?\\d{1,2})? in [A-Z][^.]+\\.`),
      new RegExp(`^Rehearsals begin in [A-Z][a-z]+; performances ${MON} \\d{1,2}-(${MON} )?\\d{1,2} in [A-Z][^.]+\\.`),
      /^(Shoot|Session|Recording|Rehearsal and performance|Event) dates (TBD|TBC) in [A-Z][^.]+\./,/^Dates (TBD|TBC); (shoots|records) (one day|[a-z0-9]+ days) in [A-Z][^.]+\./,
      /^Records remotely( from a home studio)?\./,/^Shoots remotely; deliver content within (one|two) weeks? of booking\./,/^Self-shot at home; content due (one|two) weeks? after booking\./,
      /^(Shoots|Records|Works) (one day|[a-z]+ days|\d+ days starting) in (early |mid-|late )[A-Z][a-z]+ in [A-Z][^.]+\./,/^Rehearsals begin in (early |mid-|late )[A-Z][a-z]+ in [A-Z][^.]+\./
    ];
    const head=ok.find(re=>re.test(line));
    if(!head)return [{detail:line}];
    const rest=line.replace(head,"").trim();
    return !rest||/^Note: [A-Z][^.]*\.$/.test(rest)?[]:[{detail:line}];
  });
  check(14,"r8_pay_headline","Pay box doesn't lead with 'Roles paying up to $X' (X = top role rate), 'Unpaid' or 'Payment not specified'",L=>{
    const p=String(L.pay||"");
    const rates=L.roles.map(r=>parseRoleRate(r.pay)).filter(Boolean).map(x=>x.rate_amount);
    if(!rates.length)return /^(Unpaid\b|Payment not specified\.)/.test(p)?[]:[{detail:p.slice(0,80)}];
    const m=p.match(/^Roles paying up to \$([\d,]+(?:\.\d\d)?)\./);
    if(!m)return [{detail:p.slice(0,80)}];
    return Math.abs(+m[1].replace(/,/g,"")-Math.max(...rates))<0.01?[]:[{detail:`headline ${m[1]} vs top ${Math.max(...rates)}`}];
  });
  check(14,"r8_unpaid_formats","Unpaid or deferred outside student, short, spec and passion formats",L=>{
    const rates=L.roles.map(r=>parseRoleRate(r.pay)).filter(Boolean);
    if(rates.length||/^Payment not specified/.test(L.pay))return [];
    return /^(Student Film|Short Film|Experimental Film|Proof of Concept|Pitch Trailer|Sizzle Reel|Web Series|Vertical Series|Pilot Presentation|Independent Film|Feature Film|Table Read|Workshop \/ Staged Reading|Off-Off-Broadway Theater|Theater|Off-Broadway Theater|Musical Theater|Podcast \/ Audio Drama|Dance Project|Performance Art|Music Video|Spec Commercial|Photo Shoot|Documentary|Animation)$/.test(L.type)?[]:[{detail:L.type}];
  });

  // ── Board level ───────────────────────────────────────────────────────────
  const CAT={online:["Commercial","Branded Content","Ad Campaign","Spec Commercial","Public Service Announcement"],short:["Short Film"],tvc:["Commercial|tv"],photo:["Photo Shoot","Print Campaign","Modeling"],feature:["Feature Film","Independent Film"],social:["Social Media Ad","Influencer / UGC Content"],series:["Web Series","Vertical Series","TV Series","Streaming Series","TV Pilot"],corp:["Corporate Video","Industrial / Training Video"],demo:["Product Demo"],events:["Live Event","Promo Video"],stage:["Theater","Musical Theater","Off-Off-Broadway Theater"],music:["Music Video"],docu:["Documentary","Reality / Docu-Series"],student:["Student Film"],audio:["Voiceover","Animation","Podcast / Audio Drama","Video Game"]};
  const WANT={online:25,short:12,tvc:9,photo:8,feature:8,social:8,series:5,corp:3,demo:3,events:3,stage:3,music:2,docu:3,student:3,audio:3,other:2};
  const catOf=L=>{const k=L.type==="Commercial"&&/\bTV\b|\bTVC\b|Broadcast/.test(L.title)?"Commercial|tv":L.type;return Object.keys(CAT).find(c=>CAT[c].indexOf(k)>-1)||"other";};
  const PAYW={u200:10,b200:30,b500:25,b1000:20,b2500:8,ns:7};
  const band=L=>{if(/^Payment not specified/.test(L.pay))return "ns";const t=Math.max(0,...L.roles.map(r=>{const x=parseRoleRate(r.pay);return x?x.rate_amount:0;}));return !t||t<200?"u200":t<500?"b200":t<1000?"b500":t<2500?"b1000":"b2500";};
  addBoard((listings,add)=>{
    const n=listings.length;const pct=x=>Math.round(x*1000/n)/10;
    const R={n,cat:{},pay:{},open:{},len:{},dates:{},ofNote:0,states:0,commRoles:0,commFirst:0,commFull:0,narrRoles:0,narrFull:0,titleFails:{},missingWindows:[]};
    listings.forEach(L=>{
      const c=catOf(L);R.cat[c]=(R.cat[c]||0)+1;
      const b=band(L);R.pay[b]=(R.pay[b]||0)+1;
      const o=(String(L.synopsis).match(/^(Casting|Seeking)/)||["other"])[0];R.open[o]=(R.open[o]||0)+1;
      const ns=sentences(String(L.synopsis).replace(/\w+ states: "[^"]*"/g,"")).length;const lk=ns<=1?"one":ns<=3?"two-three":"longer";R.len[lk]=(R.len[lk]||0)+1;
      const dk=L.shoot_start?"dated":/remotely|Self-shot/.test(L.schedule_note)?"remote":/\b(TBD|TBC)\b/.test(L.schedule_note)?"tbd":"vague";R.dates[dk]=(R.dates[dk]||0)+1;
      if(/Of Note:/.test(L.pay))R.ofNote++;
      if(/\bstates: "/.test(L.synopsis))R.states++;
      persons(L).forEach(r=>{
        if(FN.test(L.type)){R.commRoles++;if(r.name===String(r._person||"").split(" ")[0])R.commFirst++;if(r._person&&r.name===r._person)R.commFull++;}
        else if(!DOCU.test(L.type)){R.narrRoles++;if(isFull(r.name))R.narrFull++;}
      });
    });
    // Every category appears in every 100-listing window.
    for(let s=0;s+100<=n;s+=10){const seen=new Set(listings.slice(s,s+100).map(catOf));const miss=Object.keys(WANT).filter(k=>!seen.has(k));if(miss.length)R.missingWindows.push(`${s+1}-${s+100}: ${miss.join(",")}`);}
    Object.entries(WANT).forEach(([k,w])=>{const got=pct(R.cat[k]||0);if(Math.abs(got-w)>Math.max(3,w*0.4))add("r8_type_mix","board",`${k} ${got}% vs ${w}%`);});
    R.missingWindows.slice(0,3).forEach(x=>add("r8_type_mix","board","missing in window "+x));
    Object.entries(PAYW).forEach(([k,w])=>{const got=pct(R.pay[k]||0);if(Math.abs(got-w)>8)add("r8_pay_mix","board",`${k} ${got}% vs ${w}%`);});
    const tbd=pct((R.dates.tbd||0)+(R.dates.remote||0));if(tbd<22||tbd>38)add("r8_tbd_share","board",`TBD/remote ${tbd}% vs ~30%`);
    const cs=pct(R.open.Casting||0);if(cs<48||cs>72)add("r8_open_mix","board",`Casting ${cs}% vs ~60%`);
    const ln={one:40,"two-three":45,longer:15};Object.entries(ln).forEach(([k,w])=>{const got=pct(R.len[k]||0);if(Math.abs(got-w)>10)add("r8_len_mix","board",`${k} ${got}% vs ${w}%`);});
    const cf=R.commRoles?Math.round(R.commFirst*1000/R.commRoles)/10:0,nf=R.narrRoles?Math.round(R.narrFull*1000/R.narrRoles)/10:0;
    if(cf>8||R.commFull)add("r8_name_share","board",`commercial first names ${cf}%, full names ${R.commFull}`);
    if(nf>15)add("r8_name_share","board",`narrative full names ${nf}%`);
    R.commFirstPct=cf;R.narrFullPct=nf;
    global.__r8report=R;
  },[["r8_type_mix","Type mix within tolerance of the per-100 targets, every category in every 100-listing window"],["r8_pay_mix","Pay-tier spread within 8 points of target"],["r8_tbd_share","TBD / TBC / remote share ~30% (22–38)"],["r8_open_mix","Casting/Seeking ~60/40"],["r8_len_mix","Summary length ~40/45/15 (±10)"],["r8_name_share","Commercial first-name roles ≤8% and no full names; narrative full names ≤15%"]]);
};
