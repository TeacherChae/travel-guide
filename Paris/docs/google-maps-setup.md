# Google Maps API 키 설정

확인: **2026-09-11**. 이 가이드는 서버 없는 웹 편집기의 장소 검색·지도 클릭 선택을 위한 설정입니다. Google 계정 로그인, 결제 계정 연결, 키 발급은 사용자가 직접 진행합니다. 키를 채팅이나 Git에 올리지 마세요.

## 1. Google Cloud 프로젝트와 결제 계정

[Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 만들거나 선택하고 결제 계정을 연결합니다. 실제 배포용 표준 키에는 결제 설정이 필요합니다. 무료 사용 범위가 있더라도 계속 무료라고 가정하지 마세요. [Google 공식 시작 안내](https://developers.google.com/maps/documentation/javascript/get-api-key)

## 2. 두 API 활성화

프로젝트의 **API 및 서비스 → 라이브러리**에서 아래 두 항목을 활성화합니다.

- **Maps JavaScript API**: 팝업 안의 지도와 장소 클릭.
- **Places API (New)**: 장소 자동완성 검색과 선택한 장소 정보.

이 편집기는 새 `PlaceAutocompleteElement`와 `gmp-select` 이벤트를 사용합니다. 이름이 비슷한 기존 Places API만 켜두지 마세요. 별도의 Geocoding API나 Directions API는 이 구현에 필요하지 않습니다. [Places New 자동완성 공식 안내](https://developers.google.com/maps/documentation/javascript/place-autocomplete-new)

## 3. API 키 발급과 사용 제한

**API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → API 키**에서 발급하고, 즉시 키의 제한을 설정합니다.

### 애플리케이션 제한: 웹사이트(HTTP 리퍼러)

실제로 사용하는 주소만 허용합니다. 다음은 예시입니다.

```text
https://teacherchae.github.io/*
http://localhost:8000/*
http://127.0.0.1:8000/*
```

다른 도메인에 배포하면 자신의 도메인으로 바꾸세요. `https://*.github.io/*`처럼 타인의 사이트까지 허용하지 마세요. 브라우저가 교차 출처 요청에서 경로를 생략할 수 있으므로 특정 저장소 경로만 넣는 제한은 동작하지 않을 수 있습니다. 개발용과 배포용 키를 분리하는 편이 좋습니다. [Google 키 보안 안내](https://developers.google.com/maps/api-security-best-practices)

### API 제한: 키 제한

**Maps JavaScript API**, **Places API (New)**만 허용합니다. iPhone에서 이 웹사이트를 사용해도 네이티브 iOS 앱 제한이 아니라 **웹사이트 제한**입니다. [공식 제한 설정](https://developers.google.com/maps/api-security-best-practices)

## 4. 이 편집기에 입력

1. 웹사이트에서 **설정**을 엽니다.
2. **Google Maps API 키**에 입력하고 저장합니다.
3. **장소 추가/수정 → Maps 선택**을 엽니다.
4. 검색 결과를 선택하거나 지도 위의 장소를 클릭하고, 선택 내용을 확인한 뒤 **적용**을 누릅니다.
5. 장소 폼에서 **저장**해야 일정과 인접 경로에 반영됩니다. 지도 팝업을 취소하면 원래 Maps 값은 그대로입니다.

키는 해당 기기·브라우저의 별도 `localStorage` 항목에 저장하고 장소 백업 JSON에는 포함하지 않습니다. 탭과 브라우저를 닫아도 유지되지만 다른 기기·다른 브라우저에서는 다시 입력해야 하며, 브라우저 데이터 삭제 시 사라집니다. SDK가 이미 로드된 상태에서 키를 바꾸면 편집을 마친 뒤 새로고침해야 합니다. 브라우저 SDK 키는 네트워크 요청에서 보일 수 있으므로, 비밀번호처럼 숨기는 대신 위 제한이 필수입니다. [브라우저 키 보안 지침](https://developers.google.com/maps/api-security-best-practices)

## 5. 비용·오류 확인

- Google Cloud에서 API 할당량을 검토하고, 필요하면 일일 요청 제한을 낮춰 설정하세요. [사용량·할당량 안내](https://developers.google.com/maps/documentation/javascript/usage-and-billing)
- 결제 예산 알림도 설정하세요. **예산 알림은 지출을 자동 차단하는 상한이 아닙니다.** [Google Cloud 예산 안내](https://docs.cloud.google.com/billing/docs/how-to/budgets)
- 인증 오류: API 활성화, 결제 연결, 웹사이트 리퍼러, API 제한과 브라우저 콘솔의 Google 오류를 확인합니다. 오류를 해결하려고 키 제한을 전부 해제하지 마세요.
- `file://`로 열면 웹사이트 리퍼러 제한이 동작하지 않을 수 있습니다. Google 검색 테스트는 정적 호스팅 주소 또는 아래 로컬 HTTP 주소를 사용하세요. 이 명령은 정적 파일만 제공하며 Notion 연동 서버가 아닙니다.

```sh
python3 -m http.server 8000 --bind 127.0.0.1
# http://127.0.0.1:8000
```

## 키 없이 가능한 것 / 불가능한 것

- 가능: 장소 CRUD, 브라우저 저장, JSON 백업·복원, 저장된 장소 검색, 긴 Google Maps URL 직접 입력, 기존 방식의 iframe 지도·구간 링크 생성.
- 키 필요: 전 세계 Google 장소 자동완성 검색, Google 지도에서 클릭한 장소를 폼으로 가져오기.
- 일반 교차 출처 iframe 안에서 사용자가 클릭한 장소는 부모 페이지가 읽을 수 없습니다. 키 없는 모드에서 이 기능이 되는 것처럼 표시하지 않습니다.

## 검증 범위

코드는 Places New 이벤트·지도 클릭·실패 처리·비동기 선택 경합을 모의 SDK로 검사합니다. 실제 키가 제공되기 전에는 Google의 실제 승인, 과금, 검색 결과 품질, 개별 도메인 제한의 성공을 검증한 것이 아닙니다. 공개 템플릿 배포 시 Google Maps Platform의 현재 약관과 표시·저장 정책도 확인하세요.
