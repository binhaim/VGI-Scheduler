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
    mtDraft: null, mtFind: null, mtPick: null, mtSel: null, mtBoardWeek: WS,
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
  assert.match(app.viewCalWeek(new Date()).html, /wk-chip off/);
});

test("주간 뷰에서 일정을 고르면 그 회차를 바로 고칠 수 있다", () => {
  reset({ recur: null });
  state.tab = "calendar";
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  state.calPick = app.occurrencesOf("mt1")[0];
  const { html } = app.viewCalWeek(new Date());
  assert.match(html, /data-act="occmove"[^>]*data-cal="cal"/);
  assert.match(html, /data-act="occadd"[^>]*data-cal="cal"/);
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

/* ---------------- 배정 보드 (Meetings) ---------------- */
test("보드는 미팅 목록과 그 주 배치를 한 화면에 보여준다", () => {
  reset();
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  const html = app.viewMeetingBoard();
  assert.match(html, /미팅 배정 보드/);
  assert.match(html, /data-act="mtselect"[^>]*data-mtid="mt1"/);
  assert.match(html, /배정됨 <b>1<\/b>/);
  assert.match(html, /CE 위클리/);
  assert.match(html, /data-act="mtboardgo"/);
});

test("미팅을 고르면 그 주 가능 시간이 초록 칸으로 뜨고, 고른 칸에 배정된다", () => {
  reset();
  app.openBoardFind("mt1");
  assert.equal(state.mtFind.mode, "assign");
  assert.equal(state.mtFind.inCal, "board");
  state.mtSel = "mt1";
  let html = app.viewMeetingBoard();
  assert.match(html, /배정할 시간 고르기/);
  assert.match(html, /wk-cell[^"]*cand[^"]*"[^>]*data-act="mtpick"[^>]*data-mtid="mt1"/);
  /* 월요일 오전은 오경준 불가라 후보가 아니다 */
  const mon = state.mtFind.days.find((d) => d.ds === MON);
  assert.equal(mon.ok[9 * 60], undefined);
  assert.ok(mon.ok[14 * 60]);

  state.mtPick = { mtid: "mt1", s: D(MON, 14), e: D(MON, 15) };
  html = app.viewMeetingBoard();
  assert.match(html, /이 시간에 배정/);
  assert.match(html, /매주 회차 4개 생성/);

  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  html = app.viewMeetingBoard();
  assert.match(html, /<span class="wk-t">14:00<\/span> <span class="wk-n">CE 위클리<\/span>/);  // 이름 + 시간
  assert.equal(state.mtFind, null);
});

test("이미 배정된 미팅을 고르면 그 주 회차 추가가 된다", () => {
  reset();
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  state.mtSel = "mt1";
  app.openBoardFind("mt1");
  assert.equal(state.mtFind.mode, "extra");
  const html = app.viewMeetingBoard();
  assert.match(html, /이 주에 회차 추가/);
  assert.match(html, /회차가 추가됩니다/);
});

test("보드에서 배정된 일정을 누르면 그 회차 조작 줄이 보드 기준으로 나온다", () => {
  reset({ recur: null });
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  state.calPick = app.occurrencesOf("mt1")[0];
  const html = app.viewMeetingBoard();
  assert.match(html, /data-act="occmove"[^>]*data-cal="board"/);
  assert.match(html, /data-act="occadd"[^>]*data-cal="board"/);
});

test("Meetings 탭은 보드 + 선택한 미팅 상세로 구성된다", () => {
  reset();
  let html = app.viewMeetings();
  assert.match(html, /미팅 배정 보드/);
  assert.match(html, /위에서 미팅을 고르면/);          // 아직 고른 미팅이 없다
  state.mtSel = "mt1";
  html = app.viewMeetings();
  assert.match(html, /선택한 미팅/);
  assert.match(html, /data-act="mtedit"/);
  assert.doesNotMatch(html, /mtg-wrap/);              // 카드 안에 격자를 또 그리지 않는다
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
  state.mtSel = "mt1"; app.openBoardFind("mt1");
  assert.doesNotThrow(() => app.doRender());
  state.mtPick = { mtid: "mt1", s: D(WED, 11), e: D(WED, 12) };
  assert.doesNotThrow(() => app.doRender());
  state.mtPick = null; state.mtFind = null;
  state.calPick = app.occurrencesOf("mt1")[0];
  assert.doesNotThrow(() => app.doRender());
  state.mtDraft = { title: "새 미팅", type: "meeting", durationMin: 60, participants: { m1: true },
    rangeStart: TODAY, rangeEnd: A(TODAY, 6), projectId: "", location: "", description: "",
    recur: "w1", recurUntil: SEM_END };
  assert.doesNotThrow(() => app.doRender());
  state.tab = "calendar"; state.calMode = "month";
  assert.doesNotThrow(() => app.doRender());
});
