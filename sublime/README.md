# Sublime Text 플러그인 (MVP)

## 설치
1. `Sublime Text` → `Preferences` → `Browse Packages...`
2. 새 폴더 `AiAgent` 생성
3. 아래 파일을 복사
   - `sublime_ai_agent.py`
   - `Default (OSX).sublime-keymap`
   - `ai_agent.sublime-commands`

## 사용
- `Cmd+Shift+A`: 대화 요청
- `Cmd+Shift+E`: 선택 영역 개선
- `Cmd+Shift+R`: 전체 파일 리뷰
- `Cmd+Shift+H`: 최근 세션 대화 기록 보기
- `Cmd+Shift+L`: 전체 대화 목록 텍스트 출력
- `Cmd+Shift+C`: 전체 대화 목록 색상 팝업

## 주의
- 로컬 서버가 `localhost:3000`에서 실행 중이어야 합니다.
- 스트리밍 결과는 Output Panel에 표시됩니다.
- 대화 요청 시 Output Panel에 요청/응답 영역이 순서대로 표시됩니다.
- 편집 결과가 `edit`로 오면 인라인 diff 팝업에서 수락/거부할 수 있습니다.
- 대화 기록은 현재 뷰에 연결된 마지막 세션을 기준으로 표시됩니다.
- 모든 세션 대화 목록은 서버에 저장된 세션 전체를 출력합니다.
- 전체 목록 색상 팝업에서는 사용자(라이트 그레이)와 Maclaw(라이트 블루) 배경색으로 구분됩니다.
- 에이전트 대화 팝업과 전체 목록 팝업은 X 버튼으로 닫습니다.
