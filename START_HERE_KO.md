> New local execution results: [LOCAL_VERIFICATION_2026-10-02.md](docs/LOCAL_VERIFICATION_2026-10-02.md). Supplier results below are historical.

# 먼저 읽어 주세요

## ChatGPT dot에 넘길 때

`SignalBrief_Full_Source.zip`을 업로드하고, 함께 드린 `DOT_HANDOFF_KO.md`의 내용을 붙여넣으세요.
ZIP을 펼쳤다면 저장소 루트의 같은 이름 파일을 사용해도 됩니다.

dot의 작업은 앱 전체를 다시 설계하는 것이 아니라 **이미 작성된 코드의 의존성 설치,
전체 빌드/검증, 필요한 수정, 실제 외부 계정 연결, 승인된 환경 배포**입니다.
도구가 실제 파일 실행·수정·배포를 지원하지 않으면 그 사실을 보고하고,
실행 가능한 개발 환경에서 이어서 작업해야 합니다. 텍스트 업로드만으로 배포가 완료되는 것은 아닙니다.

## 내가 직접 할 일

먼저 키 없는 합성 데모를 확인할 수 있습니다. Python 3.12+와 Node 22 환경에서:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
cd apps/web
npm install
cd ../..
python scripts/dev.py
```

브라우저에서 `http://localhost:3000`을 열고 **데모로 시작하기**를 누릅니다.
처음 온보딩에서 합성 기업 3개를 선택하면 브리핑을 볼 수 있습니다.
가상 매출 28%, 설비투자 50%, 배당 10% 변화는 테스트용 계산 사례입니다.
실제 투자 판단에 사용하지 마세요.

공개 서비스를 만들 때는 계정 소유자만 할 수 있는 설정이 남습니다.
Supabase 프로젝트/Google OAuth, 비공개 원본 버킷, OpenDART 키, SEC 연락처,
OpenAI API 키/모델, 실제 서버 도메인·비밀 환경변수 등록입니다.
비용 발생·계정 권한·도메인 연결 승인이 필요할 수 있습니다. 비밀 키를 채팅이나 소스에 붙여넣지 마세요.

## 완료와 미완료의 경계

프론트/백엔드 소스, API, 데이터 수집, 원본 저장, 검증/변경 비교, 작업 큐, 테스트,
마이그레이션, 배포 설정을 작성했습니다. 자세한 실행 결과는 `docs/VERIFICATION.md`에 있습니다.

현재 환경에는 npm 네트워크, PostgreSQL 서버, Docker, 실제 서비스 계정이 없어
Next 빌드·전체 타입/린트·브라우저 E2E·운영 DB/RLS·실제 OAuth/공시/API·배포를 검증하지 못했습니다.
이 항목들은 다음 실행 환경에서 반드시 통과시켜야 하는 **남은 작업**입니다.
따라서 완성도를 측정 없이 99%라고 보증하거나, 남은 일이 키 입력뿐이라고 말하지 않습니다.
