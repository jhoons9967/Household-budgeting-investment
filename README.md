# 가계부 · 투자일지

파이썬·서버 없이 브라우저에서 도는 개인 가계부/투자일지 웹앱.

## 폴더 구조

```
gagyebu-app/
├── index.html      화면 구조 (여기 요소 추가/수정)
├── css/style.css   디자인 (색·글꼴·레이아웃 토큰은 :root 참고)
├── js/app.js       기능 (저장·계산·환율·렌더)
└── README.md
```

## VS Code에서 실행하며 개발하기

1. 이 폴더를 VS Code로 엽니다 (`File > Open Folder`).
2. 확장 **Live Server**를 설치합니다 (Extensions에서 "Live Server" 검색 → Install).
3. `index.html`을 열고 우클릭 → **Open with Live Server**.
4. 브라우저가 `http://127.0.0.1:5500` 같은 주소로 뜹니다. 코드를 저장하면 **자동 새로고침**돼요.

> Live Server 없이 `index.html`을 더블클릭해 열어도 동작합니다. 다만 자동 새로고침이 없고,
> 일부 브라우저는 로컬 파일에서 환율 자동 조회를 막을 수 있어요. 개발은 Live Server 권장.

## 데이터 저장 방식

- 이 버전은 데이터를 **브라우저(localStorage)** 에 저장합니다 → 그 기기에만 남고, 기기 간 자동 동기화는 안 됩니다.
- `js/app.js` 안에 Claude 계정 동기화 코드(`claude.use`)가 들어 있지만, 그건 claude.ai 아티팩트로 띄웠을 때만 켜집니다. GitHub Pages·로컬에선 자동으로 localStorage 모드로 동작합니다.
- 나중에 기기 간 동기화가 필요하면 Firebase(Firestore) 같은 무료 DB를 붙이면 됩니다.

## GitHub Pages로 배포

1. 새 저장소를 만들고 이 폴더의 파일들을 그대로 올립니다 (`index.html`이 루트에 있어야 함).
2. Settings → Pages → Source: **Deploy from a branch**, Branch: **main / (root)** → Save.
3. 1~2분 뒤 `https://아이디.github.io/저장소이름/` 주소가 생깁니다.

수정할 때는 파일만 다시 올리면(commit) 같은 주소에 반영돼요.

## 고칠 때 자주 건드릴 곳

- **색/글꼴** → `css/style.css` 맨 위 `:root` 변수
- **입력 항목 추가** → `index.html`의 `<form>` + `js/app.js`의 add 핸들러/state
- **계산·집계 로직** → `js/app.js`의 `renderGG()` / `renderIV()`
- **환율 API** → `js/app.js`의 `fetchRate()` (현재 frankfurter.dev 사용)
