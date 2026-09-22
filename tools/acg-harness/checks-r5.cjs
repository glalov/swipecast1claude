// Round 5 checks (2026-09-21): type quota, practical taglines and summaries,
// no reused sentence shapes, and the logic faults from three live drafts
// (In the Chair / Nobody Comes Here to Win / Long Way Home).
// Written independently of the generator's validator (v7Problems).
module.exports=function register({check,addBoard,sentences,clean,famOf,parseRoleRate,PROJECT_TYPE_OPTIONS}){
  const FILM=/^(Feature Film|Short Film|Student Film|Independent Film|Experimental Film|Documentary|Background \/ Extras|Stand-In|Body Double|Stunts)$/;
  const DOC=/^(Documentary|Reality \/ Docu-Series)$/;
  const BRAND=/^(Commercial|Branded Content|Social Media Ad|Influencer \/ UGC Content|Ad Campaign|Spec Commercial|Promo Video)$/;
  const minAge=r=>{const m=String(r.age_range||"").match(/(\d+)\s*-\s*(\d+)/);return m?+m[1]:NaN;};

  // 2. Tagline: a practical headline, not a note about technique.
  const TECH=/\b(is cut|are cut|cut to look|edited|in one take|single take|one unbroken shot|nobody says|never says the word|the word \w+ once|shot entirely|no cuts|split screen|montage|in real time|the camera|in the middle of filming)\b/i;
  const FORMAT=/\b(film|short|feature|doc|documentary|docu-series|series|show|pilot|trailer|reel|spot|commercial|ad|psa|public service announcement|campaign|video|shoot|play|musical|reading|read|voiceover|audio drama|podcast|game|animated|piece|event|job|booking|work|production|presentation|theater|stage|demo|session|miniseries|docu-series)\b/i;
  check(11,"r5_tagline_practical","Tagline is a director's note, or doesn't name the format",L=>{
    const t=String(L.tagline||"");const out=[];
    if(TECH.test(t))out.push({detail:`technique/theme: "${t}"`});
    if(!FORMAT.test(t))out.push({detail:`no format: "${t}"`});
    return out;
  });
  check(11,"r5_tagline_vs_cast","Tagline's cast count disagrees with the role list",L=>{
    const t=String(L.tagline||"");
    const W={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
    const m=t.match(/(?:casting|:)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\s+(men|women|actors|models|voice actors|hosts|performers|man|woman|actor|model|host|performer)\b/i);
    if(!m)return[];
    const people=L.roles.filter(r=>!/background/i.test(r.role_type||"")).length;
    return W[m[1].toLowerCase()]!==people?[{detail:`"${m[0]}" but ${people} non-background roles`}]:[];
  });

  // 3. The summary carries the practical facts.
  check(11,"r5_summary_practical","Summary lacks format/scale, the kind of work, or (brand work) category and usage",L=>{
    const s=String(L.synopsis||"");const out=[];
    if(!/\b(\d+-minute|\d+-episode|\d+-part|feature|minutes?|episodes?|performances?|sessions?|single|one day|days?|weeks?|afternoon|sitting|shoot|job|piece|play|musical|campaign|reading|series|event|booking|work)\b/i.test(s))out.push({detail:"no scale/days: "+s.slice(-120)});
    if(!/\b(dialogue|voice|stills|interviews?|reenact\w*|movement|dance|stunt|hosting|visual|silent|direct-to-camera|lens|lines|unscripted|two-hander|ensemble|capture|background work|set work|reactions|doubling|stand-in)\b/i.test(s))out.push({detail:"no kind of work: "+s.slice(-120)});
    if(BRAND.test(L.type)){
      if(!/\b(brand|company|business)\b/i.test(s))out.push({detail:"no product category"});
      if(!/\b(months?|year)\b/i.test(s))out.push({detail:"no usage"});   // "runs online for one year"
    }
    if(/\b(the cast is|we are casting|roles? (are|is) open|parts? to cast)\b/i.test(s))out.push({detail:"casting-process sentence"});
    return out;
  });

  // 4. Stock templates, and any sentence shape used twice across the board.
  const STOCK=/most of the story is \w+ and \w+ in the same room|lives on what \w+ and \w+ will not say to each other|nearly every scene puts \w+ opposite|carry the \w+ between them/i;
  check(11,"r5_stock_templates","A known stock template sentence",L=>{
    const t=[L.tagline,L.synopsis,...L.roles.map(r=>r.description)].join(" ");
    return STOCK.test(t)?[{detail:(t.match(STOCK)||[""])[0]}]:[];
  });
  check(11,"r5_shape_repeat","A sentence shape (names and numbers masked) reused across two listings",null);
  check(11,"r5_room_on_location","Scene partners 'in the same room' on a location that isn't a room",L=>{
    const t=L.roles.map(r=>r.description).join(" ");
    return /\bin the same room\b/i.test(t)&&/\b(car|cab|taxi|truck|bus|train|boat|ferry|van|street|road|field|park|beach|pier)\b/i.test(L.shoot_location||"")?[{detail:L.shoot_location}]:[];
  });

  // 5. Logic.
  const PEOPLE="men|women|people|friends|sisters|brothers|siblings|drivers|customers|strangers|students|kids|children|cousins|neighbors|coworkers|roommates|musicians|dancers|players|climbers|volunteers|nurses|parents|daughters|sons|teenagers|twins|widows|workers|guards|chefs|bakers|hosts";
  const ENC="conversations|calls|visitors|clients|guests|interviews|rides|passengers|riders|dates|appointments|deliveries|fares";
  check(11,"r5_cast_matches_promise","Summary promises N people/encounters but the cast is smaller",L=>{
    if(DOC.test(L.type))return[];
    const W={two:2,three:3,four:4,five:5,six:6};
    const re=new RegExp("\\b(two|three|four|five|six)\\s+(?:[a-z'-]+\\s+){0,2}?("+PEOPLE+"|"+ENC+")\\b","ig");
    const t=`${L.synopsis} ${L.tagline}`;let m,out=[];
    const cast=L.roles.filter(r=>!/background/i.test(r.role_type||"")).length;
    while((m=re.exec(t))){const n=W[m[1].toLowerCase()];const need=new RegExp("^("+ENC+")$","i").test(m[2])?n+1:n;if(cast<need)out.push({detail:`"${m[0]}" with ${cast} roles`});}
    return out.slice(0,1);
  });
  check(11,"r5_age_fits_subject","Age doesn't fit the part or the subject (an owner at 18–25, principals under 35 on a men's-health spot)",L=>{
    const out=[];const story=`${L._raw._setupText||""} ${L._raw._turnText||""} ${L.synopsis}`;
    const raw=L._raw._roles||[];
    L.roles.forEach(r=>{
      const x=raw.find(z=>z.name===r.name)||{};if(x._group)return;
      const t=`${x._slot||""} ${String(r.description||"").split(/[.!?]/).slice(0,2).join(" ")}`;
      if(/\b(teen|teenage|teenager|high school|student|kid|child|boy|girl|junior|youngest|intern|apprentice)\b/i.test(t))return;
      let need=0;
      if(/\bretired\b/i.test(t))need=60;else if(/\bveteran\b|\bcaptain\b/i.test(t))need=35;else if(/\b(owner|runs (her|his|their) own|manager|boss|chief|head of|landlord|foreman|principal|professor|surgeon|director|supervisor|proprietor)\b/i.test(t))need=28;
      if(/\b(men's health|avoid(s|ing)? (going to )?the doctor|put off going to the doctor|midlife|mid-life|middle-aged|prostate|checkups?)\b/i.test(story)&&/^(Lead|Principal|Supporting)$/i.test(r.role_type||"")&&!/\b(son|daughter|kid|child|boy|girl|teen|apprentice|intern|student)\b/i.test(x._slot||""))need=Math.max(need,35);
      if(need&&minAge(r)<need)out.push({detail:`${r.name} ${r.age_range} (${x._slot}) needs ${need}+`});
    });
    return out;
  });
  check(11,"r5_format_noun","'film' / 'movie' in a role, tagline or summary of a non-film project",L=>{
    if(FILM.test(L.type))return[];
    // The type's own label may say "film" ("dance film", "proof-of-concept film").
    const labels={"Proof of Concept":/proof-of-concept film/gi,"Dance Project":/dance film/gi};
    const hay=[L.tagline,L.synopsis.replace(labels[L.type]||/$^/,""),...L.roles.map(r=>r.description)].join(" ");
    const m=hay.match(/[^.]*\b(films?|movies?)\b(?!\s*(festival|maker))[^.]*/i);
    return m?[{detail:`${L.type}: ${m[0].trim().slice(0,100)}`}]:[];
  });
  check(11,"r5_documentary","Documentary casts named fictional characters, doesn't say reenactment, or tags a future event as known",L=>{
    if(!DOC.test(L.type))return[];
    const out=[];const raw=L._raw._roles||[];
    L.roles.forEach(r=>{const x=raw.find(z=>z.name===r.name)||{};if(/background/i.test(r.role_type||""))return;if(/^[A-Z][a-z]+ [A-Z][a-z'’-]+$/.test(r.name)&&!x._docRole)out.push({detail:`named character "${r.name}"`});});
    if(L.type==="Documentary"&&!/reenactment/i.test(L.synopsis))out.push({detail:"summary doesn't say reenactment roles"});
    if(/\b(is|are|gets?|will be) (sold|closed|demolished|shut down|cancelled|evicted)\b|\bin the middle of filming\b/i.test(L.tagline))out.push({detail:`future event: ${L.tagline}`});
    return out;
  });
  check(11,"r5_same_person","Same person at several ages cast as different genders",L=>{
    const t=`${L._raw._setupText||""} ${L._raw._turnText||""} ${L.tagline} ${L.synopsis}`;
    if(!/\bsame (person|passenger|man|woman|character|kid|girl|boy|driver|customer)\b[^.]*\bages?\b|\bat (two|three|four|different) (different )?ages\b/i.test(t))return[];
    const raw=L._raw._roles||[];
    const g=new Set(L.roles.filter(r=>!(raw.find(z=>z.name===r.name)||{})._group).map(r=>r.gender));
    return g.size>1?[{detail:[...g].join(" / ")}]:[];
  });
  check(11,"r5_minors_multiday","Minor on a 3+ day shoot without guardian, child-labor and school-hours language",L=>{
    const m=L.roles.filter(r=>minAge(r)<18&&+r.est_days>=3);
    if(!m.length)return[];
    const s=`${L.submission_requirements} ${L.schedule_note}`;
    return /guardian/i.test(s)&&/child[- ](labor|performer)/i.test(s)&&/school/i.test(s)?[]:[{detail:`${m[0].name} ${m[0].age_range}, ${m[0].est_days} days`}];
  });

  // 1 + 6. Board-level: type quota and expiration spread.
  check(11,"r5_type_quota","A type above 12% of the board, or a listed type absent from 100 straight listings",null);
  check(11,"r5_expiration_spread","More than two listings expire on the same date",null);
  addBoard((listings,add)=>{
    const names=L=>{const o=[];L.roles.forEach(r=>String(r.name||"").split(/\s+/).forEach(w=>{if(/^[A-Z][a-z'’.-]+$/.test(w))o.push(w);}));(L._raw._crewNames||[]).forEach(n=>String(n).split(/\s+/).forEach(w=>{if(/^[A-Z][a-z'’.-]+$/.test(w))o.push(w);}));return o;};
    const shape=(s,ns)=>{let t=" "+s+" ";ns.slice().sort((a,b)=>b.length-a.length).forEach(n=>{t=t.replace(new RegExp("\\b"+n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b","g")," N ");});return clean(t).replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|\d+)\b/g,"#").replace(/\s+/g," ").trim();};
    const seen=new Map();let idx=-1;
    listings.forEach(L=>{
      idx++;const ns=names(L);
      const sents=[...sentences(L.synopsis),L.tagline,...L.roles.flatMap(r=>sentences(r.description).slice(1))].filter(s=>String(s||"").split(/\s+/).length>=5);
      new Set(sents.map(s=>shape(s,ns))).forEach(k=>{if(seen.has(k)&&idx-seen.get(k)<50)add("r5_shape_repeat",L.id,`"${k.slice(0,70)}" (${idx-seen.get(k)} listings apart)`);seen.set(k,idx);});
    });
    const tc={};listings.forEach(L=>tc[L.type]=(tc[L.type]||0)+1);
    Object.entries(tc).forEach(([t,n])=>{if(n>listings.length*0.12)add("r5_type_quota","board",`${t}: ${n}/${listings.length}`);});
    if(listings.length>=100){
      for(let i=0;i+100<=listings.length;i+=25){const win=new Set(listings.slice(i,i+100).map(L=>L.type));const miss=(PROJECT_TYPE_OPTIONS||[]).filter(t=>t!=="Other"&&!win.has(t));if(miss.length){add("r5_type_quota","board",`listings ${i+1}-${i+100} missing: ${miss.join(", ")}`);break;}}
    }
    const ex={};listings.forEach(L=>{const k=String(L.expires_at||L.deadline||"").slice(0,10);ex[k]=(ex[k]||0)+1;});
    Object.entries(ex).forEach(([k,n])=>{if(n>2)add("r5_expiration_spread","board",`${k}: ${n}`);});
    global.__r5report={types:tc,expMax:Math.max(...Object.values(ex)),expDates:Object.keys(ex).length};
    return null;
  },[]);
};
