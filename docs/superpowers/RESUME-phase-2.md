# Phase 2 — 작업 재개 노트 (Resume)

**마지막 업데이트:** 2026-05-27 · Abigail Kang

이 파일은 자리를 비운 뒤 Phase 2(Python Workflows Panel) 작업을 **바로 이어가기 위한** 인계 노트입니다.

---

## 지금 어디까지 됐나

| 단계 | 상태 |
|---|---|
| 설계 스펙 작성 | ✅ `docs/superpowers/specs/2026-05-27-phase-2-python-workflows-design.md` (커밋 `324a34c`, 푸시됨) |
| 구현 플랜 작성 | ✅ `docs/superpowers/plans/2026-05-27-phase-2-python-workflows.md` (이번 커밋, 푸시됨) |
| 사전 준비 (gh CLI) | ✅ `gh 2.92.0` 설치 + 인증 완료 (`workflow` 스코프 포함) |
| **구현** | ⬜ **아직 시작 안 함** — 코드 변경 0건 |

브랜치: `main` · 워킹트리 깨끗 · origin과 동기화됨.

---

## 재개하려면 (복붙용)

새 세션을 gas-commander 디렉터리에서 열고 아래처럼 말하면 됩니다:

> `docs/superpowers/plans/2026-05-27-phase-2-python-workflows.md` 플랜을 subagent-driven-development 방식으로 Task 0부터 실행해줘.

또는 직접:

```
Use superpowers:subagent-driven-development to execute
docs/superpowers/plans/2026-05-27-phase-2-python-workflows.md starting at Task 0.
```

**실행 방식은 이미 정함: 1번 = Subagent-Driven** (태스크마다 새 서브에이전트 + 태스크 사이 리뷰).

---

## 시작 전 꼭 알아둘 것 (결정 사항)

1. **Task 0은 다른 repo를 건드림.** `~/Desktop/jira-notion-sync`(repo: `esl-jira-notion-sync`)에서 `daily_compare.yml`을 삭제·푸시함. 이러면 daily 스케줄 자동실행이 멈춤 — **의도된 것** (사용자가 "daily compare 필요 없다"고 확정). git 히스토리로 복구 가능.
2. **카드 `▶ Run now`는 발견된 모든 워크플로우를 실행** = Task 0 이후엔 `sync.yml` 하나뿐이라 결국 sync만 돌아감. 파일명 하드코딩 없음(일반화 유지).
3. **gh는 `bash -lc`로 호출** — GUI로 띄운 Electron이 macOS에서 PATH(`/opt/homebrew/bin`)를 못 물려받는 문제 회피용. `workflows.js`에 이유 주석 있음.
4. **테스트 프레임워크 없음** — TDD 대신 Node 스모크체크 + `npm start` 수동검증으로 진행. Task 12가 최종 검증 매트릭스.
5. **스펙 대비 의도된 deviation 3가지** (플랜 self-review 섹션에 명시): `checkGh` 함수 추가 / main.js에 `stack`·`path` 필드 추가 / 렌더러는 `health.js`의 `ago()` 못 쓰니 `formatAgo` 사용.

## 미해결 / 실행 중 판단할 것

- **Deploy 섹션 처리:** 스펙은 Python일 때 Deploy 섹션을 Workflows로 "교체(replace)"한다고 했지만, 플랜은 둘 다 보이게 둠(Deploy는 Python에서 무해). 엄격히 교체를 원하면 `selectProject`에 한 줄 추가 — 플랜 self-review에 코드 적어둠. **실행 시 사용자 취향 확인 권장.**

---

## 관련 파일 빠른 참조

- 스펙: `docs/superpowers/specs/2026-05-27-phase-2-python-workflows-design.md`
- 플랜(태스크 0–12): `docs/superpowers/plans/2026-05-27-phase-2-python-workflows.md`
- 건드릴 코드: `workflows.js`(신규), `main.js`, `preload.js`, `renderer/{index.html,styles.css,app.js}`
- Python 프로젝트 실제 경로: `/Users/ab/Desktop/jira-notion-sync` (레지스트리 id `esl-jira-notion-sync`, 표시명 "ESL Sync")
