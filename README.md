# VGI Lab Scheduler

연구실 전체 일정·미팅 조율 시스템. Talmood BandScheduler의 실시간 스케줄링 엔진을 기반으로 리팩터링했습니다.

- 데이터: Firebase Realtime Database (`vgi/` 네임스페이스)
- 단일 `index.html` vanilla JS 앱 · 실시간 동기화

## 핵심 흐름

1. **학기 시작 (관리자)** — Members 탭에서 멤버 등록, 학기 생성·활성화
2. **반복 일정 입력 (각자 1회)** — Availability 탭에서 학기 동안 매주 반복되는 안 되는 시간을 한 번만 입력
3. **평소** — 출장·휴가·학회는 예외 일정으로 그때그때 추가
4. **미팅 잡기** — Meetings 탭에서 참여자·길이·후보 기간 선택 → 가능 시간 자동 계산 (반복 일정 + 예외 + 확정 일정 + 장소 충돌 반영) → 클릭으로 확정 → Lab Calendar에 등록

## Firebase 스키마

```
vgi/
  settings/        { activeSemester, slotMinutes, dayStart, dayEnd }
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

- [ ] 반복 미팅 (매주 고정) — `events`에 rrule성 필드 추가 후 클라이언트에서 전개
- [ ] 모바일 실기기 점검
- [ ] (선택) 관리자 권한 분리 — 현재는 "링크 아는 사람 전부 편집" 모델
