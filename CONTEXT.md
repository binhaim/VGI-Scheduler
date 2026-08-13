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
                       confirmedEventId?, confirmedStart?, confirmedEnd?, ts }
events/{evid}        { title, type, start(ms), end(ms), participants:{mid:true},
                       projectId, location, meetingId?, ts }
```

**설계 결정과 이유**
- 사람은 항상 **memberId**로 참조 (이름 문자열 비교 금지 — 동명이인·개명 안전). 밴드 앱의 최대 문제를 고친 부분.
- availability는 프로젝트가 아닌 **member × semester** 전역 데이터.
- meeting(조율 단위)과 event(확정된 캘린더 항목)를 분리. 확정 시 event가 생성되고 meeting이 참조.
- project는 스케줄링 단위가 아니라 **선택적 분류 메타데이터**.
- 반복 미팅은 미구현 — v2에서 events에 rrule성 필드({freq:'weekly', until})를 추가하고 클라이언트에서 전개하는 방향으로 확장.

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
