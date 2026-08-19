# CONTEXT.md — 개발 인수인계 문서

> 이 문서는 2026-08-13까지의 개발 세션(임하빈 + Claude) 내용을 다음 작업자가 이어받을 수 있게 정리한 것이다.
> 새 작업을 시작하기 전에 이 문서와 README.md를 먼저 읽을 것.

## 1. 이 프로젝트는 무엇인가

**VGI Lab Scheduler** — 연구실 전체 일정·미팅 조율 시스템.

원본은 밴드 동아리용 합주 일정 조율 앱 **Talmood BandScheduler**(https://github.com/binhaim/Talmood-BandScheduler)이며,
그 엔진(실시간 동기화, 캘린더 렌더러, 드래그 페인팅, 충돌 판정, 모달/디자인 시스템)을 재사용해
"프로젝트별 합주 일정" 모델을 "랩 멤버 + 학기 반복 일정 + 예외 + 미팅 조율" 모델로 리팩터링했다.
4,286줄 → 2,278줄. 이 저장소의 git 히스토리에 밴드 앱 히스토리가 그대로 남아 있다 (참고용).

**핵심 UX 원칙** (원 요구사항에서 가장 중요):
- When2Meet처럼 매주 availability를 다시 받지 않는다.
- 학기 시작에 주간 반복 "안 되는 시간"을 **한 번만** 입력 → 이후엔 출장/휴가/학회 같은 **예외만** 추가.
- 미팅 계산은 항상 저장된 정보(반복+예외+확정 일정)에서 자동으로.

## 2. 인프라 현황 (전부 세팅 완료)

| 항목 | 값 |
|---|---|
| GitHub | https://github.com/binhaim/VGI-Scheduler (public) |
| 배포 | GitHub Pages, https://binhaim.github.io/VGI-Scheduler/ — push 시 `.github/workflows/deploy-pages.yml`이 index.html만 배포 |
| Firebase 프로젝트 | `vgi-scheduler` (밴드의 talmood-timetable과 **완전 분리**, 소유 계정 habinbin1211@gmail.com) |
| RTDB | https://vgi-scheduler-default-rtdb.firebaseio.com (us-central1) |
| 보안 규칙 | `{"rules":{"vgi":{".read":true,".write":true}}}` — vgi 외 경로는 전부 거부 |
| 규칙 수정 방법 | Firebase 콘솔 → Realtime Database → 규칙, 또는 firebase CLI 인증 토큰으로 `/.settings/rules.json` REST PUT |

밴드 앱 DB에 임시로 쓰던 `vgi` 경로·규칙은 **제거 완료** (밴드 DB는 원상태).

## 3. 데이터 모델 (RTDB, 전부 `vgi/` 아래)

```
settings/            { activeSemester, slotMinutes(30), dayStart(9), dayEnd(21) }
members/{mid}        { name, email, role, active, ts }
semesters/{sid}      { name, startDate:"YYYY-MM-DD", endDate, ts }
availability/{sid}/{mid}/d{0..6}/{HH:MM} = true     ← 주간 반복 "불가" 슬롯 (d+요일번호, 일=0)
exceptions/{xid}     { mid, title, type(conference|travel|vacation|personal|other),
                       allDay, startDate/endDate(종일) 또는 start/end(ms, 시간지정), ts }
projects/{pid}       { name, members:{mid:true}, ts }
meetings/{mtid}      { title, type, participants:{mid:true}, durationMin, rangeStart, rangeEnd,
                       projectId, location, description, status:'planning'|'confirmed',
                       recurrence:{freq:'weekly', interval:1|2, until:"YYYY-MM-DD"}|null,
                       confirmedEventId?, confirmedStart?, confirmedEnd?, ts }
events/{evid}        { title, type, start(ms), end(ms), participants:{mid:true},
                       projectId, location, meetingId?, ts,
                       seriesId?,          ← 이 회차가 속한 미팅 id (= mtid)
                       seriesDate?,        ← 원래 회차 날짜 "YYYY-MM-DD"
                       status?,            ← 'cancelled' (삭제 대신 취소 표시)
                       moved?, extra? }    ← 그 주만 시간 조정됨 / 그 주에 추가된 회차
```

**설계 결정과 이유**
- 사람은 항상 **memberId**로 참조 (이름 문자열 비교 금지 — 동명이인·개명 안전). 밴드 앱의 최대 문제를 고친 부분.
- availability는 프로젝트가 아닌 **member × semester** 전역 데이터.
- meeting(조율 단위)과 event(확정된 캘린더 항목)를 분리. 확정 시 event가 생성되고 meeting이 참조.
- project는 스케줄링 단위가 아니라 **선택적 분류 메타데이터**.
- **반복 미팅은 "회차 실체화" 방식** (2026-08-19 구현). rrule을 화면에서 가상 전개하지 않고, 확정 시 반복 종료일까지 회차를
  실제 event로 만들어 `seriesId`로 묶는다. 이유: 가용성 엔진·캘린더·PNG/ICS·구독 피드(Node)가 전부 event 단위라
  가상 전개를 택하면 같은 전개 로직을 브라우저와 `calendar/generate.js` 양쪽에 이중으로 유지해야 한다.
  회차 수는 학기당 미팅 하나에 15~20개 수준이라 데이터량은 문제되지 않는다.
  - 그 주만 시간 변경 = 그 event 하나 수정(`moved:true`), 그 주에 회차 추가 = event 추가(`extra:true`),
    학회 등으로 쉬는 주 = `status:'cancelled'` (캘린더에 회색 취소선으로 남고 되돌릴 수 있음).
  - **취소된 회차는 일정으로 치지 않는다** — `isLive(ev)` 헬퍼로 `memberBusy`/`locationBusy`에서 제외.
    구독 피드는 지우지 않고 `STATUS:CANCELLED`로 내보내야 구독자 캘린더에서도 사라진다
    (`calendar/generate.js`의 지문에도 `cancelled`가 들어가야 피드가 갱신됨).
  - 미팅 정보를 고치면 `syncSeries()`가 **아직 오지 않은 회차**에만 제목·참여자·장소를 반영하고,
    반복 종료일을 늘렸으면 마지막 회차 뒤로 이어서 만든다. 시간은 회차별 관리라 건드리지 않는다.
  - **후보 격자(`findMeetingSlots` → `viewMeetingFind`)는 "빈 칸 목록"이 아니라 배치표**다. 칸마다
    `{kind:'free'|'ev'|'na'|'past'}`를 담아 기존 일정(제목·타입색)·참여자 불가 이유·지난 시간을 그대로 그린다.
    `ok[분]`은 **길이가 통째로 들어가는 시작 칸**만 담으므로 90분 미팅은 30분 칸 3개가 연속으로 비어야 후보가 된다.
    선택하면 길이만큼 칸이 함께 칠해진다.
  - 회차 시간 변경은 그 주(일~토)로 좁힌 격자에서 하고, 원래 시간대는 `find.cur`로 주황색 표시된다.
    격자 위 `길이` 선택으로 그 회차만 길이를 조정할 수 있다(`openFind`가 같은 조건으로 재계산).
  - **미팅 순서 바꾸기**: 시간 변경 격자에서 다른 미팅 칸을 누르면 `swapOccurrence(a,b)`로 두 일정의
    시작 시각을 맞바꾼다(각자 길이는 유지). 길이가 달라 서로 겹치게 되면 거부한다.
  - **Calendar 탭 기본은 주간 뷰**(`state.calMode`, localStorage `vgi.calMode`에 저장. 월간은 `viewCalMonth`로 유지).
    `viewCalWeek`이 요일(열) x 슬롯(행) 표를 그리고 종일 예외는 맨 윗줄에 둔다. 일정을 누르면 `state.calPick`이 잡히고
    아래 줄에서 그 회차를 바로 고친다(시간 변경/이 주 취소/+이 주 추가/상세 수정). 시간 변경을 누르면
    `openFind(..., {inCal:true})`로 **같은 주간 표 위에** 후보 칸(초록)·현재 시간(주황)·자리 바꾸기 대상이 겹쳐 그려진다
    (이때 미팅 카드 쪽은 격자를 중복해 그리지 않는다).
    새 미팅 기본값은 `매주 반복` + 후보 범위 1주 — "한 주를 정하면 매주 반복되고, 예외만 그 주에 넣는다"는 원칙 그대로.
  - **"전원 가능"이 수상하게 많으면 대개 계산이 아니라 범위 문제다.** `weeklyBusy`는 활성 학기 안에서만
    적용되므로 학기 밖 날짜는 제약이 없어 전부 가능으로 나온다(2026-08 실데이터에서 실제로 이렇게 보였다:
    학기 9/1~12/18인데 미팅 후보 범위가 8/14부터). 그래서 `findMeetingSlots`는
    기본적으로 검색 시작을 **학기 시작일로 당기고**(`clamped`), 사유와 `[전체 보기]`를 배너로 알린다.
    `noClamp:true`로 전체를 보면 학기 밖 날짜는 헤더 `학기밖` + 빗금으로 구분하고 `outTotal`로 따로 센다.
    반복 불가 시간을 입력하지 않은 참여자(`noAvail`)도 이름으로 경고한다 — 그 사람은 늘 가능으로 계산되기 때문.
    주간 뷰도 보고 있는 주가 학기 밖이면 같은 배너를 띄운다.
  - 미구현(다음 단계): 학회 기간 일괄 취소(유지할 미팅만 체크).

## 4. 코드 구조 (단일 index.html, vanilla JS)

- CSS ~960줄 (밴드 앱 디자인 시스템 유지 + `.av-*`(주간 그리드), `.mt-*`(미팅 카드), `.x-*`(예외) 추가)
- JS `<script type="module">` 안에 전부. 섹션 순서:
  1. `firebaseConfig` / `DB_ROOT='vgi'` / `SITE_BASE`
  2. `state` — 탭·필터·드래프트·모달 상태 + 실시간 데이터 8종
  3. 유틸 (`$`, `esc`, `fmtDate`, `timeList`, `hm`, `overlap`, `sortedIds` …)
  4. 도메인 상수 (`EVENT_TYPES`, `EXC_TYPES`, 타입별 hue)
  5. Firebase (`initFirebase`, `R()`, `wErr`, `watchConnection`(오프라인 배너), `subscribeAll`)
  6. **가용성 엔진**: `excRange`, `weeklyBusy`, `memberBusy`, `locationBusy`, `findMeetingSlots`
  7. 쓰기 동작 (member/semester/project/meeting/event/exception CRUD, `confirmMeeting`/`unconfirmMeeting`)
  8. 렌더 (`render`/`doRender` — 포커스·스크롤 보존, `syncScrollLock`)
  9. 뷰: `viewCalendar`(월간, `.agg-*` 재사용) / `viewMeetings` / `viewMembers`(+학기+설정) / `viewAvailability`(주간 그리드+예외) / `viewProjects` / 모달 3종 / `viewHelp`
  10. PNG(`exportCalPNG`) / ICS(`exportCalICS`)
  11. `bindEvents` — 위임 클릭/체인지 핸들러, draft sync, Escape, **주간 그리드 페인팅 엔진**(박스 드래그, PC 즉시·모바일 long-press 320ms, pointercancel 복구)
  12. `start()` — 해시 라우팅(#calendar 등) + 구독 시작

**아키텍처 불변식 (건드릴 때 주의)**
- 모든 UI는 문자열 템플릿 → `#app.innerHTML` 전체 교체. 이벤트는 `#app`/`#hbar` 위임 리스너로만 (재렌더에도 살아남음).
- `render()`는 텍스트 입력 포커스 중·페인팅 중이면 defer (`deferRender`) → blur/commit 시 반영. 입력값은 change 이벤트 또는 저장 직전 `sync*Draft()`로 상태에 동기화.
- 쓰기는 **낙관적**: 로컬 state 먼저 변경 → doRender → FB 쓰기 `.catch(wErr)`. 서버 에코가 최종 상태.
- `R()`는 `vgi/` 프리픽스를 붙이되 `.info/*`(연결 감지)는 예외.
- 모달 열림 동안 `body.no-scroll`(position:fixed, 위치 기억·복원)로 배경 스크롤 잠금.

## 5. 검증된 것 (E2E, Playwright + Chrome)

멤버 3명·학기(2026 Fall) 생성 → 하빈 월 10:00~12:00 반복 불가 드래그 입력 → ECCV 출장(9/7~9/9) 예외 →
미팅(교수님+하빈, 60분, 9/7~9/11) 가능 시간 찾기 → **출장 3일 정확히 제외**(9/10·9/11만 제시) →
확정 → Lab Calendar 표시 → 두 번째 미팅 검색에서 **확정 일정과 겹치는 슬롯 자동 제외** 확인.
장소 충돌(`locationBusy`)도 엔진에 포함(같은 location 문자열의 확정 event와 겹치면 차단).

## 6. 남은 작업 (우선순위 순)

1. **개인 구독 .ics 피드 포팅** — `calendar/` 디렉토리(calendar.js, generate.js, 테스트)는 아직 밴드 스키마(이름 기반, projects/avail) 그대로다.
   - 할 일: `vgi/events`+`vgi/exceptions`를 읽어 **memberId별** .ics 생성 (`calendars/{mid}.ics`), manifest로 변경 감지 유지, deploy-pages.yml의 TODO 자리에 생성 단계 복원 (cron 포함).
   - 앱 쪽은 준비됨: 구독 모달이 `SITE_BASE/calendars/{mid}.ics` URL을 안내 중 (배포 전 경고 문구 표시).
2. 반복 미팅 (매주 고정 미팅) — §3의 확장 방향 참고.
3. 사용 가이드 확장, 모바일 실기기 점검 (기본 대응은 되어 있음 — 터치 페인팅·풀블리드·스크롤 잠금 포팅됨).
4. (선택) 관리자 권한 분리 — 현재는 밴드 앱과 같은 "링크 아는 사람 전부 편집" 모델. 필요해지면 Firebase Auth + 규칙 강화.

## 7. 함정·주의사항

- **밴드 저장소와 히스토리 공유**: 이 repo는 Talmood-BandScheduler의 클론에서 출발. 리모트는 새 repo로 교체됨. 밴드 쪽에 push할 일 없음.
- `_site/`, `firebase-debug.log`는 밴드 시절 잔재 (gitignore 처리됨/무해).
- RTDB 규칙은 vgi 외 경로 전부 거부 — 새 최상위 경로를 추가하면 규칙도 함께 열어야 한다.
- 시간 저장은 모두 **로컬(KST) 기준 ms** 또는 "YYYY-MM-DD"/"HH:MM" 문자열. 타임존 로직 없음 (연구실 로컬 전제).
- `findMeetingSlots`는 오늘 이전 날짜를 자동 제외하고, 후보 80개에서 잘라 `truncated` 플래그를 세운다.
- 학기 밖 날짜엔 주간 반복이 적용되지 않음(`weeklyBusy`의 학기 범위 체크) — 의도된 동작.
- 테스트 시 실DB에 쓰게 되므로 테스트 후 `vgi/` 하위 경로 정리 습관 유지 (settings는 남길 것).

## 8. 밴드 앱 쪽 참고 (별개 프로젝트, 계속 운영 중)

Talmood-BandScheduler는 이 세션에서 함께 개선됨: UI/UX 개편(TALENDER 리브랜딩, 모바일 풀블리드, 접근성),
동방 사용표(개인 연습 시트, 한 칸 다중 이름 토글) 추가. 그쪽 DB(talmood-timetable)와 이 프로젝트는 이제 완전 무관하다.
