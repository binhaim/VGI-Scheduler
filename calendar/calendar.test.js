import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ICAL from "ical.js";
import {
  buildMemberCalendar,
  buildMemberItems,
  feedKeyOf,
  listFeedMembers,
} from "./calendar.js";
import { generateCalendarFeeds } from "./generate.js";

/* 실제 앱이 쓰는 모양 그대로: 시각은 절대 epoch ms, 종일은 "YYYY-MM-DD" 문자열 */
const HOUR_MS = 60 * 60 * 1000;
const LAB_MEETING_START = Date.UTC(2026, 8, 10, 5, 0); // 2026-09-10 14:00 KST
const SEMINAR_START = Date.UTC(2026, 8, 14, 2, 0); // 2026-09-14 11:00 KST
const CHECKUP_START = Date.UTC(2026, 8, 11, 1, 0); // 2026-09-11 10:00 KST

const members = {
  m_habin: { name: "임하빈", active: true, ts: 1 },
  m_jaeho: { name: "이재호", active: true, ts: 2 },
  m_alum: { name: "졸업생", active: false, ts: 3 },
};

const projects = { p_percep: { name: "Perception" } };

const events = {
  ev_lab: {
    title: "랩 미팅",
    type: "meeting",
    start: LAB_MEETING_START,
    end: LAB_MEETING_START + HOUR_MS,
    participants: { m_habin: true, m_jaeho: true },
    projectId: "p_percep",
    location: "세미나실",
    ts: 10,
  },
  ev_seminar: {
    title: "논문 세미나",
    type: "seminar",
    start: SEMINAR_START,
    end: SEMINAR_START + 2 * HOUR_MS,
    participants: { m_jaeho: true },
    projectId: "",
    location: "",
    ts: 11,
  },
  ev_broken: {
    title: "시간이 뒤집힌 일정",
    type: "other",
    start: LAB_MEETING_START,
    end: LAB_MEETING_START,
    participants: { m_habin: true },
    ts: 12,
  },
};

const exceptions = {
  x_eccv: {
    mid: "m_habin",
    title: "ECCV",
    type: "travel",
    allDay: true,
    startDate: "2026-09-07",
    endDate: "2026-09-09",
    ts: 20,
  },
  x_checkup: {
    mid: "m_habin",
    title: "건강검진",
    type: "personal",
    allDay: false,
    start: CHECKUP_START,
    end: CHECKUP_START + 3 * HOUR_MS,
    ts: 21,
  },
  x_jaeho: {
    mid: "m_jaeho",
    title: "휴가",
    type: "vacation",
    allDay: true,
    startDate: "2026-09-21",
    endDate: "2026-09-25",
    ts: 22,
  },
};

const data = { members, events, exceptions, projects };

test("피드 키는 memberId 그대로이고, 비활성 멤버도 목록에 남는다", () => {
  assert.equal(feedKeyOf("m_habin"), "m_habin");
  assert.equal(feedKeyOf("a/b"), "");
  assert.equal(feedKeyOf(""), "");
  assert.deepEqual(
    listFeedMembers(members).map((member) => [member.mid, member.displayName]),
    [["m_jaeho", "이재호"], ["m_habin", "임하빈"], ["m_alum", "졸업생"]],
  );
});

test("본인이 참여자인 확정 일정과 본인 예외만 모은다", () => {
  const result = buildMemberItems({ ...data, mid: "m_habin" });
  assert.equal(result.memberFound, true);
  assert.equal(result.displayName, "임하빈");
  assert.deepEqual(
    result.items.map((item) => [item.id, item.allDay, item.summary]),
    [
      ["x_eccv", true, "[출장] ECCV"],
      ["ev_lab", false, "랩 미팅 · Perception"],
      ["x_checkup", false, "[개인] 건강검진"],
    ],
  );
  assert.equal(result.items.some((item) => item.id === "ev_seminar"), false);
  assert.equal(result.items.some((item) => item.id === "ev_broken"), false);
  assert.equal(result.items.some((item) => item.id === "x_jaeho"), false);
});

test("구독 가능한 .ics를 만들고 종일/시각 일정을 정확히 표현한다", () => {
  const result = buildMemberCalendar({
    ...data,
    mid: "m_habin",
    feedUrl: "https://binhaim.github.io/VGI-Scheduler/calendars/m_habin.ics",
    generatedAt: Date.UTC(2026, 8, 1, 0, 0),
  });
  assert.ok(result);
  assert.equal(result.eventCount, 3);
  assert.doesNotMatch(result.body, /논문 세미나|이재호 휴가|시간이 뒤집힌/);

  /* 종일 예외: 9/7~9/9 → DTEND는 배타적이므로 9/10 */
  assert.match(result.body, /DTSTART;VALUE=DATE:20260907/);
  assert.match(result.body, /DTEND;VALUE=DATE:20260910/);

  const calendar = new ICAL.Component(ICAL.parse(result.body));
  assert.equal(calendar.getFirstPropertyValue("x-wr-calname"), "임하빈 · VGI Lab 일정");
  const parsed = calendar.getAllSubcomponents("vevent").map((component) => new ICAL.Event(component));
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].summary, "[출장] ECCV");
  assert.equal(parsed[1].summary, "랩 미팅 · Perception");
  assert.equal(parsed[1].location, "세미나실");
  assert.equal(parsed[1].startDate.toJSDate().toISOString(), "2026-09-10T05:00:00.000Z");
  assert.equal(parsed[1].endDate.toJSDate().toISOString(), "2026-09-10T06:00:00.000Z");
  assert.match(parsed[1].description, /참여: 이재호, 임하빈/);
  assert.equal(parsed[2].startDate.toJSDate().toISOString(), "2026-09-11T01:00:00.000Z");

  /* 같은 일정은 재생성해도 같은 UID여야 캘린더 앱이 중복 등록하지 않는다 */
  assert.match(result.body, /UID:ev-ev_lab@vgi-scheduler/);
});

test("취소된 회차는 STATUS:CANCELLED로 나가고 지문도 달라진다", () => {
  const cancelled = {
    ...events,
    ev_lab: { ...events.ev_lab, seriesId: "mt_lab", status: "cancelled" },
  };
  const result = buildMemberCalendar({
    ...data,
    events: cancelled,
    mid: "m_habin",
    feedUrl: "https://example.com/calendars/m_habin.ics",
    generatedAt: Date.UTC(2026, 8, 1, 0, 0),
  });
  assert.ok(result);
  /* 지우지 않고 취소 상태로 내보내야 구독자 캘린더에서도 사라진다 */
  assert.equal(result.eventCount, 3);
  assert.match(result.body, /STATUS:CANCELLED/);
  assert.match(result.body, /X-MICROSOFT-CDO-BUSYSTATUS:FREE/);

  const items = buildMemberItems({ ...data, events: cancelled, mid: "m_habin" }).items;
  const lab = items.find((item) => item.id === "ev_lab");
  assert.equal(lab.cancelled, true);
  const before = buildMemberItems({ ...data, mid: "m_habin" }).items.find((item) => item.id === "ev_lab");
  assert.equal(before.cancelled, false);
});

test("일정이 없는 멤버도 빈 피드를 받는다", () => {
  const result = buildMemberCalendar({
    ...data,
    mid: "m_alum",
    feedUrl: "https://example.com/calendars/m_alum.ics",
    generatedAt: 0,
  });
  assert.ok(result);
  assert.equal(result.eventCount, 0);
  assert.equal(result.displayName, "졸업생");
});

test("모르는 멤버는 피드를 만들지 않는다", () => {
  assert.equal(
    buildMemberCalendar({ ...data, mid: "m_nobody", feedUrl: "https://example.com/feed.ics" }),
    null,
  );
});

test("내용이 그대로면 파일도 그대로, 바뀌면 갱신 시각이 올라간다", async () => {
  const firstDir = await mkdtemp(join(tmpdir(), "vgi-feeds-first-"));
  const secondDir = await mkdtemp(join(tmpdir(), "vgi-feeds-second-"));
  const changedDir = await mkdtemp(join(tmpdir(), "vgi-feeds-changed-"));
  const removedDir = await mkdtemp(join(tmpdir(), "vgi-feeds-removed-"));
  const firstNow = Date.UTC(2026, 8, 1, 1, 2, 45);
  const secondNow = Date.UTC(2026, 8, 1, 2, 3, 10);

  const first = await generateCalendarFeeds({ ...data, outputDir: firstDir, now: firstNow });
  const firstBody = await readFile(join(firstDir, "m_habin.ics"), "utf8");
  assert.deepEqual(Object.keys(first.feeds).sort(), ["m_alum", "m_habin", "m_jaeho"]);
  assert.equal(first.feeds.m_habin.eventCount, 3);
  assert.equal(first.feeds.m_alum.eventCount, 0);

  const second = await generateCalendarFeeds({
    ...data,
    outputDir: secondDir,
    previousManifest: first,
    now: secondNow,
  });
  const secondBody = await readFile(join(secondDir, "m_habin.ics"), "utf8");
  assert.equal(second.feeds.m_habin.updatedAt, first.feeds.m_habin.updatedAt);
  assert.equal(secondBody, firstBody);

  const changedEvents = structuredClone(events);
  changedEvents.ev_lab.location = "세미나실 B";
  const changed = await generateCalendarFeeds({
    ...data,
    events: changedEvents,
    outputDir: changedDir,
    previousManifest: second,
    now: secondNow,
  });
  const changedBody = await readFile(join(changedDir, "m_habin.ics"), "utf8");
  assert.equal(changed.feeds.m_habin.updatedAt, Math.floor(secondNow / 60000) * 60000);
  assert.match(changedBody, /세미나실 B/);
  /* 같은 일정에 참여한 이재호 피드도 함께 갱신되고, 무관한 졸업생 피드는 그대로 */
  assert.equal(changed.feeds.m_jaeho.updatedAt, Math.floor(secondNow / 60000) * 60000);
  assert.equal(changed.feeds.m_alum.updatedAt, first.feeds.m_alum.updatedAt);

  /* 멤버가 DB에서 지워져도 이미 구독 중인 링크는 빈 피드로 살아 있어야 한다 */
  const removed = await generateCalendarFeeds({
    members: {},
    events: {},
    exceptions: {},
    projects: {},
    outputDir: removedDir,
    previousManifest: changed,
    now: secondNow + 60000,
  });
  const removedBody = await readFile(join(removedDir, "m_habin.ics"), "utf8");
  const removedCalendar = new ICAL.Component(ICAL.parse(removedBody));
  assert.equal(removed.feeds.m_habin.displayName, "임하빈");
  assert.equal(removed.feeds.m_habin.eventCount, 0);
  assert.equal(removedCalendar.getAllSubcomponents("vevent").length, 0);
});
