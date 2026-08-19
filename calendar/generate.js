import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  SITE_URL,
  buildMemberCalendar,
  buildMemberItems,
  feedKeyOf,
  listFeedMembers,
} from "./calendar.js";

const DEFAULT_DATABASE_URL = "https://vgi-scheduler-default-rtdb.firebaseio.com";
const DB_ROOT = "vgi";

async function fetchJson(databaseUrl, path, fetchImpl) {
  const url = `${databaseUrl.replace(/\/$/, "")}/${path}.json`;
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Firebase read failed (${response.status}): ${path}`);
  return response.json();
}

export async function loadScheduleData({
  databaseUrl = DEFAULT_DATABASE_URL,
  fetchImpl = fetch,
} = {}) {
  const [members, events, exceptions, projects] = await Promise.all(
    ["members", "events", "exceptions", "projects"].map((path) =>
      fetchJson(databaseUrl, `${DB_ROOT}/${path}`, fetchImpl),
    ),
  );
  return {
    members: members || {},
    events: events || {},
    exceptions: exceptions || {},
    projects: projects || {},
  };
}

/* 내용이 그대로면 지문도 그대로 — 파일을 다시 쓰지 않아 구독자 쪽 갱신 알림이 튀지 않는다 */
function memberFingerprint({ members, events, exceptions, projects, mid, fallbackDisplayName = "" }) {
  const selection = buildMemberItems({ members, events, exceptions, projects, mid });
  const payload = {
    displayName: selection.displayName || fallbackDisplayName,
    items: selection.items.map(({ uid, allDay, cancelled, start, end, summary, description, location }) => ({
      uid,
      allDay,
      cancelled,
      start,
      end,
      summary,
      description,
      location,
    })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("base64url");
}

function retainedUpdatedAt(previousManifest, feedKey, fingerprint, now) {
  const previous = previousManifest?.feeds?.[feedKey];
  if (previous?.fingerprint === fingerprint && Number.isFinite(previous.updatedAt)) {
    return previous.updatedAt;
  }
  return Math.floor(now / 60000) * 60000;
}

/* 지금 DB에 있는 멤버 + 예전에 피드를 냈던 멤버(삭제됐어도 링크가 404가 되지 않도록 빈 피드 유지) */
function calendarMembers({ members, previousManifest }) {
  const feeds = new Map(listFeedMembers(members).map(({ mid, displayName }) => [mid, displayName]));
  for (const [feedKey, feed] of Object.entries(previousManifest?.feeds || {})) {
    const displayName = String(feed?.displayName || "").trim();
    if (feedKeyOf(feedKey) && displayName && !feeds.has(feedKey)) feeds.set(feedKey, displayName);
  }
  return [...feeds.entries()].sort(
    (a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
}

export async function generateCalendarFeeds({
  members,
  events,
  exceptions,
  projects,
  outputDir,
  previousManifest = {},
  now = Date.now(),
  siteUrl = SITE_URL,
}) {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const manifest = {
    version: 1,
    builtAt: new Date(now).toISOString(),
    feeds: {},
  };

  for (const [feedKey, displayName] of calendarMembers({ members, previousManifest })) {
    const fingerprint = memberFingerprint({
      members,
      events,
      exceptions,
      projects,
      mid: feedKey,
      fallbackDisplayName: displayName,
    });
    const updatedAt = retainedUpdatedAt(previousManifest, feedKey, fingerprint, now);
    const feedUrl = new URL(`calendars/${feedKey}.ics`, siteUrl).toString();
    const calendar = buildMemberCalendar({
      members,
      events,
      exceptions,
      projects,
      mid: feedKey,
      feedUrl,
      generatedAt: updatedAt,
      fallbackDisplayName: displayName,
    });
    if (!calendar) continue;

    await writeFile(resolve(outputDir, `${feedKey}.ics`), calendar.body, "utf8");
    manifest.feeds[feedKey] = {
      displayName,
      fingerprint,
      updatedAt,
      eventCount: calendar.eventCount,
    };
  }

  await writeFile(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readPreviousManifest(path) {
  if (!path) return {};
  try {
    return JSON.parse(await readFile(resolve(path), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function main() {
  const outputDir = resolve(optionValue("--output") || "_site/calendars");
  const previousManifest = await readPreviousManifest(optionValue("--previous"));
  const data = await loadScheduleData({ databaseUrl: process.env.FIREBASE_DATABASE_URL });
  const manifest = await generateCalendarFeeds({ ...data, outputDir, previousManifest });
  const total = Object.values(manifest.feeds).reduce((sum, feed) => sum + feed.eventCount, 0);
  console.log(`Generated ${Object.keys(manifest.feeds).length} member feeds (${total} events) → ${outputDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
