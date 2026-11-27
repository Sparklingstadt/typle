# typle-r のログインを Auth.js から Better Auth に移す

typle-r のログイン（今は Auth.js、next-auth v5 beta）を Better Auth に置き換える設計です。ID サーバー（`sparklingstadt-id`）は 2026-11-27 に Better Auth へ移しました。typle-r はその次の作業です。

## 1. なぜ作るか

- Auth.js は 2025 年に Better Auth のチームに引き継がれ、v5 は beta のまま保守だけが続いています。Next.js の版上げで壊れたとき、すぐに直る保証がありません。
- 持ち主は、ID サーバーと typle-r の両方を Better Auth にそろえると決めました。
- 今のログインは、Go のバックエンドと同じ形の Cookie を Auth.js に作らせるなど、自前の部分が多くあります。Go のバックエンドは v2.60.5 でこのリポジトリから分け、本番では Cookie を読みません。利用者は持ち主だけなので、今が自前の部分を一番安く捨てられます。

## 2. 目標・目標でないもの・失敗とみなすもの

**目標**

- ログインを Better Auth 1.7 系（`better-auth`）にする。ログインの方法は今と同じ 3 つです。
  - Sparklingstadt ID（OIDC、`genericOAuth`）
  - GitHub（Better Auth の `socialProviders.github`）
  - 開発用のローカルログイン
- セッションは Better Auth の標準どおり DB（今の Postgres、Prisma）に持つ。持ち主が選んだ案 A です。
- 持ち主のデータ（ワークスペースと記録）が、切り替えのあとも同じアカウントで読めること。データの持ち主の ID（`github:219588180` など）は変えません。
- 「すべての端末からログアウト」を Better Auth のセッションの削除で行い、専用の表 `typle_session_revocations` と自前の Cookie のコード（`src/server/session.ts`・`authJwt.ts`・`authOptions.ts` の大部分）をなくす。
- Sparklingstadt ID のひも付け（`typle_sid_links`）を、Better Auth の「1 人のユーザーに複数のログイン方法（account）」に移す。持ち主のアカウントには、GitHub と Sparklingstadt ID の 2 つのログインがつく。
- callback は Better Auth の標準の URL を使う（持ち主の決定。転送などの自前の仕組みを作らない）。GitHub は今と同じ `/api/auth/callback/github` なので、OAuth アプリは変えない。Sparklingstadt ID も実装では今と同じ `/api/auth/callback/sid` なので、ID サーバーの登録は変えない（訂正。下の 4.2 と 5 章）。

**目標でないもの（今回は作らない）**

- typle-r でのパスキー・二要素認証。指紋と二要素認証は ID サーバーで行います。
- 新しいログインの方法（メール＋パスワードなど）。
- 今のログイン（Cookie）の引き継ぎ。切り替えで一度ログアウトになってよい（利用者は持ち主だけ）。
- `typle_users`・`typle_email_tokens`・`typle_auth_limits`（廃止した ID とパスワードのログインの表）の整理。今回は触らない。
- typle-backends（Go・Kotlin・Rails の比較用の実装）の追従。

**失敗とみなすもの（動いていても）**

- 切り替えのあとに持ち主がログインすると、データのない別のアカウント（新しい ID）になる。
- GitHub の OAuth アプリの設定を変えないと、ログインできない（訂正：Sparklingstadt ID の callback も今と同じ URL なので、ID サーバーの登録は変わらない）。
- Sparklingstadt ID でログインしたときに、`email_verified` が true でない ID でも入れてしまう（今は断っています）。
- ログアウトしたあと、次の Sparklingstadt ID のログインで、パスワードを聞かれずに ID サーバーから戻ってくる。今は Cookie `typle-sid-relogin` で `prompt=login` を付けています。
- 本番で開発用のローカルログインが使えてしまう。
- ゲスト（ログインしない利用）で、ブラウザーに保存するモードが使えなくなる。

## 3. 作り方（Approaches）

1. **Better Auth の標準どおり、セッションを DB に持つ（採用）**。ユーザー・ログイン方法・セッションを Better Auth の表で Postgres に持つ。「すべての端末からログアウト」と、ひも付けを標準の仕組みで行い、自前の Cookie・失効の表・ひも付けの表をなくす。毎回 DB を読まないよう、セッションを Cookie に数分キャッシュする（`session.cookieCache`）。欠点は、DB が止まっているあいだはログインもできないこと。データの保存と読み込みはどのみち DB が要るので、実際の差は小さい。
2. **セッションを Cookie だけに持つ（Better Auth の stateless 方式）**。今と同じく DB なしでログインが動く。ただし、ひも付けと「すべての端末からログアウト」は今の自前の表とコードを残して Better Auth につなぐことになり、自前の部分があまり減らない。
3. **Better Auth を OAuth の入口だけに使い、今の自前の Cookie を残す**。Auth.js と同じく自前の部分が多く残り、移す意味が薄いので外した。

持ち主が 1 を選んだ。GitHub でのログインは残すと持ち主が決めた（ID サーバーが止まっても入れるように）。

## 4. 作るもの

### 4.1 Better Auth の構成

- `better-auth` を 1.7 系で固定して入れる（ID サーバーと同じ 1.7.28）。DB は今の Prisma（`src/server/database.ts` の pool の上の Prisma Client）を `prismaAdapter` で使う。
- ハンドラーは `src/app/api/auth/[...all]/route.ts`。`src/app/api/auth/[...nextauth]` と `src/auth.ts` は消す。
- **シークレット（持ち主の決定）**：Better Auth の標準の環境変数 `BETTER_AUTH_SECRET` を使う。新しい値を作り、Vercel（Production と Preview）と AWS（`infra/` の Secrets Manager、`typle/BETTER_AUTH_SECRET`）に足す。`infra/` の CDK のコードとテストも、この名前を渡すように直す。
  - 今の `AUTH_SECRET` は、自前の Cookie の鍵（`src/server/settings.ts`）にだけ使っていた。そのコードを消すので、アプリは `AUTH_SECRET` を読まなくなる。Vercel と AWS からの削除は、古い表を消す後日の PR で行う。
  - 開発用ログインの条件（`src/lib/localDevelopment.ts`）と `scripts/setup-local.cjs`・`.env.example` も `BETTER_AUTH_SECRET` に替える。
  - `AUTH_URL` を `baseURL` にする。
- **表**：Better Auth の表（user・session・account・verification、DB のレート制限を使うなら rate limit）を Prisma のマイグレーションで足す。
  - 表の名前は今の `typle_` の接頭辞に合わせる（例 `typle_auth_users`・`typle_auth_sessions`・`typle_auth_accounts`・`typle_auth_verifications`）。
  - カラムは snake_case。
  - 細かい名前は作る人が決める。
- **ユーザーの ID**：Better Auth の `user.id` を、今のアカウント ID（`github:<番号>`・`sid:<sub>`・`password:<UUID>`・`ffpf:<sub>`）そのものにする。ワークスペースと記録の `owner_id` はこの ID なので、データの表は変えない。
  - 新しいユーザーを作るときの ID は、ログインの方法で決める。GitHub は `github:<GitHub のユーザー番号>`、Sparklingstadt ID は `sid:<sub>`、開発用は `github:0`。今と同じです。
  - Better Auth の ID 生成をそのまま使わず、ユーザー作成のフック（`databaseHooks.user.create.before` か、プロバイダーごとの `mapProfileToUser`）で決める。`create.before` の戻り値は `forceAllowId` で保存される（Better Auth 1.7.28 で確認済み）。
- **ユーザーのメールアドレス（持ち主の決定）**：Better Auth はユーザーごとにメールアドレスを必須・一意で持つ。typle-r は本物のアドレスを持たず、アカウント ID から作った仮のアドレスを入れる。
  - 形は `<アカウント ID>@users.invalid`（例 `github:219588180@users.invalid`。`.invalid` は届かないと決まっている名前）。`emailVerified` は true にする。
  - GitHub と Sparklingstadt ID の本物のアドレスは、プロフィールから写さない（`mapProfileToUser` で上書きする）。
  - そのため、GitHub のログインは今と同じく scope なしでよい。GitHub でアドレスを非公開にしていても入れる。
  - 理由：typle-r はメールを送らない。持ち主の個人情報を新しく持たない。本物のアドレスだと、Better Auth が「同じアドレスのユーザーにつなぐ」判断をして、ひも付けていない ID を断る問題が生まれる。仮のアドレスはアカウント ID ごとに違うので、この判断が起きない。
  - Better Auth の GitHub provider が、アドレスがないとログインを断る動き（`email_not_found`）を、`mapProfileToUser`（か `getUserInfo` の上書き）で仮のアドレスを返すことで避ける。scope なし・アドレス非公開の GitHub アカウントでログインできることを、テストで確かめる。

### 4.2 ログインの方法

**GitHub**

- `socialProviders.github` を使う。scope は要らない（今と同じく「誰か」だけ分かればよい）。
- 表示名は今の `githubProfile`（`src/server/authOptions.ts`）と同じ決め方にする（プロフィールの名前、空ならログイン名）。画像は `avatar_url`。
- callback は Better Auth の既定で `/api/auth/callback/github`。今と同じなので、GitHub の OAuth アプリは変えない。

**Sparklingstadt ID**

- `genericOAuth` プラグインで、provider id `sid` として登録する。
  - issuer は `AUTH_SID_ISSUER`（discovery を読む）、`AUTH_SID_ID`・`AUTH_SID_SECRET`。
  - scope は `openid email profile`。PKCE は S256。
- **callback は `/api/auth/callback/sid`（今と同じ）。** （訂正：Better Auth 1.7.28 の `genericOAuth` はログインを `POST /api/auth/sign-in/social`（provider `sid`）で始め、callback は `GET /api/auth/callback/sid` で、今と同じ URL。ID サーバーの登録は変わらない。実装で確かめた。）ログインの開始も GitHub と同じ `/sign-in/social`（provider `sid`）。当初の想定（標準の `/api/auth/oauth2/callback/sid` に変え、ID サーバーの登録へ足す）は、この確認で不要になった。転送する仕組みも作らない。
- ID トークンの `email_verified` が true でなければ断る。`sub` の形の確かめ（今の `sidProfile`）も残す。
- 表示名は今と同じ決め方にする（`name`、空ならアドレスの @ より前）。
- **ログアウトのあとの再ログイン**：ログアウト（「すべての端末からログアウト」を含む）のあと、次の Sparklingstadt ID のログインで `prompt=login` を付ける。今の `typle-sid-relogin` の Cookie の仕組み（`src/server/sidLogin.ts`）を Better Auth のログアウトとログインにつなぎ直す。ログインが成功したら Cookie を消す。

**開発用のローカルログイン**

- 今と同じ条件（`readLoginSettings` の `localLogin`、`docs/development.md` の「開発用ログインで起動」）のときだけ有効にする。
- 小さな自前のプラグインで作る。`github:0`、名前「ローカル練習用」のユーザーでセッションを作る。
- 本番では、エンドポイントそのものが 404 を返すこと。

### 4.3 アカウントのひも付け（`typle_sid_links` の置き換え）

- Better Auth の account の表に、持ち主のユーザー（`github:219588180`）の行を 2 つ持つ。`providerId: "github"`（`accountId` は GitHub の番号）と、`providerId: "sid"`（`accountId` は ID の `sub`）。
- Sparklingstadt ID でログインしたとき、その `sub` の account がすでにあれば、そのユーザーとして入る。なければ新しいユーザー `sid:<sub>` を作る。
- **メールアドレスによる自動のひも付けは使わない**（`accountLinking` で同じメールのユーザーに自動でつなぐ機能はオフ）。今と同じく、ひも付けは手元のスクリプトで明示的に行う。
- `scripts/sid-link.cjs`（`npm run sid:link`）は、新しい account の表に行を足すスクリプトに書き直す。今の安全の確かめは同じにする（ひも付け先が既存のアカウントでデータがあること、`sid:<sub>` 側にデータがないこと、二重のひも付けをしないこと）。

### 4.4 セッションと API

- Route Handler（`src/server/workspace.ts`・`accountApi.ts` など）は、ログインしている人を `auth.api.getSession({ headers })` で知る。
  - 今の `signedIn`（`src/server/account.ts`）を Better Auth のセッションの読み取りに置き換える。
  - 失効の確かめ（`revokedSoon`・`typle_session_revocations`）はなくす。セッションは DB にあるので、消えたセッションは読めない。
- **セッションの期限**：ログインから 30 日で切れ、延長しない（今と同じ）。Better Auth の `expiresIn` を 30 日にし、`updateAge` で延ばさない設定にする。
- **Cookie のキャッシュ**（`session.cookieCache`）を数分で使う。
  - 「すべての端末からログアウト」のあと、ほかの端末がキャッシュの切れるまで（数分）読めてしまってよいかは、作る人が値を決める。今の実装も、失効の確かめで DB を待つのは 1 秒までで、読めなければ通しています。
  - 5 分を超えないこと。
- **「すべての端末からログアウト」**（`POST /api/account/signout-everywhere`）：そのユーザーのセッションをすべて消し（Better Auth の `revokeSessions`）、このブラウザーの Cookie も消す。今の確かめ（自分の Origin、ログインしていること）は残す。
- **画面のセッションの読み取り**（`src/lib/session.tsx`）：今は Auth.js の `/api/auth/session` を読み、`next-auth/react` の `signIn`・`signOut` を使っている。
  - Better Auth のクライアント（`createAuthClient`）か、`/api/auth/get-session` に置き換える。
  - `useSession`・`signIn`・`signOut`・`signOutEverywhere` の形（画面のコンポーネントが使う API）は変えない。
  - 読み取りが失敗したときにゲストとして使える今の作り（再試行とタイムアウト）も残す。
- **ログイン画面**（`/signin`）と `?error=` の表示は今の画面のまま、Better Auth のエラーにつなぎ直す。

### 4.5 今の安全の決まりで残すもの

- **リダイレクト先**：ログインのあとの戻り先は、このサイトのパスか URL だけにする（今の `redirectCallback`）。Better Auth の `trustedOrigins` と、ログイン開始の `callbackURL` の確かめで同じにする。
- **localhost と 127.0.0.1 の扱い**：手元の開発で `AUTH_URL` が loopback のとき、GitHub と Sparklingstadt ID が正しい URL に戻ってくること（今の `redirectProxyUrl`）。Better Auth の `baseURL` を `AUTH_URL` にすれば足りるかを確かめ、足りなければ同じ動きを作る。
- **`/api/auth/*` の知らないパスは 404**（今の `authPathKnown`）。Better Auth のエンドポイントのうち、使わないものは 404 にする。ID サーバーで、アプリが使わない Better Auth の API を HTTP から 404 にしたのと同じ考え方です。
  - 使うもの：GitHub と Sparklingstadt ID のログインの開始と callback、get-session、sign-out、開発用のログイン。
  - 使うものを許可リストで決める（Claude の判断。ID サーバーの最終レビューで、閉じるものを列挙する方式より許可リストのほうが安全と分かったため）。
- **セキュリティヘッダー**：今の CSP（`tests/contentSecurityPolicy.test.cjs`、`tests/e2e/security-headers.spec.ts`）を壊さない。

### 4.6 切り替え（データ）

利用者は持ち主だけです。移すのは、持ち主のユーザーとログイン方法だけです。

1. Better Auth の表を足すマイグレーション（`npm run db:migrate`。本番は CI の deploy の前に、今と同じ仕組みで当たる。`docs/release-workflow.md` を確かめる）。
2. **データの取り込み**（マイグレーションの SQL の中で行う。手で実行するスクリプトにしない。Claude の判断。typle-r は CI がマージで本番に出すので、手作業の順番に頼らないため）。
   - `typle_workspaces` と `typle_records` にデータがあるアカウント ID ごとに、Better Auth の user を同じ ID で作る。メールアドレスは 4.1 の仮のアドレス、`emailVerified` は true。名前は空でよい。表示名と画像は、ログインのたびにプロフィールから写す（`overrideUserInfoOnSignIn` を使うか、フックで更新する。メールアドレスは写さない）。
   - `github:<番号>` のユーザーには、`providerId: "github"`・`accountId: <番号>` の account を作る。
   - `typle_sid_links` の各行について、ひも付け先のユーザーに `providerId: "sid"`・`accountId: <sub>` の account を作る。
   - `sid:<sub>` のユーザー（ひも付けのない ID）には、`providerId: "sid"`・`accountId: <sub>` の account を作る。
   - 何度実行しても同じ結果になること。
3. 古い表（`typle_session_revocations`・`typle_sid_links`）は、このリリースでは消さない。切り替えを確かめたあとの別の PR で消す。ID サーバーと同じく、元に戻せるようにするため。
4. 切り替えると、今のログイン（Cookie `__Host-typle-session`）はすべて切れる。持ち主はもう一度ログインする。

### 4.7 テスト

- 単体テスト（`tests/*.test.cjs`）のうち、消すコードのもの（`authJwt`・`serverSession`・`authRevocation` の一部、Go の Cookie の fixtures を読むもの）は消すか書き直す。
  - Go の Cookie との互換は目標でなくなるので、`tests/fixtures` の `sessions.json` などで Cookie を読むテストはなくしてよい。
  - ほかの答え（API の JSON など）の fixtures は残す。
- E2E（`tests/e2e/`）：今のログインのテスト（`account.spec.ts`・`sessions.spec.ts`・`sid-login.spec.ts`・`removed.spec.ts` など）を、新しい実装で通す。偽の ID サーバー（`tests/e2e/fakeSid.cjs`）を使う。足すテストは次のとおり。
  - 取り込み済みの DB（`github:` のユーザーと、ひも付けた `sid` の account）で、Sparklingstadt ID でログインすると、同じユーザー（同じデータ）で入る。
  - GitHub でログインしても同じユーザーで入る。ログインの開始で GitHub に向かう URL を確かめるところまでで、偽の GitHub を作るかは作る人が決める。
  - `email_verified` が false の ID は断られる。
  - ログアウトのあとの Sparklingstadt ID のログインに `prompt=login` が付く。
  - 「すべての端末からログアウト」で、別のブラウザーのセッションも切れる。キャッシュの時間のあとに切れることを確かめる。
  - 本番の設定で、開発用のログインと使わない `/api/auth/*` が 404。
  - 取り込みのマイグレーションを 2 回当てても行が増えない。
- `scripts/check-production.cjs`（`npm run check:production`）を Better Auth に合わせて直す。
  - 匿名のセッションが空であること。
  - GitHub のログインの開始が、本番の callback を持って GitHub に向かうこと。
  - Sparklingstadt ID のログインの開始が、ID サーバーに向かうこと。
- `npm run verify` を通す（Docker と Node.js 24 が要るので、持ち主の Mac で行う。CI でも同じものが走る）。

## 5. リリースと切り替え（持ち主が行う）

typle-r は `docs/release-workflow.md` のとおり、PR → CI → マージで本番に出ます（マージ＝本番のデプロイ）。

1. ID サーバーの typle-r の登録は変えない（訂正：callback は今と同じ `/api/auth/callback/sid` のまま。`redirectUris` に足すものはない）。代わりにマージの前に、Vercel と AWS に新しい `BETTER_AUTH_SECRET` を足す。
2. 新しい安定版のバージョン（`npm version`）を付けた PR を作り、`verify` を通す。持ち主の Mac でも `npm run verify` を通す。
3. 持ち主の確認のあとでマージする。CI が、マイグレーション（表と取り込み）、Release、Vercel の本番デプロイ、`check:production` を行う。
4. 持ち主は typle-r で GitHub と Sparklingstadt ID の両方でログインし、今までのデータが見えることを確かめる。
5. 数日様子を見てから、別の PR で古い表（`typle_session_revocations`・`typle_sid_links`）と、使わなくなったコードを消す。ID サーバーの登録は変えていないので、外すものはない（訂正）。Vercel と AWS の `AUTH_SECRET` も、このときに消す。

## 6. 作る人に任せること

- Better Auth の表の名前とカラムの名前（`typle_` の接頭辞と snake_case の範囲で）。
- Cookie のキャッシュの時間（5 分以内）。
- 開発用ログインのプラグインの作り。
- `src/lib/session.tsx` を Better Auth のクライアントで書くか、`fetch` のままにするか（画面のコンポーネントから見た形は変えない）。
- 消すテストと書き直すテストの切り分け。
