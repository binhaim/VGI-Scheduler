/* index.html 안의 <script type="module">을 그대로 뽑아 Node에서 돌린다.
   앱은 단일 HTML 파일이라 빌드가 없다 — 테스트도 같은 소스를 그대로 검증한다. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/* 테스트에서 쓰는 것만 열어 둔다 (없는 이름이면 import 단계에서 바로 터진다) */
const EXPORTS = [
  "state", "FB",
  "confirmMeeting", "unconfirmMeeting", "moveOccurrence", "addOccurrence", "swapOccurrence",
  "setOccCancel", "deleteOccurrence", "occurrencesOf", "seriesStarts", "syncSeries",
  "findMeetingSlots", "memberBusy", "memberAway", "awayOf", "locationBusy", "calEventsByDate",
  "weekOf", "addDays", "recurKey", "isLive",
  "viewCalendar", "viewCalWeek", "viewMeetings", "viewMeetingCard", "viewOccurrences",
  "viewFindWarn", "viewMeetingFind", "openFind", "doRender",
  /* 퍼즐 배치 보드 */
  "openBatch", "pzTray", "pzSeed", "pzIgnoreSet", "pzCanPlace", "pzConflict",
  "batchDays", "batchDiff", "applyBatch", "autoPlace", "solveBatch",
  "viewBatchCard", "viewPuzzleGrid", "mondayOf", "durChoices", "remapAvailability",
  "meetingHue", "meetingColor", "meetingColorPastel", "calSwitchMode",
];

function installDomStubs() {
  const el = () => ({
    innerHTML: "", value: "", scrollLeft: 0, scrollTop: 0, dataset: {}, style: {},
    classList: { add() {}, remove() {}, contains: () => false },
    querySelectorAll: () => [], addEventListener() {}, removeEventListener() {},
    appendChild() {}, remove() {}, scrollIntoView() {}, focus() {}, setAttribute() {},
  });
  const cache = {};
  globalThis.window = { addEventListener() {}, scrollY: 0, scrollTo() {} };
  globalThis.document = {
    getElementById: (id) => (cache[id] = cache[id] || el()),
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => el(),
    body: { classList: { add() {}, remove() {}, contains: () => false }, style: {}, appendChild() {}, removeChild() {} },
    documentElement: {},
  };
  globalThis.location = { hash: "", origin: "http://localhost", pathname: "/index.html" };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.confirm = () => true;
  globalThis.alert = () => {};
}

export async function loadApp() {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const open = '<script type="module">';
  const i = html.indexOf(open);
  const j = html.indexOf("</script>", i);
  if (i < 0 || j < 0) throw new Error("index.html에서 모듈 스크립트를 찾지 못했습니다");
  let src = html.slice(i + open.length, j).trimEnd();
  if (!src.endsWith("start();")) throw new Error("모듈 끝의 start() 호출을 찾지 못했습니다");
  src = src.slice(0, -"start();".length);          // 앱 부팅은 하지 않는다
  src += `\nexport {${EXPORTS.join(",")}};\nexport function setDbStub(stub){ FB=stub; }\n`;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vgi-app-"));
  const file = path.join(dir, "app.mjs");
  fs.writeFileSync(file, src);
  installDomStubs();
  const app = await import(pathToFileURL(file).href);

  /* Firebase 대신 로컬 state에 곧바로 반영 (서버 에코 흉내) */
  const nodeFor = (p) => {
    const parts = p.replace(/^vgi\/?/, "").split("/").filter(Boolean);
    let cur = app.state;
    for (let k = 0; k < parts.length - 1; k++) cur = (cur[parts[k]] = cur[parts[k]] || {});
    return [cur, parts[parts.length - 1]];
  };
  app.setDbStub({
    ref: (_db, p) => p,
    set: (p, v) => { const [o, k] = nodeFor(p); o[k] = JSON.parse(JSON.stringify(v)); return Promise.resolve(); },
    update: (p, v) => {
      const [o, k] = nodeFor(p); o[k] = o[k] || {};
      for (const f in v) { if (v[f] === null) delete o[k][f]; else o[k][f] = v[f]; }
      return Promise.resolve();
    },
    remove: (p) => { const [o, k] = nodeFor(p); delete o[k]; return Promise.resolve(); },
  });
  return app;
}

/* 로컬 시간대 기준 "YYYY-MM-DD" — 앱의 fmtDate와 같은 규칙 */
export const ds = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const todayDs = () => ds(new Date());
