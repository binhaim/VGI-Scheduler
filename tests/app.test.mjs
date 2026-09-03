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
    mtDraft: null, batch: null, me: "", calWeekend: false, mtListOpen: false, weekCancel: null,
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

/* ---------------- 회차 자리 바꾸기 ---------------- */
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
  assert.match(html, /data-act="caledit"[^>]*data-mode="move"/);
  assert.match(html, /data-act="caledit"[^>]*data-mode="extra"/);
  assert.match(html, /data-act="occcancel"/);
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
  assert.match(html, /미팅 배치 보드/);
  assert.match(html, /data-pz="mt1"/);
  assert.match(html, /data-pz="mt2"/);
  assert.match(html, /아직 안 놓은 블록 1/);
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
  assert.ok(state.batch && state.batch.placed.mt2, "적용하면 보드가 새 상태로 다시 열린다");
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

/* ---------------- 시간표에서 회차 고치기 — 보드 엔진 한 벌 ---------------- */
test("시간 변경은 시간표 위 보드로 열리고, 자기 회차는 후보에서 비켜준다", () => {
  reset({ recur: null });
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  const evid = app.occurrencesOf("mt1")[0];
  app.openCalEdit(evid, "move");
  assert.equal(state.tab, "calendar");
  assert.equal(state.batch.single.evid, evid);
  assert.equal(state.batch.week, app.mondayOf(MON));
  const ign = app.pzIgnoreSet();
  assert.ok(ign.has(evid), "옮기는 회차 자신은 무시");
  assert.ok(app.pzCanPlace("mt1", D(MON, 14), D(MON, 15), ign), "제자리도 후보");
  assert.equal(app.pzCanPlace("mt1", D(MON, 9), D(MON, 10), ign), false, "m1 월 오전 불가");
  const { html } = app.viewCalWeek(new Date());
  assert.match(html, /id="pzgrid"/);
  assert.match(html, /data-act="pzdrop"/);
  assert.doesNotMatch(html, /이번 주부터 매주/, "반복 없는 미팅엔 범위 선택이 없다");
});

test("이 주만 옮기면 그 회차만, 이번 주부터 매주면 남은 회차가 전부 옮겨진다", () => {
  reset();
  state.meetings.mt1.recurrence.until = A(MON, 27);
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  const [o1, o2, o3] = app.occurrencesOf("mt1");
  app.openCalEdit(o2, "move");
  assert.match(app.viewCalWeek(new Date()).html, /이번 주부터 매주/);
  app.applySingle(D(A(MON, 9), 10), D(A(MON, 9), 11));       // 둘째 주 수요일 10시
  assert.equal(state.batch, null, "놓는 순간 편집이 끝난다");
  assert.equal(state.events[o2].moved, true);
  assert.equal(state.events[o1].start, D(MON, 14), "첫 회차는 그대로");
  assert.equal(state.events[o3].start, D(A(MON, 14), 14), "셋째 회차도 그대로");

  app.openCalEdit(o3, "move");
  state.batch.single.scope = "series";
  app.applySingle(D(A(MON, 16), 16), D(A(MON, 16), 17));    // 셋째 주 수요일 16시부터 매주
  const occ = app.occurrencesOf("mt1");
  assert.equal(occ.length, 4);
  assert.equal(state.events[o1].start, D(MON, 14), "지난 회차는 그대로");
  const later = occ.filter((id) => state.events[id].start >= D(A(MON, 14), 0));
  assert.deepEqual(later.map((id) => new Date(state.events[id].start).getDay()), [3, 3]);
  assert.ok(later.every((id) => new Date(state.events[id].start).getHours() === 16));
  assert.equal(state.meetings.mt1.confirmedStart, D(A(MON, 16), 16));
});

test("이 주 추가는 초록 칸에 놓으면 extra 회차가 생기고, 기존 회차와는 겹치지 않는다", () => {
  reset();
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  const evid = app.occurrencesOf("mt1")[0];
  app.openCalEdit(evid, "extra");
  assert.equal(app.pzIgnoreSet().size, 0, "추가 모드에선 기존 회차도 남의 일정처럼 막는다");
  assert.equal(app.pzCanPlace("mt1", D(MON, 14), D(MON, 15)), false);
  app.applySingle(D(WED, 16), D(WED, 17));
  const occ = app.occurrencesOf("mt1");
  assert.equal(occ.length, 5);
  assert.ok(occ.some((id) => state.events[id].extra && state.events[id].start === D(WED, 16)));
});

test("옮기는 중 다른 미팅 블록에 놓으면 두 회차의 시간이 맞바뀐다", () => {
  reset({ recur: null });
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  const a = app.occurrencesOf("mt1")[0];
  state.meetings.mt2 = { ...state.meetings.mt1, title: "논문 리딩", participants: { m2: true }, status: "planning", ts: 2 };
  app.confirmMeeting("mt2", D(WED, 10), D(WED, 11));
  const b = app.occurrencesOf("mt2")[0];
  app.openCalEdit(a, "move");
  const r = app.viewCalWeek(new Date());
  assert.match(r.html, new RegExp(`data-act="pzswap"[^>]*data-swap="${b}"`), "다른 미팅 블록이 자리 바꾸기 대상");
  app.pzSwap(b);
  assert.equal(state.events[a].start, D(WED, 10));
  assert.equal(state.events[b].start, D(MON, 14));
  assert.equal(state.batch, null);
});

test("회차를 옮길 땐 미팅 기본 길이가 아니라 그 회차의 길이를 쓰고, 편집 줄에서 바꿀 수 있다", () => {
  reset({ recur: null });
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 14, 40));     // 40분 회차 (미팅 기본은 60분)
  const evid = app.occurrencesOf("mt1")[0];
  app.openCalEdit(evid, "move");
  assert.equal(app.pzDurOf("mt1"), 40);
  assert.match(app.viewCalWeek(new Date()).html, /<option value="40" selected>40분/);
  state.batch.single.dur = 60;
  app.applySingle(D(WED, 13), D(WED, 14));
  assert.equal(state.events[evid].end - state.events[evid].start, 60 * 60000);
});

test("주간 뷰는 월~금이 기본이고 주말은 토글로 보인다", () => {
  reset({ recur: null });
  state.tab = "calendar";
  let { html } = app.viewCalWeek(new Date());
  assert.equal((html.match(/<th class="[^"]*">\d+\/\d+<em>/g) || []).length, 5);
  assert.doesNotMatch(html, /<em>토<\/em>/);
  state.calWeekend = true;
  ({ html } = app.viewCalWeek(new Date()));
  assert.match(html, /<em>토<\/em>/);
  assert.match(html, /<em>일<\/em>/);
});

/* ---------------- 되돌리기·이 주 회차 정리·'나' ---------------- */
test("회차 취소는 바로 화면에 반영되고 되돌릴 수 있다", () => {
  reset();
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  const id = app.occurrencesOf("mt1")[0];
  app.setOccCancel(id, true, true);
  assert.equal(state.events[id].status, "cancelled", "낙관적으로 로컬에도 표시");
  app.setOccCancel(id, false, true);
  assert.equal(state.events[id].status, undefined);
});

test("이 주 회차 정리: 빠지는 사람이 있는 회차만 취소 후보로 두고, 체크 안 한 것만 취소한다", () => {
  reset();
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  state.meetings.mt2 = { ...state.meetings.mt1, title: "논문 리딩", participants: { m2: true }, status: "planning", ts: 2 };
  app.confirmMeeting("mt2", D(WED, 10), D(WED, 11));
  state.exceptions = { x1: { mid: "m1", title: "ECCV", type: "conference", allDay: true, startDate: MON, endDate: MON, ts: 1 } };
  app.openWeekCancel(WS);
  const wc = state.weekCancel;
  const a = app.occurrencesOf("mt1")[0], b = app.occurrencesOf("mt2")[0];
  assert.equal(app.weekOccurrences(WS).length, 2);
  assert.equal(wc.keep[a], undefined, "m1이 학회라 mt1 회차는 취소 후보");
  assert.equal(wc.keep[b], true, "빠지는 사람 없는 mt2는 진행");
  assert.match(app.viewWeekCancelModal(), /1개 취소하기/);
  app.applyWeekCancel();
  assert.equal(state.weekCancel, null);
  assert.equal(app.isLive(state.events[a]), false);
  assert.equal(app.isLive(state.events[b]), true);
  assert.equal(app.occurrencesOf("mt1").length, 4, "취소는 삭제가 아니다");
});

test("'나'를 고르면 시간표 필터·내 시간·새 미팅 참여자가 나를 따른다", () => {
  reset();
  state.me = "m2"; state.members.m3.always = true;
  state.tab = "calendar"; state.calMember = state.me;
  const html = app.viewCalendar();
  assert.match(html, /data-act="calmine" data-v="me"/);
  assert.match(html, /data-act="calsub" data-mid="m2"/, "개인 구독은 나로 바로 켜진다");
  state.tab = "availability"; state.avMember = "";
  app.viewAvailability();
  assert.equal(state.avMember, "m2");
  assert.match(app.viewAvailability(), /입력 현황|입력/, "입력 현황 줄");
});

test("월간 뷰의 미팅 회차는 미팅색을 쓰고 주말 열은 좁다", () => {
  reset({ recur: null });
  state.tab = "calendar"; state.calMode = "month"; state.calMonth = MON.slice(0, 7);
  app.confirmMeeting("mt1", D(MON, 14), D(MON, 15));
  const { html } = app.viewCalMonth(new Date());
  assert.match(html, /agg-event mt/);
  assert.ok(html.includes(`--pc:${app.meetingColor("mt1")}`));
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
  app.openCalEdit(app.occurrencesOf("mt1")[0], "move");
  assert.doesNotThrow(() => app.doRender(), "시간표 회차 편집 렌더 실패");
  state.batch.single.mode = "extra";
  assert.doesNotThrow(() => app.doRender(), "회차 추가 렌더 실패");
  state.batch = null; state.tab = "meetings";
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
  /* 시간 변경을 열면 같은 자리에서 보드 렌더러로 바뀐다 — 블록을 끌어서 놓는다 */
  const evid = app.occurrencesOf("mt1")[0];
  app.openCalEdit(evid, "move");
  const edit = app.viewCalWeek(new Date()).html;
  assert.match(edit, /id="pzgrid"/);
  assert.doesNotMatch(edit, /blocky/);
  assert.match(edit, /14:00~15:00/);                            // 편집 줄에 지금 시간
  state.batch = null;
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

/* ---------------- 휴가·부재는 배정을 막지 않는다 ---------------- */
function vacationReset() {
  reset({ recur: null });
  /* m1이 WED 하루 종일 휴가 */
  state.exceptions = { x1: { mid: "m1", title: "휴가", type: "vacation", allDay: true,
    startDate: WED, endDate: WED, ts: 1 } };
}
test("휴가 기간에도 미팅을 넣을 수 있고, 빠지는 사람만 표시된다", () => {
  vacationReset();
  const s = D(WED, 14), e = D(WED, 15);
  assert.equal(app.memberBusy("m1", s, e), false);              // 더는 막지 않는다
  assert.equal(app.memberAway("m1", s, e), "휴가");              // 대신 부재로 잡힌다
  assert.deepEqual(app.awayOf(["m1", "m3"], s, e), ["m1"]);
  state.batch = app.initBatch(app.mondayOf(WED));
  state.batch.pick = "mt1";
  assert.ok(app.pzCanPlace("mt1", s, e), "휴가 중이어도 놓을 수 있어야 한다");
  const html = app.viewPuzzleGrid();
  assert.match(html, new RegExp(`data-cs="${s}"><button[^>]*data-act="pzdrop"[^>]*>✈`), "후보 칸에 ✈ 부재 표시");
  state.batch = null;
});

test("퍼즐 보드: 휴가 시간에 놓을 수 있고, 후보 칸과 놓인 블록에 ✈ 표시", () => {
  vacationReset();
  app.openBatch();
  state.batch.week = app.mondayOf(WED);        // 휴가가 있는 주를 보드에 띄운다
  state.batch.pick = "mt1";
  let grid = app.viewPuzzleGrid();
  assert.match(grid, /cand aw[^>]*data-cs/);                    // 휴가 칸도 초록 (✈ 포함)
  assert.match(grid, /휴가·부재 \(놓을 수는 있음\)/);
  state.batch.placed.mt1 = { s: D(WED, 14), e: D(WED, 15) };    // 휴가 시간에 배치
  grid = app.viewPuzzleGrid();
  assert.match(grid, /pz-aw">✈1</);                             // 블록에 부재자 배지
  assert.match(grid, /✈ 오경준 휴가·부재/);
  state.batch = null;
});

test("회차 목록·주간 블록에도 휴가 부재가 표시된다", () => {
  vacationReset();
  app.confirmMeeting("mt1", D(WED, 14), D(WED, 15));
  state.occOpen.mt1 = true;
  const occ = app.viewOccurrences("mt1");
  assert.match(occ, /occ-tag away[^>]*>✈ 오경준/);
  assert.doesNotMatch(occ, /⚠ 오경준 불가/);                     // 하드 충돌로는 안 잡는다
  state.tab = "calendar"; state.calWeek = WS;
  assert.match(app.viewCalWeek(new Date()).html, /✈ 오경준 휴가·부재/);
});

test("자동 배치는 휴가가 없는 자리를 먼저 고른다", () => {
  vacationReset();
  const mids = ["m1", "m3"];
  const item = { mtid: "mt1", dur: 60, mids, set: new Set(mids), loc: "",
    cands: [D(WED, 14), D(A(WED, 1), 14)] };                    // 휴가 자리와 정상 자리
  const { chosen, failed } = app.solveBatch([item], "compact", []);
  assert.equal(failed.length, 0);
  assert.equal(chosen[0].s, D(A(WED, 1), 14));                  // 휴가 아닌 목요일을 택한다
});

/* ---------------- 조정자 (수정 권한) ---------------- */
test("조정자를 지정하면 그 사람만 고칠 수 있다", () => {
  reset();
  state.settings.managers = {};
  assert.equal(app.isManager(), true);                 // 미지정이면 전원
  state.settings.managers = { m3: true, m2: true };    // 교수님(박경문)·이태영
  state.me = "";
  assert.equal(app.isManager(), false);
  state.me = "m1";
  assert.equal(app.isManager(), false);
  state.me = "m2";
  assert.equal(app.isManager(), true);
  /* 내 시간은 본인 것만 */
  state.me = "m1";
  assert.equal(app.canEditAv("m1"), true);
  assert.equal(app.canEditAv("m3"), false);
  state.me = "m2";
  assert.equal(app.canEditAv("m1"), true);             // 조정자는 남의 것도
  /* 멤버에서 지워진 id만 남으면 전원으로 복귀 (잠금 사고 방지) */
  state.settings.managers = { m_ghost: true };
  state.me = "m1";
  assert.equal(app.isManager(), true);
});

test("조정자가 아니면 미팅·설정 탭이 숨고, 직접 들어와도 가림막이 뜬다", () => {
  reset();
  state.settings.managers = { m3: true, m2: true };
  state.me = "m1"; state.tab = "meetings";
  app.doRender();
  const hbar = globalThis.document.getElementById("hbar").innerHTML;
  assert.doesNotMatch(hbar, /data-tab="meetings"/);
  assert.doesNotMatch(hbar, /data-tab="members"/);
  let body = globalThis.document.getElementById("app").innerHTML;
  assert.match(body, /조정자 전용/);
  assert.match(body, /본인을 선택/);
  assert.doesNotMatch(body, /박경문|이태영/);          // 누가 조정자인지는 밝히지 않는다
  state.tab = "members"; app.doRender();
  assert.match(globalThis.document.getElementById("app").innerHTML, /조정자 전용/);
  state.me = "m2"; app.doRender();
  assert.match(globalThis.document.getElementById("hbar").innerHTML, /data-tab="meetings"/);
});

test("조정자가 아니면 시간표는 보기 전용이다", () => {
  reset({ recur: null });
  app.confirmMeeting("mt1", D(WED, 14), D(WED, 15));
  state.settings.managers = { m3: true };
  state.me = "m1"; state.tab = "calendar"; state.calWeek = WS;
  let { html } = app.viewCalWeek(new Date());
  assert.doesNotMatch(html, /data-act="calslot"/);      // 빈 칸 추가 없음
  assert.match(html, /data-act="calevpick"/);           // 블록 정보 보기는 가능
  state.calPick = app.occurrencesOf("mt1")[0];
  html = app.viewCalWeek(new Date()).html;
  assert.doesNotMatch(html, /data-act="caledit"/);      // 시간 변경 없음
  assert.doesNotMatch(html, /data-act="evdelete"/);
  assert.match(html, /data-act="calpickclear"/);        // 닫기는 가능
  state.calMode = "month"; state.calMonth = WED.slice(0, 7);
  const month = app.viewCalendar();
  assert.doesNotMatch(month, /data-act="evedit"/);      // 월간 블록도 클릭 수정 없음
  assert.doesNotMatch(month, /data-act="caladd"/);
  /* 조정자에게는 전부 살아 있다 */
  state.me = "m3"; state.calMode = "week";
  html = app.viewCalWeek(new Date()).html;
  assert.match(html, /data-act="caledit"/);
  assert.match(html, /data-act="calslot"/);
});

test("조정자가 아니면 내 시간은 본인 것만 입력한다", () => {
  reset();
  state.settings.managers = { m3: true };
  state.me = "m1"; state.avMember = "m3"; state.tab = "availability";
  const html = app.viewMembers && app.doRender();       // 렌더 경유
  const body = globalThis.document.getElementById("app").innerHTML;
  assert.doesNotMatch(body, /data-act="avmember"/);     // 멤버 셀렉트 없음
  assert.match(body, /본인 것만 입력할 수 있어요/);
  assert.equal(state.avMember, "m1");                   // 나로 고정
  assert.doesNotMatch(body, /data-act="avpick"/);       // 미입력자 이름도 클릭 불가
  /* '나'를 안 고르면 보기 전용 안내 */
  state.me = ""; app.doRender();
  assert.match(globalThis.document.getElementById("app").innerHTML, /보기 전용입니다/);
});

test("설정에 조정자 토글이 있다", () => {
  reset();
  state.tab = "members";
  state.settings.managers = { m3: true };
  const html = app.viewMembers();
  assert.match(html, /조정자/);
  assert.match(html, /data-act="mtmanager" data-mid="m2"/);
  assert.match(html, /grp-tog on" data-act="mtmanager" data-mid="m3"/);
});
