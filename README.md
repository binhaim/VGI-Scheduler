# VGI Lab Scheduler

연구실 전체 일정·미팅 조율 시스템. Talmood BandScheduler의 실시간 스케줄링 엔진을 기반으로 리팩터링했습니다.

- 데이터: Firebase Realtime Database (`vgi/` 네임스페이스)
- 단일 `index.html` vanilla JS 앱 · 실시간 동기화

## 핵심 흐름

1. **나 고르기** — 오른쪽 위 `나`에서 본인 선택(브라우저에 기억). 시간표는 내 주간, 내 시간은 내 격자, 새 미팅엔 내가 자동 포함, 개인 구독 버튼 즉시 활성.
2. **학기 시작 (설정 탭)** — 멤버 등록(교수님처럼 늘 들어가는 사람은 `항상 참여`), 학기 생성·활성화, 시간표 칸 단위(20/30/60분).
3. **내 시간 (각자 1회)** — 학기 동안 매주 반복되는 안 되는 시간을 한 번만 칠한다. 위쪽 `입력 현황`에 아직 안 낸 사람이 보인다(미입력자는 늘 가능으로 계산됨).
4. **출장·휴가·학회** — 같은 탭의 예외 일정. 배정을 막지 않고 ✈로 빠지는 사람만 표시.
5. **미팅 배치 보드** — `+ 새 미팅`은 이름·길이·참여자 3칸. 블록을 **끌어서** 월~금 보드에 놓으면 들어갈 수 있는 칸만 초록으로 켜지고 자석처럼 붙는다.
   확정된 미팅도 블록으로 올라와 있어 끌어서 옮기거나 빼놓을 수 있고, `새로 확정 / 시간 변경 / 확정 취소`를 세어 `변경 사항 적용` 한 번에 저장(학기 끝까지 매주 회차 생성). 남은 블록은 자동 배치.
6. **시간표** — 월~금 주간 기본(주말 보기 토글). 블록 클릭 → `시간 변경`(같은 자리에서 보드로 바뀜 · 이 주만 / 이번 주부터 매주 · 다른 블록에 놓으면 자리 바꾸기) / `+ 이 주 추가` / `이 주 취소`(되돌리기 토스트) / `상세 수정`.
   학회 주간은 `이 주 회차 정리`로 유지할 미팅만 체크. 월간 보기, PNG/.ics, 개인 구독.

## Firebase 스키마

```
vgi/
  settings/        { activeSemester, slotMinutes(20/30/60), dayStart, dayEnd }
  members/{mid}    { name, email, role, active, always?, ts }   # always = 새 미팅에 자동 참여
  members/{mid}    { name, email, role, active, ts }
  semesters/{sid}  { name, startDate, endDate, ts }
  availability/{sid}/{mid}/{d0..d6}/{HH:MM}: true   # 주간 반복 불가 슬롯
  exceptions/{xid} { mid, title, type, allDay, start|startDate, end|endDate, ts }
  projects/{pid}   { name, members:{mid:true}, ts }
  meetings/{mtid}  { title, type, participants, durationMin, rangeStart, rangeEnd,
                     projectId, location, description, status, confirmedEventId?, ... }
  events/{evid}    { title, type, start, end, participants, projectId, location, meetingId?, ts }
```

- availability는 프로젝트가 아니라 **member × semester** 전역 데이터
- 모든 참조는 이름 문자열이 아닌 **memberId** 기준
- 반복 미팅은 v2 — events에 rrule 필드를 추가하는 방식으로 확장 가능하게 설계

## 개인 구독 캘린더 (.ics)

멤버마다 `calendars/{memberId}.ics` 피드가 생성됩니다. 본인이 참여자로 포함된 **확정 일정**과 본인의 **예외 일정**이 담기며,
Calendar 탭에서 멤버를 고른 뒤 **🔗 개인 구독**을 누르면 URL을 복사할 수 있습니다.

- 생성기: [`calendar/`](calendar/) — Firebase REST로 `vgi/{members,events,exceptions,projects}`를 읽어 .ics와 `manifest.json`을 만듭니다
- 갱신: push 시 + 2시간마다 (`.github/workflows/deploy-pages.yml`의 cron)
- 내용이 그대로면 파일을 다시 쓰지 않아 구독자 쪽 갱신이 불필요하게 튀지 않습니다 (manifest의 fingerprint)

```bash
npm ci
npm test                                     # 피드 생성 로직 테스트
npm run generate:feeds -- --output ./_feeds   # 실제 DB로 직접 생성해보기
```

## 남은 작업

- [ ] (선택) 관리자 권한 분리 — Firebase Auth + 규칙. 현재는 "링크 아는 사람 전부 편집" 모델
- [x] 개인 구독 .ics 피드 · 반복 미팅 · 학회 주간 일괄 정리 · 퍼즐 배치 보드
