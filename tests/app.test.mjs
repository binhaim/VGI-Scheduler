/* 앱(index.html)의 도메인 로직과 화면 조립을 Node에서 검증한다.
   브라우저 없이 돌리려고 DOM은 최소 스텁, Firebase는 로컬 state 반영 스텁을 쓴다. */
import assert from "node:assert/strict";
import test from "node:test";
import { loadApp, ds, todayDs } from "./harness.mjs";

const app = await loadApp();
const { state } = app;

const A = app.addDays;
const D = (day, h, m = 0) =>
  new Date(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`).getTime();

/* 오늘이 언제든 같은 결과가 나오도록 모든 날짜를 오늘 기준 상대로 잡는다 */
const TODAY = todayDs();
const SEM_START = A(TODAY, -7);
const SEM_END = A(TODAY, 120);
const MON = A(app.weekOf(TODAY)[0], 8);      // 다음 주 월요일
const WED = A(MON, 2);
const [WS, WE] = app.weekOf(MON);

function reset(opts = {}) {
  Object.assign(state, {
    loading: false, tab: "meetings",
    settings: { activeSemester: "sem1", slotMinutes: 30, dayStart: 9, dayEnd: 21 },
    members: {
      m1: { name: "오경준", active: true, ts: 1 },
      m2: { name: "이태영", active: true, ts: 2 },
      m3: { name: "박경문", active: true, ts: 3 },
    },
    semesters: { sem1: { name: "테스트 학기", startDate: SEM_START, endDate: SEM_END, ts: 1 } },
    projects: {}, events: {}, exceptions: {},
    availability: { sem1: { m1: { d1: { "09:00": true, "09:30": true } } } },  // m1은 월 오전 불가
    meetings: {
      mt1: {
        title: "CE 위클리", type: "meeting", durationMin: 60,
        participants: { m1: true, m3: true },
        rangeStart: TODAY, rangeEnd: A(TODAY, 60),
        projectId: "", location: "세미나실", description: "",
        recurrence: opts.recur === undefined
          ? { freq: "weekly", interval: 1, until: A(MON, 21) }   // 4회차
          : opts.recur,
        status: "planning", ts: 1,
      },
    },
    mtDraft: null, mtFind: null, mtPick: null, batch: null,
    calMode: "week", calWeek: WS, calMonth: TODAY.slice(0, 7), calPick: null,
    calMember: "", calProject: "", calType: "", occPast: {},
    evEdit: null, xDraft: null, subscribeFor: null, showHelp: false,
  });
}

/* ---------------- 반복 미팅과 회차 ---------------- */
test("매주 반복을 확정하면 종료일까지 회차가 한 번에 생긴다", () => {
  reset();
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  const occ = app.occurrencesOf("mt1");
  assert.deepEqual(occ.map((id) => ds(new Date(state.events[id].start))),
    [MON, A(MON, 7), A(MON, 14), A(MON, 21)]);
  assert.equal(state.meetings.mt1.status, "confirmed");
  assert.ok(occ.every((id) => state.events[id].seriesId === "mt1"));
});

test("격주와 반복 없음", () => {
  reset({ recur: { freq: "weekly", interval: 2, until: A(MON, 21) } });
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  assert.equal(app.occurrencesOf("mt1").length, 2);
  reset({ recur: null });
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  assert.equal(app.occurrencesOf("mt1").length, 1);
});

test("회차 하나만 옮겨도 나머지는 그대로다", () => {
  reset();
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  const [first, second] = app.occurrencesOf("mt1");
  app.moveOccurrence(second, D(A(MON, 8), 10), D(A(MON, 8), 11));
  assert.equal(state.events[second].moved, true);
  assert.equal(new Date(state.events[second].start).getHours(), 10);
  assert.equal(new Date(state.events[first].start).getHours(), 14);
  assert.equal(app.occurrencesOf("mt1").length, 4);
});

test("취소한 회차는 목록에 남지만 충돌 계산과 장소 점유에서 빠진다", () => {
  reset();
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  const id = app.occurrencesOf("mt1")[0];
  const [s, e] = [D(MON, 14), D(MON, 15)];
  assert.ok(app.memberBusy("m1", s, e));
  assert.ok(app.locationBusy("세미나실", s, e));
  app.setOccCancel(id, true);
  assert.equal(app.isLive(state.events[id]), false);
  assert.equal(app.memberBusy("m1", s, e), false);
  assert.equal(app.locationBusy("세미나실", s, e), false);
  assert.equal(app.occurrencesOf("mt1").length, 4);
  app.setOccCancel(id, false);
  assert.ok(app.memberBusy("m1", s, e));
});

test("같은 주에 회차를 더 넣을 수 있고, 전부 지우면 다시 조율 상태가 된다", () => {
  reset();
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  app.addOccurrence("mt1", D(WED, 16), D(WED, 17));
  const occ = app.occurrencesOf("mt1");
  assert.equal(occ.length, 5);
  assert.equal(occ.filter((id) => state.events[id].extra).length, 1);
  assert.equal(occ.indexOf(occ.find((id) => state.events[id].extra)), 1);   // 시간순
  occ.slice(0, 4).forEach((id) => app.deleteOccurrence(id));
  assert.equal(state.meetings.mt1.status, "confirmed");
  app.deleteOccurrence(occ[4]);
  assert.equal(state.meetings.mt1.status, "planning");
});

test("반복 종료일을 늘리면 회차가 이어서 만들어지고 미래 회차만 갱신된다", () => {
  reset();
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  const obj = { ...state.meetings.mt1, title: "CE 위클리 v2", location: "304호",
    recurrence: { freq: "weekly", interval: 1, until: A(MON, 42) } };
  state.meetings.mt1 = obj;
  app.syncSeries("mt1", obj);
  const occ = app.occurrencesOf("mt1");
  assert.equal(occ.length, 7);
  assert.ok(occ.every((id) => state.events[id].title === "CE 위클리 v2"));
  assert.ok(occ.every((id) => state.events[id].location === "304호"));
});

/* ---------------- 후보 시간 계산 ---------------- */
test("90분 미팅은 30분 칸 3개가 연속으로 비어야 후보가 된다", () => {
  reset({ recur: null });
  state.meetings.mt1.durationMin = 90;
  state.events.other = { title: "다른 미팅", type: "seminar", start: D(WED, 14), end: D(WED, 15),
    participants: { m3: true }, ts: 1 };
  const f = app.findMeetingSlots(state.meetings.mt1, { from: WED, to: WED, allDays: true, maxDays: 7 });
  const day = f.days[0];
  assert.equal(f.dur, 90);
  assert.equal(day.ok[13 * 60], undefined);      // 13:00~14:30 은 겹친다
  assert.equal(day.ok[13 * 60 + 30], undefined);
  assert.ok(day.ok[12 * 60 + 30]);               // 12:30~14:00 은 딱 붙어 괜찮다
  assert.ok(day.ok[19 * 60 + 30]);               // 하루 끝(21:00)에 딱 맞음
  assert.equal(day.ok[20 * 60], undefined);
  assert.equal(day.cells[14 * 60].kind, "ev");   // 무엇이 막는지도 담는다
  assert.equal(day.cells[14 * 60].title, "다른 미팅");
  assert.equal(day.cells[14 * 60].head, true);
  assert.equal(day.cells[14 * 60 + 30].head, false);
});

test("참여자 불가 칸은 누구 때문인지 담는다", () => {
  reset({ recur: null });
  const f = app.findMeetingSlots(state.meetings.mt1, { from: WS, to: WE, allDays: true, maxDays: 7 });
  assert.equal(f.days.length, 7);
  const mon = f.days.find((d) => d.ds === MON);
  assert.equal(mon.cells[9 * 60].kind, "na");
  assert.deepEqual(mon.cells[9 * 60].who, ["m1"]);
  assert.equal(mon.cells[11 * 60].kind, "free");
});

test("시간 변경 격자는 자기 자신을 비켜준다", () => {
  reset({ recur: null });
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  const id = app.occurrencesOf("mt1")[0];
  const withSelf = app.findMeetingSlots(state.meetings.mt1, { from: WS, to: WE, allDays: true, maxDays: 7 });
  const ignoring = app.findMeetingSlots(state.meetings.mt1, { from: WS, to: WE, allDays: true, maxDays: 7, ignoreEventId: id });
  assert.equal(withSelf.days.find((d) => d.ds === MON).ok[14 * 60], undefined);
  assert.ok(ignoring.days.find((d) => d.ds === MON).ok[14 * 60]);
});

test("길이가 같으면 자리를 맞바꾸고, 달라서 겹치면 거부한다", () => {
  reset({ recur: null });
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  const a = app.occurrencesOf("mt1")[0];
  state.events.b = { title: "논문 리딩", type: "paper", start: D(WED, 10), end: D(WED, 11),
    participants: { m1: true }, ts: 2 };
  app.swapOccurrence(a, "b");
  assert.equal(state.events[a].start, D(WED, 10));
  assert.equal(state.events.b.start, D(MON, 14));
  assert.equal(state.meetings.mt1.confirmedStart, D(WED, 10));

  reset({ recur: null });
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));           // 60분
  const a2 = app.occurrencesOf("mt1")[0];
  state.events.c = { title: "긴 세미나", type: "seminar", start: D(MON, 15), end: D(MON, 17),
    participants: { m1: true }, ts: 2 };                        // 120분, 바로 뒤
  app.swapOccurrence(a2, "c");
  assert.equal(state.events[a2].start, D(MON, 14));             // 그대로
  assert.equal(state.events.c.start, D(MON, 15));
});

/* ---------------- '전원 가능'의 진짜 원인 ---------------- */
test("학기 시작 전 구간은 기본 검색에서 빼고, 왜 뺐는지 알린다", () => {
  reset({ recur: null });
  const semStart = A(TODAY, 30);
  state.semesters.sem1.startDate = semStart;
  state.meetings.mt1.rangeStart = TODAY;
  const f = app.findMeetingSlots(state.meetings.mt1, { mtid: "mt1" });
  assert.equal(f.clamped, TODAY);
  assert.equal(f.days[0].ds, semStart);
  assert.equal(f.outTotal, 0);
  const all = app.findMeetingSlots(state.meetings.mt1, { mtid: "mt1", noClamp: true });
  assert.equal(all.clamped, null);
  assert.equal(all.days[0].outSem, true);
  assert.ok(all.outTotal > 0);
  const warn = app.viewFindWarn("mt1", f);
  assert.match(warn, /학기 밖/);
  assert.match(warn, /data-act="mtfindall"/);
});

test("반복 불가 시간을 입력하지 않은 참여자를 이름으로 경고한다", () => {
  reset({ recur: null });
  const f = app.findMeetingSlots(state.meetings.mt1, { mtid: "mt1" });
  assert.deepEqual(f.noAvail, ["m3"]);                 // m1만 입력되어 있다
  assert.match(app.viewFindWarn("mt1", f), /박경문/);
  state.semesters = {}; state.settings.activeSemester = "";
  const g = app.findMeetingSlots(state.meetings.mt1, { mtid: "mt1" });
  assert.equal(g.sem, null);
  assert.match(app.viewFindWarn("mt1", g), /활성 학기가 없어/);
});

/* ---------------- 주간 뷰 (Calendar) ---------------- */
test("주간 뷰는 그 주 배치를 요일×시간 칸에 그리고 종일 예외를 윗줄에 둔다", () => {
  reset({ recur: null });
  state.tab = "calendar";
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  state.exceptions = { x1: { mid: "m1", title: "ICCV", type: "conference", allDay: true,
    startDate: WED, endDate: A(WED, 1), ts: 1 } };
  const { html, count } = app.viewCalWeek(new Date(`${MON}T00:00:00`));
  assert.match(html, /CE 위클리/);
  assert.match(html, /data-act="calevpick"/);
  assert.match(html, /종일/);
  assert.match(html, /ICCV/);
  assert.match(html, /data-act="calslot"/);
  assert.equal(count, 3);                              // 미팅 1 + 종일 예외 2일
});

test("매주 반복은 주를 넘겨도 같은 자리에 나오고, 취소한 주만 취소선으로 남는다", () => {
  reset();
  state.tab = "calendar";
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  const seen = [];
  for (let i = 0; i < 4; i++) {
    state.calWeek = A(WS, 7 * i);
    seen.push(/CE 위클리/.test(app.viewCalWeek(new Date()).html));
  }
  assert.deepEqual(seen, [true, true, true, true]);
  app.setOccCancel(app.occurrencesOf("mt1")[2], true);
  state.calWeek = A(WS, 14);
  assert.match(app.viewCalWeek(new Date()).html, /wk-blk off/);
});

test("주간 뷰에서 일정을 고르면 그 회차를 바로 고칠 수 있다", () => {
  reset({ recur: null });
  state.tab = "calendar";
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  state.calPick = app.occurrencesOf("mt1")[0];
  const { html } = app.viewCalWeek(new Date());
  assert.match(html, /data-act="occmove"[^>]*data-cal="1"/);
  assert.match(html, /data-act="occadd"[^>]*data-cal="1"/);
  assert.match(html, /data-act="occcancel"/);
});

test("시간 변경 중에는 현재 시간대·후보 칸·자리 바꾸기가 한 화면에 나온다", () => {
  reset({ recur: null });
  state.tab = "calendar";
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  const evid = app.occurrencesOf("mt1")[0];
  state.events.b = { title: "논문 리딩", type: "paper", start: D(WED, 10), end: D(WED, 11),
    participants: { m1: true }, ts: 2 };
  app.openFind("mt1", { mode: "move", evid, from: WS, to: WE, dur: 60, maxDays: 7,
    allDays: true, inCal: "cal", scope: "주", cur: { s: D(MON, 14), e: D(MON, 15) } });
  const { html } = app.viewCalWeek(new Date());
  assert.match(html, /현재 14:00~15:00/);
  assert.match(html, /wk-cell[^"]*cand[^"]*"[^>]*data-act="mtpick"/);
  assert.match(html, /data-act="mtswap"[^>]*data-evid="b"/);
  assert.match(html, /data-act="mtdur"/);
  assert.doesNotMatch(html, /data-act="calslot"/);     // 수정 중엔 빈 칸 추가가 아니다
});

test("고른 시간은 길이만큼 칸이 통째로 표시된다", () => {
  reset({ recur: null });
  state.tab = "calendar";
  app.openFind("mt1", { mode: "move", evid: "", from: WS, to: WE, dur: 90, maxDays: 7,
    allDays: true, inCal: "cal", scope: "주" });
  state.mtPick = { mtid: "mt1", s: D(WED, 13), e: D(WED, 14, 30) };
  const { html } = app.viewCalWeek(new Date());
  assert.equal([...html.matchAll(/class="wk-cell[^"]*\bsel\b[^"]*"/g)].length, 3);
  assert.match(html, /✓ 13:00~14:30/);
});

/* ---------------- 퍼즐 배치 보드 (Meetings) ---------------- */
/* 보드는 월~금이라 요일 계산이 자주 나온다 */
const MON_OF = (w) => A(w, 1);

test("보드를 열면 조율 중인 미팅은 트레이에, 확정된 미팅은 그 주 자리에 올라온다", () => {
  reset();
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  state.meetings.mt2 = { ...state.meetings.mt1, title: "논문 리딩", status: "planning",
    recurrence: null, participants: { m2: true }, ts: 2 };
  app.openBatch();
  const b = state.batch;
  assert.equal(b.week, app.mondayOf(TODAY), "기준 주는 이번 주 월요일");
  assert.equal(new Date(b.week).getDay(), 1);
  /* 확정 미팅이 잡힌 주를 보면 그 회차 시각 그대로 올라온다 */
  b.week = app.mondayOf(MON);
  b.placed = app.pzSeed(b.week);
  b.seed = { ...b.placed };
  assert.deepEqual(Object.keys(b.placed), ["mt1"], "확정된 미팅만 미리 놓인다");
  assert.equal(b.placed.mt1.s, D(MON, 14));
  assert.equal(b.pick, "mt2", "안 놓인 블록이 자동 선택된다");
  const html = app.viewBatchCard();
  assert.match(html, /퍼즐 배치/);
  assert.match(html, /data-pz="mt1"/);
  assert.match(html, /data-pz="mt2"/);
  assert.match(html, /뺀 블록 1/);
  assert.match(html, /놓은 블록 1/);
});

test("보드에 올라온 미팅은 자기 회차 때문에 막히지 않는다", () => {
  reset();
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  app.openBatch();
  const ign = app.pzIgnoreSet();
  assert.equal(ign.size, app.occurrencesOf("mt1").length, "자기 회차는 전부 계산에서 뺀다");
  assert.ok(app.pzCanPlace("mt1", D(MON, 14), D(MON, 15), ign), "제자리에 다시 놓을 수 있어야 한다");
  assert.ok(app.pzCanPlace("mt1", D(WED, 14), D(WED, 15), ign));
});

test("블록을 고르면 들어갈 수 있는 칸만 초록으로 켜지고, 불가 시간은 빠진다", () => {
  reset();
  app.openBatch();
  state.batch.pick = "mt1";
  const html = app.viewPuzzleGrid();
  assert.match(html, /data-act="pzdrop"/);
  const ign = app.pzIgnoreSet();
  assert.equal(app.pzCanPlace("mt1", D(MON, 9), D(MON, 10), ign), false, "m1은 월 오전 불가");
  assert.ok(app.pzCanPlace("mt1", D(MON, 14), D(MON, 15), ign));
  /* 놓인 블록이 있으면 그 시간대는 후보에서 빠진다 (참여자가 겹치므로) */
  state.batch.placed = { mt1: { s: D(WED, 14), e: D(WED, 15) } };
  state.meetings.mt2 = { ...state.meetings.mt1, title: "겹치는 미팅", ts: 2 };
  assert.equal(app.pzCanPlace("mt2", D(WED, 14), D(WED, 15), ign), false);
  assert.ok(app.pzCanPlace("mt2", D(WED, 15), D(WED, 16), ign));
});

test("블록은 겹치는 것끼리 묶어 rowspan 한 칸으로 이어 그린다 (20분 구분선 없음)", () => {
  reset();
  state.settings.slotMinutes = 20;
  app.openBatch();
  state.batch.week = app.mondayOf(WED);
  state.batch.placed = { mt1: { s: D(WED, 14), e: D(WED, 15) } };   // 60분 = 20분 칸 3개
  const html = app.viewPuzzleGrid();
  assert.match(html, /rowspan="3"/, "60분 블록은 세 칸을 하나로");
  assert.match(html, /14:00~15:00/, "블록 안에 시작~끝을 적는다");
  assert.equal([...html.matchAll(/class="mtg-cell blk/g)].length, 1, "조각나지 않는다");
});

test("보드와 원래 상태의 차이를 새로 확정·시간 변경·확정 취소로 센다", () => {
  reset();
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  state.meetings.mt2 = { ...state.meetings.mt1, title: "논문 리딩", status: "planning",
    recurrence: null, participants: { m2: true }, ts: 2 };
  app.openBatch();
  assert.deepEqual(app.batchDiff(), { add: [], move: [], drop: [] }, "연 직후엔 바뀐 것이 없다");

  state.batch.placed.mt2 = { s: D(WED, 10), e: D(WED, 11) };        // 새로 놓음
  assert.deepEqual(app.batchDiff().add, ["mt2"]);

  state.batch.placed.mt1 = { s: D(MON, 16), e: D(MON, 17) };        // 확정분을 옮김
  assert.deepEqual(app.batchDiff().move, ["mt1"]);

  delete state.batch.placed.mt1;                                    // 확정분을 뺌
  assert.deepEqual(app.batchDiff().drop, ["mt1"]);
});

test("적용하면 새 블록은 확정되고, 뺀 블록은 회차가 지워져 조율 상태로 돌아간다", () => {
  reset();
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  const before = app.occurrencesOf("mt1").length;
  assert.ok(before > 1, "매주 반복이라 회차가 여럿");
  state.meetings.mt2 = { ...state.meetings.mt1, title: "논문 리딩", status: "planning",
    recurrence: null, participants: { m2: true }, ts: 2 };
  app.openBatch();
  state.batch.placed.mt2 = { s: D(WED, 10), e: D(WED, 11) };
  delete state.batch.placed.mt1;
  app.applyBatch();
  assert.equal(state.meetings.mt1.status, "planning", "뺀 미팅은 조율 상태로");
  assert.equal(app.occurrencesOf("mt1").length, 0, "회차도 지워진다");
  assert.equal(state.meetings.mt2.status, "confirmed");
  assert.equal(Number(state.meetings.mt2.confirmedStart), D(WED, 10));
  assert.equal(state.batch, null, "적용하면 보드를 닫는다");
});

test("남은 블록 자동 배치는 사람이 겹치지 않게 채운다", () => {
  reset();
  /* 같은 사람이 들어간 미팅 4개 — 서로 겹치면 안 된다 */
  for (let k = 2; k <= 5; k++)
    state.meetings["mt" + k] = { ...state.meetings.mt1, title: "미팅" + k, ts: k };
  app.openBatch();
  app.autoPlace();
  const placed = Object.entries(state.batch.placed);
  assert.equal(placed.length, 5, "전부 놓인다");
  assert.equal(state.batch.autoFail, null);
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) {
      const [, a] = placed[i], [, b] = placed[j];
      assert.ok(!(a.s < b.e && b.s < a.e), "같은 참여자 일정이 겹쳤다");
    }
  /* 학기 시작 전 구간이 아닌 이상 월~금 안에 놓인다 */
  placed.forEach(([, p]) => {
    const wd = new Date(p.s).getDay();
    assert.ok(wd >= 1 && wd <= 5, "주말에 놓였다");
  });
});

test("칸 단위를 바꾸면 저장된 반복 불가 시간을 새 격자로 옮긴다", () => {
  reset();
  const plan = app.remapAvailability(30, 20);
  assert.ok(plan.off, "30분 격자의 09:30은 20분 격자에 없다");
  plan.write();
  const day = state.availability.sem1.m1.d1;
  assert.deepEqual(Object.keys(day).sort(), ["09:00", "09:20", "09:40"],
    "09:00~10:00이 20분 칸 세 개로 (경계는 불가 쪽으로 넓어진다)");
  state.settings.slotMinutes = 20;
  assert.deepEqual(app.durChoices(60).slice(0, 3), [20, 40, 60], "길이 후보도 칸 단위의 배수");
});

/* ---------------- 렌더 스모크 ---------------- */
test("모든 탭과 보드/격자 상태가 예외 없이 렌더된다", () => {
  reset();
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  state.exceptions = { x1: { mid: "m1", title: "ICCV", type: "conference", allDay: true,
    startDate: WED, endDate: A(WED, 2), ts: 1 } };
  for (const tab of ["calendar", "meetings", "members", "availability", "projects"]) {
    state.tab = tab;
    assert.doesNotThrow(() => app.doRender(), `${tab} 탭 렌더 실패`);
  }
  state.tab = "meetings";
  app.openBatch();
  assert.doesNotThrow(() => app.doRender(), "퍼즐 보드 렌더 실패");
  state.batch.pick = "mt1";
  assert.doesNotThrow(() => app.doRender(), "블록 고른 상태 렌더 실패");
  state.batch.placed = {};
  assert.doesNotThrow(() => app.doRender(), "전부 내린 상태 렌더 실패");
  state.batch.autoFail = [{ mtid: "mt1", why: "자리가 없습니다" }];
  assert.doesNotThrow(() => app.doRender(), "자동 배치 실패 표시 렌더 실패");
  state.batch = null;
  app.openFind("mt1", { mode: "first", scope: "후보" });
  assert.doesNotThrow(() => app.doRender(), "가능 시간 격자 렌더 실패");
  state.mtFind = null; state.mtPick = null;
  state.calPick = app.occurrencesOf("mt1")[0];
  assert.doesNotThrow(() => app.doRender());
  state.mtDraft = { title: "새 미팅", type: "meeting", durationMin: 60, participants: { m1: true },
    rangeStart: TODAY, rangeEnd: A(TODAY, 6), projectId: "", location: "", description: "",
    recur: "w1", recurUntil: SEM_END };
  assert.doesNotThrow(() => app.doRender());
  state.tab = "calendar"; state.calMode = "month";
  assert.doesNotThrow(() => app.doRender());
});

test("길이 선택지는 저장된 값을 그대로 보여준다 — 칸 단위의 배수가 아니어도", () => {
  reset({ recur: null });
  assert.ok(app.durChoices(40).includes(40));          // 30분 격자에서도 40분이 남는다
  assert.deepEqual(app.durChoices(40).slice(0, 3), [30, 40, 60]);
  state.settings.slotMinutes = 20;
  assert.deepEqual(app.durChoices(40).slice(0, 3), [20, 40, 60]);
});

test("회차 시간 변경 격자의 길이도 그 회차의 실제 길이를 보여주고, 바꾸면 그대로 적용된다", () => {
  reset({ recur: null });
  state.meetings.mt1.durationMin = 40;                 // 30분 배수가 아닌 길이
  app.confirmMeeting("mt1", D(WED, 14), D(WED, 14, 40));
  const evid = app.occurrencesOf("mt1")[0];
  assert.equal(state.events[evid].end - state.events[evid].start, 40 * 60000);

  /* 열었을 때 40분이 선택돼 있어야 한다 (선택지에 없으면 30분으로 보이고 조용히 바뀐다) */
  app.openFind("mt1", { mode: "move", evid, from: WS, to: WE, dur: 40, maxDays: 7,
    allDays: true, inCal: "cal", scope: "주", cur: { s: D(WED, 14), e: D(WED, 14, 40) } });
  assert.equal(state.mtFind.dur, 40);
  let html = app.viewCalWeek(new Date()).html;
  assert.match(html, /<option value="40" selected>40분<\/option>/);
  assert.match(html, /현재 14:00~14:40/);

  /* 길이를 60분으로 바꾸면 후보가 다시 잡히고, 옮기면 60분으로 저장된다 */
  app.openFind("mt1", { ...state.mtFind, dur: 60 });
  assert.equal(state.mtFind.dur, 60);
  assert.match(app.viewCalWeek(new Date()).html, /<option value="60" selected>60분<\/option>/);
  const start = state.mtFind.days.find((d) => d.ds === WED).ok[16 * 60];
  assert.ok(start, "16:00 시작이 후보여야 한다");
  app.moveOccurrence(evid, start, start + 60 * 60000);
  assert.equal(state.events[evid].end - state.events[evid].start, 60 * 60000);
  assert.equal(new Date(state.events[evid].start).getHours(), 16);
});

/* ---------------- 퍼즐 보드: 미팅별 색 + 선택 패널 ---------------- */
test("미팅마다 다른 색이 배정되고 등록 순서에 따라 안정적이다", () => {
  reset({ recur: null });
  state.meetings.mt2 = { ...state.meetings.mt1, title: "B", ts: 2 };
  state.meetings.mt3 = { ...state.meetings.mt1, title: "C", ts: 3 };
  const hues = ["mt1", "mt2", "mt3"].map((id) => app.meetingHue(id));
  assert.equal(new Set(hues).size, 3);                          // 서로 다르다
  assert.equal(hues[0], 215);                                    // 첫 미팅은 기존 파랑
  const min = Math.min(...[[0,1],[0,2],[1,2]].map(([a,b]) => {
    const d = Math.abs(hues[a] - hues[b]); return Math.min(d, 360 - d); }));
  assert.ok(min >= 60, `색상 간격이 좁다: ${hues} (최소 ${min}°)`);
  assert.equal(app.meetingHue("mt2"), hues[1]);                  // 다시 계산해도 같다
});

test("트레이·보드 블록·선택 패널이 미팅 색을 쓰고, 패널에 참석 인원이 나온다", () => {
  reset({ recur: null });
  state.meetings.mt2 = { ...state.meetings.mt1, title: "논문 리딩",
    participants: { m2: true }, ts: 2 };
  app.confirmMeeting("mt1", D(WED, 14), D(WED, 15));
  app.openBatch();
  state.batch.pick = "mt1";
  const html = app.viewBatchCard();
  const c1 = app.meetingColor("mt1"), c2 = app.meetingColor("mt2");
  assert.ok(html.includes(`--pc:${c1}`));                        // mt1 색 (트레이/보드/패널)
  assert.ok(html.includes(`--pc:${c2}`));                        // mt2 색
  assert.notEqual(c1, c2);
  /* 파스텔 바탕은 밝고(80%대), 글자 톤은 어둡다(30%대) — 대비가 유지된다 */
  assert.ok(html.includes(`--pcb:${app.meetingColorPastel("mt1")}`));
  assert.match(app.meetingColorPastel("mt1"), /,82%\)$/);
  assert.match(c1, /,37%\)$/);
  /* 선택 패널: 무엇을 들고 있고 누가 오는지 */
  assert.match(html, /pz-cur/);
  assert.match(html, /참석 2명 — 오경준, 박경문/);
  assert.match(html, /에 놓음/);                                  // 이미 보드에 있는 위치
  state.batch.pick = "mt2";
  assert.match(app.viewBatchCard(), /참석 1명 — 이태영/);
  assert.match(app.viewBatchCard(), /아직 안 놓음/);
  state.batch = null;
});

test("회차 목록은 접힌 채로 시작하고, 눌러야 펼쳐진다", () => {
  reset();
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  let html = app.viewOccurrences("mt1");
  assert.match(html, /occ-wrap collapsed/);
  assert.match(html, /data-act="occtoggle"/);
  assert.match(html, /회차 <b>4<\/b>개/);                     // 접혀도 요약은 보인다
  assert.doesNotMatch(html, /occ-row/);                       // 행은 없다
  state.occOpen.mt1 = true;
  html = app.viewOccurrences("mt1");
  assert.doesNotMatch(html, /collapsed/);
  assert.equal((html.match(/occ-row/g) || []).length, 4);
  assert.match(html, /data-act="occtoggle"/);                 // 다시 접을 수 있다
});

test("시간표 블록에 참석자 이름이 들어간다 (한 칸짜리 블록은 제외)", () => {
  reset({ recur: null });
  state.meetings.mt2 = { ...state.meetings.mt1, title: "짧은 미팅", durationMin: 30,
    participants: { m2: true }, ts: 2 };
  app.confirmMeeting("mt1", D(WED, 14), D(WED, 15));          // 60분 = 두 칸
  app.confirmMeeting("mt2", D(WED, 16), D(WED, 16, 30));      // 30분 = 한 칸
  app.openBatch();
  const html = app.viewPuzzleGrid();
  assert.match(html, /pz-fp">오경준, 박경문</);                 // 두 칸 블록엔 이름
  assert.doesNotMatch(html, /pz-fp">이태영</);                  // 한 칸 블록엔 공간이 없다
  assert.match(html, /짧은 미팅/);                              // 제목은 그대로
  state.batch = null;
});

test("주간 뷰 보기 모드는 퍼즐 보드처럼 블록으로 그린다 — 미팅색·rowspan·참석자", () => {
  reset({ recur: null });
  state.tab = "calendar";
  app.confirmMeeting("mt1", D(WED, 14), D(WED, 15));           // 60분 = 두 칸 블록
  state.events.solo = { title: "외부 세미나", type: "seminar", start: D(WED, 10), end: D(WED, 11),
    participants: { m2: true }, ts: 2 };
  const { html } = app.viewCalWeek(new Date());
  assert.match(html, /table class="wk blocky"/);
  assert.match(html, /rowspan="2"/);                            // 60분 = 30분 두 칸
  assert.ok(html.includes(`--pc:${app.meetingColor("mt1")}`));  // 미팅은 미팅색
  assert.ok(html.includes(`--pc:${"hsl(260,48%,42%)"}`));       // 미팅 아닌 일정은 타입색(세미나 260°)
  assert.match(html, /bp">오경준, 박경문</);                     // 두 칸 블록엔 참석자 이름
  assert.match(html, /data-act="calevpick"/);
  assert.match(html, /data-act="calslot"/);                     // 빈 칸은 여전히 일정 추가
  /* 시간 변경을 열면 칸 단위 격자로 돌아간다 (후보를 칸으로 골라야 하므로) */
  const evid = app.occurrencesOf("mt1")[0];
  app.openFind("mt1", { mode: "move", evid, from: WS, to: WE, dur: 60, maxDays: 7,
    allDays: true, inCal: "cal", scope: "주", cur: { s: D(WED, 14), e: D(WED, 15) } });
  const edit = app.viewCalWeek(new Date()).html;
  assert.match(edit, /table class="wk"/);
  assert.doesNotMatch(edit, /blocky/);
  assert.match(edit, /현재 14:00~15:00/);
  state.mtFind = null;
});

test("주간↔월간 전환은 보고 있던 날짜를 물려준다", () => {
  reset();
  state.tab = "calendar";
  /* 다음 달 주간을 보다가 월간으로 → 그 달이 떠야 한다 (오늘의 달이 아니라) */
  const far = A(TODAY, 40);
  state.calMode = "week"; state.calWeek = app.weekOf(far)[0];
  app.calSwitchMode("month");
  assert.equal(state.calMonth, A(state.calWeek, 3).slice(0, 7));
  assert.notEqual(state.calMonth === TODAY.slice(0, 7), far.slice(0, 7) !== TODAY.slice(0, 7));
  /* 그 달 월간에서 주간으로 → 그 달 1일이 낀 주 */
  app.calSwitchMode("week");
  assert.equal(state.calWeek, app.weekOf(state.calMonth + "-01")[0]);
  /* 이번 달이면 오늘이 낀 주로 */
  state.calMode = "month"; state.calMonth = TODAY.slice(0, 7);
  app.calSwitchMode("week");
  assert.equal(state.calWeek, app.weekOf(TODAY)[0]);
});
