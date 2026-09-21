/* Firebase 없이 목 데이터로 앱을 띄우는 미리보기 HTML을 만든다.
   실제 index.html을 그대로 쓰고 부팅 부분만 바꾸므로, 화면·조작은 배포본과 같다.
   사용: npm run preview [-- --out 경로]  → 만들어진 파일 경로를 출력 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BOOT = `
/* ===== 미리보기 부트스트랩 — Firebase 없이 목 데이터로 구동 (아무것도 저장되지 않습니다) ===== */
function mockNode(p){
  const parts=p.replace(/^vgi\\/?/,'').split('/').filter(Boolean);
  let cur=state;
  for(let i=0;i<parts.length-1;i++){ cur[parts[i]]=cur[parts[i]]||{}; cur=cur[parts[i]]; }
  return [cur,parts[parts.length-1]];
}
FB={
  ref:(_db,p)=>p,
  set:(p,v)=>{const[o,k]=mockNode(p);o[k]=JSON.parse(JSON.stringify(v));setTimeout(render,0);return Promise.resolve();},
  update:(p,v)=>{const[o,k]=mockNode(p);o[k]=o[k]||{};
    for(const f in v){ if(v[f]===null) delete o[k][f]; else o[k][f]=v[f]; } setTimeout(render,0);return Promise.resolve();},
  remove:(p)=>{const[o,k]=mockNode(p);delete o[k];setTimeout(render,0);return Promise.resolve();},
};
const MON=(()=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-d.getDay()+1);return d;})();
const at=(n,h,m)=>{const d=new Date(MON);d.setDate(d.getDate()+n);d.setHours(h,m||0,0,0);return d.getTime();};
const dsOf=n=>{const d=new Date(MON);d.setDate(d.getDate()+n);return fmtDate(d);};
Object.assign(state,{
  loading:false, tab:'meetings',
  settings:{activeSemester:'sem1',slotMinutes:20,dayStart:9,dayEnd:21,
    managers:{m2:true,m3:true}},   // 조정자: 이태영·박경문 — 가림 동작을 바로 볼 수 있게
  members:{m1:{name:'오경준',active:true,ts:1},m2:{name:'이태영',active:true,ts:2},
           m3:{name:'박경문',active:true,ts:3},m4:{name:'임하빈',active:true,ts:4}},
  semesters:{sem1:{name:'2026-2학기',startDate:dsOf(-14),endDate:dsOf(84),ts:1}},
  projects:{p1:{name:'FacePlex',members:{m1:true,m2:true},ts:1}},
  availability:{sem1:{
    m1:{d1:{'09:00':true,'09:20':true,'09:40':true},d3:{'13:00':true,'13:20':true}},
    m2:{d2:{'15:00':true,'15:20':true,'15:40':true}},
    m3:{d1:{'16:00':true,'16:20':true},d4:{'09:00':true,'09:20':true,'09:40':true,'10:00':true}},
  }},
  exceptions:{x1:{mid:'m2',title:'ICCV 학회',type:'conference',allDay:true,
    startDate:dsOf(21),endDate:dsOf(25),ts:1}},
  meetings:{
    mt1:{title:'CE 위클리',type:'meeting',durationMin:40,leads:{m1:true,m3:true},participants:{m1:true,m2:true,m3:true},
      rangeStart:dsOf(0),rangeEnd:dsOf(84),projectId:'p1',location:'세미나실',
      description:'',recurrence:{freq:'weekly',interval:1,until:dsOf(42)},status:'planning',ts:1},
    mt2:{title:'논문 리딩',type:'paper',durationMin:60,participants:{m1:true,m4:true},
      rangeStart:dsOf(0),rangeEnd:dsOf(42),projectId:'',location:'304호',
      description:'',recurrence:{freq:'weekly',interval:1,until:dsOf(42)},status:'planning',ts:2},
    mt3:{title:'FacePlex 킥오프',type:'conference',durationMin:60,participants:{m1:true,m3:true,m4:true},
      rangeStart:dsOf(0),rangeEnd:dsOf(14),projectId:'p1',location:'세미나실',
      description:'',recurrence:null,status:'planning',ts:3},
    mt4:{title:'Time Series',type:'seminar',durationMin:30,participants:{m2:true,m4:true},
      rangeStart:dsOf(0),rangeEnd:dsOf(42),projectId:'',location:'',
      description:'',recurrence:{freq:'weekly',interval:1,until:dsOf(42)},status:'planning',ts:4},
  },
  events:{},
});
/* 두 개는 미리 배정해 둔다 — 보드에서 배치·자리 바꾸기를 바로 볼 수 있게 */
confirmMeeting('mt1',at(1,14),at(1,14,40));
confirmMeeting('mt2',at(2,10),at(2,11));
(function seed(){
  const occ=occurrencesOf('mt1');
  if(occ[1]) FB.update(R('events/'+occ[1]),{start:at(9,10),end:at(9,10,40),moved:true});
  if(occ[3]) FB.update(R('events/'+occ[3]),{status:'cancelled'});
  addOccurrence('mt1',at(3,16),at(3,17));
  FB.set(R('events/ev_lab'),{title:'Full Lab Meeting',type:'seminar',start:at(4,11),end:at(4,12,20),
    participants:{m1:true,m2:true,m3:true,m4:true},projectId:'',location:'세미나실',ts:9});
})();
state.mtSel=null; state.mtFind=null; state.mtPick=null;
bindEvents();
const h=location.hash.slice(1);
if(NAV.some(([k])=>k===h)) state.tab=h;
render();
console.log('[preview] 목 데이터로 실행 중 — Firebase에 아무것도 쓰지 않습니다');
`;

const argOut = process.argv.indexOf("--out");
const outPath = argOut > -1 && process.argv[argOut + 1]
  ? path.resolve(process.argv[argOut + 1])
  : path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vgi-preview-")), "mock-app.html");

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const at = html.lastIndexOf("start();");
if (at < 0) throw new Error("index.html에서 start() 호출을 찾지 못했습니다");
const out = (html.slice(0, at) + BOOT + html.slice(at + "start();".length))
  .replace("<title>", "<title>[미리보기] ");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out);
console.log(outPath);
