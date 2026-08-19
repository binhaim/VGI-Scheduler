import ical, {
  ICalCalendarMethod,
  ICalEventBusyStatus,
  ICalEventStatus,
} from "ical-generator";

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const SITE_URL = "https://binhaim.github.io/VGI-Scheduler/";

/* index.html의 EVENT_TYPES / EXC_LABEL과 같은 이름표 */
export const EVENT_TYPE_LABEL = {
  meeting: "미팅",
  seminar: "세미나",
  paper: "논문 리딩",
  conference: "학회",
  travel: "출장",
  vacation: "휴가",
  other: "기타",
};
export const EXCEPTION_TYPE_LABEL = {
  conference: "학회",
  travel: "출장",
  vacation: "휴가",
  personal: "개인",
  other: "기타",
};

/* 문자열 비교만으로 정렬 — 실행 환경의 로케일에 따라 순서가 흔들리지 않도록 */
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function trimmed(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function truthyKeys(map) {
  return Object.keys(map || {}).filter((key) => map[key]);
}

function finiteMs(value) {
  const ms = Number(value);
  return Number.isFinite(ms) ? ms : null;
}

/* "YYYY-MM-DD" → 그 날 자정의 UTC ms. 종일 일정은 시각이 없으므로 UTC로 다뤄야 CI 타임존에 영향받지 않는다. */
function dateStartUtc(value) {
  const match = DATE_RE.exec(trimmed(value));
  if (!match) return null;
  const [, year, month, day] = match;
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return Number.isFinite(ms) ? ms : null;
}

export function memberDisplayName(members, mid) {
  return trimmed(members?.[mid]?.name);
}

export function feedKeyOf(mid) {
  const key = trimmed(mid);
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : "";
}

/* 피드를 만들 멤버 목록 — 비활성 멤버도 포함한다(이미 구독 중인 링크가 죽으면 안 되므로) */
export function listFeedMembers(members) {
  return Object.keys(members || {})
    .map((mid) => ({ mid, displayName: memberDisplayName(members, mid) }))
    .filter((member) => feedKeyOf(member.mid) && member.displayName)
    .sort((a, b) => byText(a.displayName, b.displayName) || byText(a.mid, b.mid));
}

function projectLabel(projects, pid) {
  if (!pid) return "";
  return trimmed(projects?.[pid]?.name);
}

function participantNames(members, participants) {
  return truthyKeys(participants)
    .map((mid) => memberDisplayName(members, mid))
    .filter(Boolean)
    .sort(byText);
}

function eventItem({ evid, event, members, projects, mid }) {
  const start = finiteMs(event?.start);
  const end = finiteMs(event?.end);
  if (start === null || end === null || !(end > start)) return null;

  const title = trimmed(event.title) || "(제목 없음)";
  const typeLabel = EVENT_TYPE_LABEL[event.type] || EVENT_TYPE_LABEL.other;
  const project = projectLabel(projects, event.projectId);
  const location = trimmed(event.location);
  const people = participantNames(members, event.participants);

  const description = [
    `종류: ${typeLabel}`,
    project ? `프로젝트: ${project}` : "",
    location ? `장소: ${location}` : "",
    people.length ? `참여: ${people.join(", ")}` : "",
    `일정 페이지: ${SITE_URL}#calendar`,
  ].filter(Boolean).join("\n");

  return {
    kind: "ev",
    id: evid,
    uid: `ev-${evid}@vgi-scheduler`,
    allDay: false,
    cancelled: event.status === "cancelled",
    start,
    end,
    summary: project ? `${title} · ${project}` : title,
    description,
    location,
    memberId: mid,
  };
}

function exceptionItem({ xid, exception, mid }) {
  const title = trimmed(exception?.title) || "(제목 없음)";
  const typeLabel = EXCEPTION_TYPE_LABEL[exception?.type] || EXCEPTION_TYPE_LABEL.other;
  const summary = `[${typeLabel}] ${title}`;
  const description = [`구분: ${typeLabel}`, `일정 페이지: ${SITE_URL}#availability`].join("\n");
  const base = {
    kind: "x",
    id: xid,
    uid: `x-${xid}@vgi-scheduler`,
    cancelled: false,
    summary,
    description,
    location: "",
    memberId: mid,
  };

  if (exception?.allDay) {
    const start = dateStartUtc(exception.startDate);
    const endDate = dateStartUtc(exception.endDate ?? exception.startDate);
    if (start === null || endDate === null || endDate < start) return null;
    /* .ics의 종일 DTEND는 배타적 — 마지막 날 다음 날짜를 넣어야 그 날까지 표시된다 */
    return { ...base, allDay: true, start, end: endDate + DAY_MS };
  }

  const start = finiteMs(exception?.start);
  const end = finiteMs(exception?.end);
  if (start === null || end === null || !(end > start)) return null;
  return { ...base, allDay: false, start, end };
}

/**
 * 한 멤버의 캘린더에 들어갈 항목 — 본인이 참여자로 포함된 확정 일정 + 본인의 예외 일정.
 */
export function buildMemberItems({ members, events, exceptions, projects, mid }) {
  const feedKey = feedKeyOf(mid);
  if (!feedKey) return { displayName: "", items: [], memberFound: false };

  const displayName = memberDisplayName(members, feedKey);
  const items = [];

  for (const evid of Object.keys(events || {}).sort(byText)) {
    const event = events[evid];
    if (!event?.participants?.[feedKey]) continue;
    const item = eventItem({ evid, event, members, projects, mid: feedKey });
    if (item) items.push(item);
  }

  for (const xid of Object.keys(exceptions || {}).sort(byText)) {
    const exception = exceptions[xid];
    if (trimmed(exception?.mid) !== feedKey) continue;
    const item = exceptionItem({ xid, exception, mid: feedKey });
    if (item) items.push(item);
  }

  items.sort((a, b) => a.start - b.start || byText(a.kind, b.kind) || byText(a.id, b.id));
  return { displayName, items, memberFound: Boolean(displayName) };
}

export function buildMemberCalendar({
  members,
  events,
  exceptions,
  projects,
  mid,
  feedUrl,
  generatedAt = Date.now(),
  fallbackDisplayName = "",
}) {
  const selection = buildMemberItems({ members, events, exceptions, projects, mid });
  const displayName = selection.displayName || trimmed(fallbackDisplayName);
  if (!displayName) return null;

  const calendarName = `${displayName} · VGI Lab 일정`;
  const generatedDate = new Date(generatedAt);
  const calendar = ical({
    name: calendarName,
    description: `${displayName}의 VGI Lab 확정 일정과 예외 일정`,
    prodId: { company: "VGI Lab", product: "Scheduler", language: "KO" },
    method: ICalCalendarMethod.PUBLISH,
    scale: "GREGORIAN",
    ttl: 2 * 60 * 60,
    source: feedUrl,
    url: feedUrl,
  });

  for (const item of selection.items) {
    calendar.createEvent({
      id: item.uid,
      allDay: item.allDay,
      start: new Date(item.start),
      end: new Date(item.end),
      stamp: generatedDate,
      lastModified: generatedDate,
      summary: item.summary,
      description: item.description,
      location: item.location || null,
      url: SITE_URL,
      /* 취소된 회차도 내보낸다 — 구독자 캘린더에서 자동으로 지워지도록 */
      status: item.cancelled ? ICalEventStatus.CANCELLED : ICalEventStatus.CONFIRMED,
      busystatus: item.cancelled ? ICalEventBusyStatus.FREE : ICalEventBusyStatus.BUSY,
    });
  }

  return {
    body: calendar.toString(),
    calendarName,
    displayName,
    eventCount: selection.items.length,
  };
}
