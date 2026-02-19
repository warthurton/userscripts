# TweetXer Analysis

Security review and technical notes for `tweetXer.js` (v0.9.4).

---

## GraphQL Query IDs

The path segments in the API URLs are Twitter's internal **GraphQL operation IDs** (queryIds), baked into Twitter's own JavaScript bundles. They change whenever Twitter redeploys their frontend, which is why this script breaks periodically.

| Constant | queryId | Operation |
|---|---|---|
| `deleteURL` | `VaenaVgh5q5ih7kvyVjgtg` | DeleteTweet |
| `unfavURL` | `ZYKSe-w7KEslx3JhSIk5LA` | UnfavoriteTweet |
| `deleteMessageURL` | `BJ6DtxA2llfjnRoRjaiIiw` | DMMessageDeleteMutation |
| `bookmarksURL` | `L7vvM2UluPgWOW4GDvWyvw` | Bookmarks |

---

## The Bearer Token

```
Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA
```

This is **Twitter's public app-level token** embedded in their own web JS bundle. It:
- Is the **same for every user** — identifies the Twitter web app, not a specific account
- Has been publicly known for years in the API reverse-engineering community
- Is not your session credential — actual user auth comes from session cookies (`auth_token`) + the `ct0` CSRF token

It's not a secret, but Twitter could rotate it and break the script.

---

## What's Hardcoded vs. Dynamic

The script already reads several values dynamically:

| Value | Source | How |
|---|---|---|
| `ct0` CSRF token | Cookies | `getCookie('ct0')` (line 52) |
| Session cookies | Browser | `credentials: "include"` on all fetches |
| `username` | URL | `document.location.href.split('/')[3]` (line 53) |
| `transaction_id` | Generated | Random string via `crypto.getRandomValues` |

**What could be made dynamic but isn't:**
- **Bearer token** — Twitter sends it in every API request it makes. It could be captured by monkey-patching `fetch` with `@run-at document-start`, or possibly read from global config objects like `window.__NEXT_DATA__`.
- **GraphQL query IDs** — Could be intercepted from Twitter's own outgoing GraphQL requests as they happen (e.g., the queryId for UnfavoriteTweet appears in network traffic whenever the page unfavorites something).

Making these dynamic would eliminate the maintenance burden of updating them after Twitter deploys new frontend code.

---

## Security Issues

### 1. XSS risk via `innerHTML` (line 200–205)
```js
const h2Class = document.querySelectorAll("h2")[1]?.getAttribute("class") || ""
div.innerHTML = `...<h2 class="${h2Class}"...`
```
A class attribute value from Twitter's DOM flows unsanitized into `innerHTML`. Low practical risk since it reads from Twitter's own page, but should use `createElement`/`setAttribute` instead of string interpolation into innerHTML.

### 2. Broken rate-limit check in `exportBookmarks` (line 303)
```js
if (!response.headers.get('x-rate-limit-remaining') && response.headers.get('x-rate-limit-remaining') < 1)
```
The leading `!` inverts the null check — rate limiting in bookmark export is **silently never triggered**. Should be `!=` null.

### 3. JSON built via template literals instead of `JSON.stringify` (line 328)
```js
body = `{\"variables\":{\"tweet_id\":\"${TweetsXer.tId}\",\"dark_request\":false},...}`
```
Tweet IDs are numeric so injection is low risk, but string interpolation into JSON is fragile. Should use `JSON.stringify()`.

### 4. Implicit global variables
- `url` in `deleteConvos` (line 437) — missing `let`/`const`, creates `window.url`
- `body` in `deleteDMs` (line 427) — `body = \`...\`` is a bare assignment expression used as an argument, not a named parameter. Works by accident.

### 5. `waitForElemToExist` never times out (line 669)
If Twitter changes a `data-testid` and an element never appears, the `MutationObserver` leaks forever with no timeout or cleanup path.

### 6. `deleteConvoURL` uses placeholder text (line 35)
```js
deleteConvoURL: '/i/api/1.1/dm/conversation/USER_ID-CONVERSATION_ID/delete.json'
```
Replaced at call time via `.replace()`. If `this.tId` is empty or malformed, the request goes to a garbage URL rather than failing safely.
