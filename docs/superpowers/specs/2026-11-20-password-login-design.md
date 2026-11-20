# ID とパスワードでの登録・ログイン（Auth.js に移す）

日付: 2026-11-20 ／ 元にするブランチ: `remove-ffpf-login`（Sparklingstadt/typle-r#363、v2.54.0。FFPF ID のログインを消したもの）／ 予定のバージョン: v2.55.0

## 何のために

- GitHub のアカウントを持っていない人も含めて、**誰でも** Typle のアカウントを作り、クラウドに保存できるようにする。
- ログインのしくみを、持ち主が理解して直せる **Auth.js（next-auth v5）** の作法にそろえる。
  - 今の自前のログイン（`src/server` の signin・session・auth）は、持ち主には読めない。
  - typle-r は v0.2.0〜v0.55.0 で Auth.js を使っていた。

## 目標

1. ID・メールアドレス・パスワードで登録できる。ID とパスワードでログインできる。
2. パスワードを忘れた人は、登録したメールアドレスに届くリンク（Resend で送る）で新しいパスワードを決められる。ID を忘れた人は、メールアドレスを入れると、そのアドレスで確認済みのアカウントの ID が届く。
3. GitHub のログインは残し、ログイン画面に ID・パスワードと並べる。
4. ログイン（GitHub と ID・パスワードの両方）を Auth.js に移す。
5. ログインの Cookie は、**今と同じ名前・同じ形**のままにする（下の「セッションの形」）。こうすると、次の3つが変わらない。
   - 今ログインしている人がログアウトされない。
   - Go・Kotlin の比較と `TYPLE_BACKEND=go` の切り替え（v2.52.0）が、そのまま動く。
   - 共通の fixture `tests/fixtures/sessions.json` がそのまま使える。
6. 「すべての端末からログアウト」（`typle_session_revocations`）は今のまま使える。

## 目標にしないこと

- iPad・Mac のアプリのログイン。`/api/auth/token`、`signin?client=…&code_challenge=…`、アプリの Bearer トークンは**やめる**。
  - アプリは端末内の保存だけで使う。
  - 必要になったら、Auth.js の上で作り直す。
- GitHub のアカウントと ID・パスワードのアカウントをつなぐこと・移すこと。両者は別のアカウントになる。
- メールアドレスの変更、アカウントの削除、ID の変更。必要になったら次の版で足す。
- 2段階認証、パスキー、ほかのログイン方法。
- ログインしたまま延長されるセッション。今と同じく、ログインから30日で切れる。

## 失敗とみなすこと（動いていてもダメなもの）

- パスワード、または再設定のトークンそのものが、DB・ログ・メール以外のどこかに残る。
- 再設定や ID の問い合わせの答えで、ある ID やメールアドレスが登録済みかどうかが分かる。
  - 登録画面で「その ID は使われています」と出るのは避けられないので、これは除く。
- 今の GitHub のアカウント（`github:<番号>`）のワークスペースや記録が、移したあとに開けなくなる。
- 総当たりでパスワードを試せる。
- メールの送信を外から好きなだけ起こせる（Resend の無料枠は1日100通）。

## 作り方の選択（Approaches）

話し合いで出た作り方と、選んだ理由。

1. **今の自前のログインに足す**: 依存が増えず、変更も小さい。持ち主がこのコードを読めないので、選ばなかった。
2. **Auth.js に移す**（選んだもの）: 持ち主が理解できる作法になる。
   - GitHub も含めてまるごと移す。ID・パスワードのところだけ Auth.js にする形は、自前のコードが残ったままになるので選ばなかった。
   - 登録・確認・再設定・総当たりへの備えは、Auth.js にないので自前で書く。
3. **外部の認証サービス（Neon Auth など）**: 外部サービスを減らしてきた方向と逆なので、選ばなかった。

Auth.js に移すときの2つの選択も、持ち主が決めた。

- **アプリのログイン**: アプリのトークンの部分を自前で残す案と、アプリのログインを止める案があった。止める案を選んだ。Auth.js だけで完結し、アプリは App Store で配っていないので、困るのは持ち主だけ。
- **Go・Kotlin との関係**: 3つの案があった。
  - Auth.js の Cookie を今と同じ形にする（選んだもの）。
  - Go・Kotlin の比較を health だけにする。
  - Go・Kotlin に Auth.js 標準の暗号化 JWT を読ませる。

  1つ目を選んだのは、数日前に決めた「いつでも Go に切り替えられる」を守れて、ログイン中の人も困らないから。

## 決まっていること

### Auth.js の組み立て

- `next-auth@5`（beta）を入れる。`auth.ts`（ルートか `src/`）に `NextAuth({...})` を置く。
- `src/app/api/auth/[...nextauth]/route.ts` で `handlers` を出す。
- プロバイダーは次の3つ。
  - **GitHub**: アカウント ID は今と同じく `github:<GitHub のユーザー番号>`。名前は今と同じく、プロフィールの名前、なければ login。画像は avatar_url。
  - **Credentials（id: `password`）**: ID とパスワード。アカウント ID は `password:<typle_users.id の UUID>`、名前は ID。
  - **Credentials（id: `local`）**: 今の開発用ログイン（`github:0`、`ローカル練習用`）。今の `localLoginAllowed` と同じ条件のときだけ有効にする。E2E がこれでログインする。
- セッションは JWT。データベースのセッションと adapter は使わない（Credentials と一緒に使うため）。
- 画面は `next-auth/react` の `SessionProvider`・`useSession`・`signIn`・`signOut` を使い、`src/lib/session.tsx` の自前の実装を置き換える。
  - **更新（2026-11-20、実装のあと）**: 画面は `src/lib/session.tsx` の自前の `SessionProvider`・`useSession` を残し、それが Auth.js の `/api/auth/session` を読む。読めなかったときに 1・2・4 秒あけて読み直す今の動きを保つためで、`next-auth/react` の `useSession` にはこの読み直しがない。`next-auth/react` から使うのは `signIn` と `signOut` だけにする。`next-auth/react` の `useSession` に替えたいときは、読み直しをどう扱うかを決めてから後で入れ替える。
  - `session.user.id` にアカウント ID を入れる（session コールバック）。
  - 今の画面の決まり（最初の確認は 1・2・4 秒後にやり直す、失敗しても前の状態を保つ）は、`useSession` でできる範囲で保つ。保てない部分は、設計書の更新として持ち主に伝える。

### セッションの形（今と同じにする）

- Cookie の名前は、今と同じく `AUTH_URL` が HTTPS なら `__Host-typle-session`、HTTP なら `typle-session`。`HttpOnly`・`SameSite=Lax`・`Path=/`・30日。Auth.js の `cookies.sessionToken` で指定する。
- 中身は今と同じ形にする。`jwt.encode`・`jwt.decode` を差し替え、今の `src/server/session.ts` の `sealSession`・`openSession` と同じ形と鍵（`AUTH_SECRET` から HKDF、info `typle session v1`）にする。
  - 形は、JSON `{sub, name, image, iat, exp}` を HMAC-SHA256 で署名したもの。
  - Auth.js の token の `picture` は `image` に写す。
- **延長しない**。Auth.js の JWT は、読むたびに書き直して期限を延ばす。encode では元の `iat`・`exp` を保つ。期限が延びないことをテストで確かめる。
- 受け付けるアカウント ID は `github:\d+`・`password:<UUID>`・`ffpf:[a-z0-9]{1,64}`。
  - `ffpf:` は v2.54.0 の約束どおり、v2.53.1 までのログインが切れるまで（v2.55.0 の出る日から30日あとまで）受け付ける。
- Go の `server/internal/session/session.go` と Kotlin の `kotlin/.../Session.kt` の、アカウント ID の決まりにも `password:<UUID>` を足す。足さないと、Go に切り替えたとき ID・パスワードの人が保存できない。`tests/fixtures/sessions.json` にも、そのケースを足す。

### API が誰かを確かめるところ

- Route Handler（workspace・records ほか）は、今の `signedIn`（`src/server/account.ts`）のまま、Cookie を読んで失効の表を確かめる。
  - Cookie の形が同じなので、書き換えは要らない。
  - `Authorization: Bearer` の読み取り（アプリのトークン）は消す。
- `/api/auth/session` は Auth.js のもの（`{ user: { id, name, image }, expires }`）になる。今の `{ user, providers }` の形と、それを照らすテスト（Go の時代の fixture `auth-answers.json` のうち session の部分）はやめる。
- `/api/auth/signout` は Auth.js のものになる。
  - 「すべての端末からログアウト」（今の `?everywhere=1`）は、Auth.js の経路とぶつからない別のパス（例: `POST /api/account/signout-everywhere`）に移す。
  - 動き（失効の表に書いて、この端末の Cookie も消す）は今と同じ。
- **失効の扱いは今と同じにする**（設計者の判断）:
  - Auth.js の jwt コールバックで `typle_session_revocations` を読み、失効していれば「ログインしていない」と答え、Cookie も消す。今の `/api/auth/session` と同じ動き。
  - 読むのは1秒まで待ち、間に合わなければ確かめずに続ける（今の `revokedSoon`）。
  - こうすると、「すべての端末からログアウト」やパスワードの再設定のあと、ほかの端末の画面もログアウトした表示になる。
- **パスワードを変えた端末は、ログインしたまま残す**（設計者の判断）:
  - 失効の表に書いたあと、その端末には新しいセッション（`iat` が `revoked_at` より後）を発行し直す。
  - 再設定のときも同じで、決めたらその端末でログインした状態にする（リンクが届いたことで本人と確かめられたため）。
  - `revokedBy` は秒単位で比べるので、同じ秒に発行し直すと新しいセッションも失効してしまう。このずれは builder が手当てする。
  - Auth.js の普通の更新は `iat` を保つので、発行し直しは別の経路（Credentials でログインし直す、など）でする。
- **Go・Kotlin の Bearer トークンは触らない**（設計者の判断）:
  - Go と Kotlin は v2.52.0 の写しで、Next.js に合わせ続けないと `docs/backend-compare.md` で決めている。
  - Bearer を受け付ける部分と、`sessions.json` の `tokens` は残す。
  - 新しいトークンはもう発行されないので、残るのは、v2.54.0 までに発行したトークン（30日で切れる）が `TYPLE_BACKEND=go` のときだけ通る、という違いだけ。これは `docs/backend-switch.md` に書く。
- **Auth.js の書き直し**: Auth.js は session を読むたびに、Cookie の `Expires` と `session.expires` を今から30日に書き直す。中身の `exp` で切れるので害はない。テストは中身の `exp` で確かめ、`session.expires` は session コールバックで中身の `exp` に直す。
- やめるもの: `/api/auth/token`、`/api/auth/local`（Credentials `local` に置き換え）、自前の `signin.ts`・`auth.ts`・`github.ts`・`provider.ts`・`goUrl.ts` のうちログインのために要るもの、`typle-oauth` の Cookie。

### アカウントの表（`db/migrations/0039_password_accounts` ほか）

- `typle_users`
  - `id` uuid（主キー）
  - `login_id` text：小文字にしたもの、一意
  - `email` text：小文字にしたもの、一意にはしない
  - `email_verified_at` timestamptz null
  - `password_hash` text
  - `locale` text：登録したときの表示言語。メールの言語に使う
  - `created_at`・`updated_at`
- `typle_email_tokens`
  - `token_hash`（主キー）：トークンの SHA-256
  - `user_id`
  - `kind`：`verify` か `reset`
  - `email`：確認するアドレス
  - `expires_at`、`used_at`
- `typle_auth_limits`：回数制限の記録。
  - キーは `login:<ID>`・`ip:<IP>:<操作>` のように、何をいつから何回したかを持つ。
  - 古い行の消し方は builder が決める。

### ID・パスワード・メールの決まり

- **ID**: 半角英数字と `_`・`-` で3〜32文字。大文字と小文字は区別しない（小文字にして保存し、比べる）。あとから変えられない。
- **パスワード**: 10〜128文字。ID と同じものは不可。
  - Node.js の `crypto.scrypt` でハッシュ化し、パラメーターと塩を一緒に保存する。強さは builder が決める（目安は N=2^15、r=8、p=1）。
  - 存在しない ID のログインでも同じだけ時間をかけ、ID があるかどうかを時間で分からないようにする。
- **メールアドレス**: 形が正しいことだけ確かめる。同じアドレスで複数のアカウントを作ってよい。

### 画面（6言語）

- `/signin`: GitHub のボタン、ID とパスワードの欄、「登録」「パスワードを忘れた」「ID を忘れた」へのリンク。トップバーの「ログイン」はここへ行く。
- `/signup`: ID・メールアドレス・パスワード。
  - 登録できたら、そのままログインして元のページへ戻る。
  - 確認のメールを送り、「メールを確認してください」と出す。
- `/verify-email?token=…`: アドレスを確認済みにする。
- `/forgot-password`: ID を入れる。答えは、ID があってもなくても同じ文言。確認済みのアドレスがあれば、そこへ再設定のリンクを送る。
- `/reset-password?token=…`: 新しいパスワード。
  - 決めたら、すべての端末からログアウトさせる（失効の表に書く）。
  - そのアドレスは確認済みにする（リンクが届いた証拠なので）。
- `/forgot-id`: メールアドレスを入れる。答えは、あってもなくても同じ文言。そのアドレスで確認済みのアカウントがあれば、ID の一覧を送る。
- 設定に「アカウント」の節を足す（ID・パスワードのアカウントのときだけ出す）。
  - メールアドレスと、確認したかどうかを表示する。
  - 確認のメールを送り直せる。
  - パスワードを変えられる。今のパスワードが要り、変えたらほかの端末はログアウトさせる。
- 書き込みの API は、今と同じく Origin を確かめる（`src/server/request.ts`）。

### メール（Resend）

- `RESEND_API_KEY` と `TYPLE_MAIL_FROM`（例 `Typle <no-reply@sparklingstadt.com>`）を環境変数で渡す。SDK は入れず、fetch で `https://api.resend.com/emails` に送る。
- 送るメールは3種類（確認・再設定・ID の通知）。言語は `typle_users.locale`。ID の通知だけは、入力したときの表示言語で送る。
- リンクの期限は、確認が24時間、再設定が30分。どちらも1回だけ使える。トークンは32バイトの乱数で、DB には SHA-256 だけを持つ。
- 送信に失敗したときは、画面に「送れなかった」とだけ出す。失敗はログに残す。
- ドメインの登録（DNS）と API キーの作成は、持ち主が Resend のサイトでする。

### 回数の制限（目安。数は builder が調整してよい）

- ログインの失敗:
  - 同じ ID で15分に5回失敗したら、その ID を15分止める。
  - 同じ IP で15分に30回失敗したら、その IP を止める。
  - 止まっている間は、正しいパスワードでも同じ失敗の答えにする。
- 登録: 同じ IP で1時間に5件まで。
- 再設定・ID の問い合わせ・確認の送り直し:
  - 同じ ID かアドレスへは1時間に3通まで。
  - 同じ IP からは1時間に10回まで。
  - 超えたときも、画面の答えは同じ文言にする（送らないだけ）。
- **更新（2026-11-20、最終レビューのあと）**:
  - 登録とメールの制限は、仕事の前に1回分を数えて（予約して）から進める。同時に送られた要求がそろって制限をすり抜けないためで、数えられなかった要求は断る（登録・確認の送り直しは 429、再設定・ID の問い合わせは 200 のまま送らない）。予約したあとに送れなかったメールも1回に数える。
  - 再設定と ID の問い合わせは、アカウントがあるかどうかにかかわらず、答える前に同じように数える（数えることはアカウントの有無に関係しないので、答えの時間から有無はわからない）。
  - すべてのメールを合わせて、UTC の1日に80通まで（Resend の無料枠の1日100通より下）。1つのクライアントが全員の再設定メールを使い切れないようにするため。送る直前に数え、超えたら送らない（登録は 201 で `mailSent: false`、確認の送り直しは 429、再設定・ID の問い合わせは 200）。
  - 再設定が済んだら、その ID のログイン失敗の数を消す（リンクが持ち主であることを示したので、新しいパスワードですぐにログインできる）。パスワードの変更は、ID か IP が止まっているとき 429 で答える（ログイン中の本人なので、止まっていると伝えても何も漏れない）。
- IP は Vercel が付ける `x-forwarded-for` の最初の値で数える。IPv6 のクライアントは /64 ごとに数える（1つの回線に /64 がまとめて渡されることが多く、アドレスを変えるだけで制限を抜けられないように）。IPv4 は今のまま。

## 決まっていないこと（builder に任せる）

- ファイルの置き場所と分け方、Auth.js の設定の書き方の細部。
- scrypt の強さ、回数の制限の細かい数と、古い行の消し方。
- 画面の見た目。今の `/local-login` と設定の画面に合わせる。
- テストの作り方。そのうえで、少なくとも次は確かめる。
  - 今の GitHub のセッションの Cookie が移したあとも開ける（`sessions.json`）。
  - 期限が延びない。
  - `password:` のアカウントで、Go・Kotlin の workspace が開ける。
  - 存在しない ID と、パスワードの誤りが区別できない。
  - 制限で止まる。
  - トークンは1回しか使えない。
  - Resend は、テストでは偽物の送り先に向ける。
- Go の時代に記録した auth・signin の fixture のうち、Auth.js に移った経路のものは、記録として残して照らすのをやめる（ダッシュボードや FFPF ID を消したときと同じ扱い）。
- `scripts/check-production.cjs` の、ログインまわりの確認を Auth.js の答えに合わせて直す。
- 文書（README・`api-docs/`・`.env.example`・`docs/release-workflow.md`・「Typleについて」の保存先とプライバシーの説明）を直す。
  - メールアドレスを預かるようになるので、「Typleについて」に、何のためにどう使うかを書く。

## 持ち主の作業

1. Resend のアカウントで、送信元のドメインを登録する（DNS のレコードを足す）。API キーを作る。
2. Vercel の環境変数に、`RESEND_API_KEY`・`TYPLE_MAIL_FROM` を足す（Production と Preview）。
3. 公開のあと、iPad・Mac のアプリはログインできなくなることを承知しておく。アプリ側の「ログイン」の表示を消すのは、typle-ipad の別の作業になる。
