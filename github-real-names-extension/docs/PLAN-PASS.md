# План: имена из Fabric Pass вместо `contributors.yaml`

Документ для отдельной сессии. Всё, что нужно для работы, есть здесь; из остального
полезны `HANDOVER.md` (где что лежит) и `PLAN.md` (исходный план расширения, там же
зафиксированы старые решения и их причины). Код в `extension/` самодостаточен и
прокомментирован — читать его всё равно придётся.

Репозиторий с кодом — `extension/` (git, ветка `main`, ~333 теста). Сам этот файл и
`PLAN.md`/`HANDOVER.md` лежат уровнем выше и в git не входят.

---

## 1. Суть изменения

**Сейчас.** Слой `builtin-cf-internal` один раз в 6 часов тянет целиком
`contributors.yaml` из приватного репозитория `constructorfabric/cf-internal` через
`fetch(..., { credentials: 'include' })` в background — авторизация идёт GitHub-кукой
пользователя. Все записи мержатся в `idx: login_key → [display_name, sourceId]`,
который читает content script.

**Станет.** Источником имён становится развёрнутый Fabric Pass (`pass.cfabric.org`).
Пары `github_login + имя` забираются **лениво**: content script сообщает в background
логины, которые встретились на открытой странице и которых нет в `idx`; background
батчит их и спрашивает у pass по **сессионной куке pass** (человек залогинен в pass в
этом же браузере — больше ничего настраивать не нужно). Ответ кладётся в локальный кэш
и попадает в `idx`, content script дорисовывает имена по событию storage.

**Протухание.** На каждом успешном авторизованном ответе pass пишется `lastAuthOkAt`.
Если с него прошло больше `N` дней (по умолчанию 3, задаётся **при сборке**) — кэш pass
стирается целиком. Ручные слои и импортированные файлы при этом не трогаются.

---

## 2. Уже принятые решения — не переоткрывать

| Вопрос | Решение |
| --- | --- |
| Как авторизуемся в pass | Новым эндпоинтом pass по **сессионной куке**, не по Bearer-ключу. Никакого ввода ключей в UI расширения |
| Гранулярность | **Лениво, по логинам со страницы**, батчами. Не выкачиваем весь справочник |
| Старый слой `builtin-cf-internal` | **Выпиливается полностью** вместе с `syncBuiltinSource` и доступом к `cf-internal` |
| Что стирается при протухании | **Только слой pass** (его кэш и записи). `manual` и импортированные файлы не трогаются |
| Браузеры | **Только Chrome и Edge** (Chromium, MV3). Firefox и Safari из проекта уходят — см. фазу 0 |

Осознанный размен, принятый заказчиком: pass видит поток логинов, которые смотрит
пользователь. Смягчение — на стороне pass не логировать query и отдавать `no-store`.

---

## 3. Зависимость: эндпоинт на стороне fabric-pass

Отдельный репозиторий `../fabric-pass`, отдельный PR, заведена идея **IDEA-145**. До
её согласования эндпоинта в проде нет — но **работа по этому плану им не блокируется**:
pass поднимается локально (`npm run dev` в `fabric-pass`, слушает `http://localhost:3000`),
и расширение собирается с `WXT_PASS_ORIGIN=http://localhost:3000`.

Контракт, на который опирается расширение:

```http
GET {PASS_ORIGIN}/api/names?logins=alice,bob,carol
Cookie: contributor_registry_session=...        (кука pass, credentials: 'include')

200 {"names":{"alice":"Alice Smith","carol":"Carol Ng"},"unknown":["bob"]}
400  — параметр logins пуст или длиннее 100 значений
401  — нет сессии pass / за сессией нет строки contributor
```

- ключи в `names` и значения в `unknown` — **в нижнем регистре**, как `login_key` в
  расширении. Регистр присланных логинов сервер игнорирует;
- отдаются только `status = 'confirmed'` с непустым `name`. Всё остальное попадает в
  `unknown`. Никаких других полей — ни email, ни company, ни треков;
- `Cache-Control: no-store`.

`401` — это **не** ошибка в смысле UI: человек просто не залогинен в pass. Кэш при этом
не трогается (стирает его только возраст, см. фазу 3).

---

## 4. Фазы

Фазы идут по порядку; каждая — отдельный коммит (или несколько), `npm run check`
(`tsc --noEmit` + eslint + vitest) должен быть зелёным на каждой.

### Фаза 0 — выпилить неподдерживаемые браузеры

Делается **первой**, чтобы дальше не тащить MV2-ветку в конфиге и не писать под неё
код и тесты. Firefox и Safari объявлены вне поддержки; целевая платформа — Chromium
(Chrome, Edge), Manifest V3.

Что убрать:

- `package.json` — скрипты `dev:firefox`, `build:firefox`, `zip:firefox`, `package:all`;
- `wxt.config.ts` — ветку `env.manifestVersion === 2` с `optional_permissions`; `manifest`
  может остаться функцией (в фазе 1 в него придёт origin из env), но MV2-развилки в нём
  больше нет;
- `web-ext.config.ts` — если он нужен только firefox-профилю, удалить; если им поднимается
  и Chromium-профиль (`.dev-profile/chromium`), оставить только эту часть;
- `.github/workflows/release.yml` — шаг «Build Firefox zip», упоминания `*-firefox.zip` и
  `*-sources.zip` в теле релиза;
- `extension/README.md` — разделы про Firefox, «Load Temporary Add-on», подпись AMO,
  `...-sources.zip`; в списке установки остаётся один архив;
- `docs/HANDOVER.md` и `tests/options-sources.test.ts` — оставшиеся упоминания firefox/MV2
  (`grep -rn 'firefox\|Firefox\|MV2\|manifestVersion\|AMO'` по `src`, `tests`, `docs`,
  `*.md`, `*.ts`, `*.json`, `.github` без `node_modules`/`.output`/`.wxt`/`.dev-profile`).

**Приёмка.** `grep` выше не находит ничего, кроме исторических упоминаний в `PLAN.md`
уровнем выше (он вне репозитория, не трогать). `npm run build` и `npm run zip` работают,
`npm run check` зелёный.

### Фаза 1 — конфигурация сборки

Новый файл `src/core/config.ts` — единственное место, где читается `import.meta.env`:

```ts
export const PASS_ORIGIN: string            // WXT_PASS_ORIGIN, дефолт 'https://pass.cfabric.org'
export const PASS_MAX_CACHE_AGE_MS: number  // WXT_PASS_MAX_CACHE_AGE_DAYS, дефолт 3
export const PASS_ENTRY_TTL_MS: number      // WXT_PASS_ENTRY_TTL_HOURS, дефолт 24
export const PASS_MISS_TTL_MS: number       // WXT_PASS_MISS_TTL_HOURS, дефолт 24
export const PASS_BATCH_SIZE = 100          // совпадает с лимитом эндпоинта
export const PASS_MAX_BATCHES_PER_REQUEST = 3
export const PASS_MIN_NETWORK_INTERVAL_MS = 1000
```

- WXT отдаёт в `import.meta.env` только переменные с префиксом `WXT_` (или `VITE_`);
  значения подставляются **в момент сборки**, менять их в рантайме нельзя — это ровно то,
  что требовалось («настраивается при билде»);
- каждое значение проходит через хелпер, который отбрасывает мусор (`NaN`, `<= 0`) в пользу
  дефолта: сборка без `.env` обязана работать;
- `.env.example` в `extension/` со всеми четырьмя переменными и комментариями; `.env` — в
  `.gitignore` (секретов там нет, но у каждого своя локальная настройка);
- типы: объявить `ImportMetaEnv`/`ImportMeta` в `src/env.d.ts` (или дополнить существующее
  объявление), иначе `tsc` не пропустит.

**`wxt.config.ts` должен брать origin из той же переменной**, иначе сборка с нестандартным
origin окажется без host-permission:

```ts
const passOrigin = process.env.WXT_PASS_ORIGIN ?? 'https://pass.cfabric.org'
// permissions: ['storage', 'alarms']
// host_permissions: [`${new URL(passOrigin).origin}/*`]
```

`https://github.com/*` и `https://raw.githubusercontent.com/*` из `host_permissions`
уходят: после выпиливания `syncBuiltinSource` сетевых запросов к GitHub не остаётся, а
content script работает по своему `matches: ['https://github.com/*']`, которому
host-permission не нужен.

> **Поправка (0.3.1).** `https://github.com/*` пришлось вернуть в `host_permissions`.
> Сеть тут ни при чём: без host-permission (или широкого `tabs`) Chrome не отдаёт `url`
> в `tabs.query`, попап видел `tab.url === undefined` и на любой странице, включая
> github.com, показывал «работает только на github.com». Лишнего предупреждения при
> установке это не добавляет — тот же матч уже объявлен content script'ом. `optional_host_permissions: ['*://*/*']` остаётся — на нём
живёт URL-источник (T9).

**Приёмка.** Тест на `config.ts`: дефолты при пустом env, отбрасывание мусорных значений.
`npm run build` даёт манифест с `alarms` и ровно одним host-permission на pass.

### Фаза 2 — хранилище: слой pass, кэш, миграция схемы

`src/core/types.ts`:

```ts
export type SourceKind = 'yaml' | 'json' | 'csv' | 'url' | 'manual' | 'pass'   // 'builtin' убран
export const PASS_SOURCE_ID = 'pass'                                           // BUILTIN_SOURCE_ID/URL убраны

/** never — ни одного запроса ещё не было; unauthenticated — pass ответил 401;
 *  expired — кэш стёрт по возрасту (см. sweepExpired). */
export type PassStatus = 'never' | 'ok' | 'unauthenticated' | 'network-error' | 'expired'

/** name: null — pass этот логин не знает (негативный кэш). */
export interface PassCacheEntry { name: string | null; fetchedAt: string }
export type PassCache = Record<string, PassCacheEntry>   // ключ — login_key (нижний регистр)

export interface PassMeta {
  /** ISO 8601, последний УСПЕШНЫЙ авторизованный ответ pass. Именно он гасит кэш по возрасту. */
  lastAuthOkAt?: string
  lastStatus: PassStatus
  lastError?: string
}

export const SCHEMA_VERSION = 2
```

`STORAGE_KEYS` получает `passCache` и `passMeta` отдельными ключами верхнего уровня —
по той же причине, по которой ключи уже разделены: content script читает только `idx` и
`settings` и не должен вытаскивать кэш целиком.

**Источник правды — `passCache`**; `records[PASS_SOURCE_ID]` это его **проекция**:
позитивные записи прогоняются через `resolveRecords` из `core/resolve.ts`
(`RawRecord { github_login, name, _index }`), чтобы имя прошло ту же нормализацию
(Title Case) и те же отсевы (`name_equals_login`), что и любой другой источник. Один
хелпер `projectPassCache(cache): Contributor[]` — и дальше обычный `upsertSource` +
`rebuildIndex`, вся слоевая машинерия (приоритеты, конфликты, инспектор) работает без
изменений.

Миграция `MIGRATIONS[0]` (1 → 2), сегодня массив пуст:

1. удалить источник `builtin-cf-internal` и его записи из `records`;
2. добавить слой `pass` (`kind: 'pass'`, `enabled: true`, label из i18n) на то же место в
   порядке приоритетов, где стоял старый слой;
3. завести `passCache = {}` и `passMeta = { lastStatus: 'never' }`;
4. `manual` и все пользовательские слои не трогать;
5. после миграции `idx` пересобрать (`rebuildIndex`) — иначе в нём останутся имена из
   удалённого слоя.

`removeSource`/`upsertSource`: защита «неудаляемого слоя» переносится с `BUILTIN_SOURCE_ID`
на `PASS_SOURCE_ID` — слой pass можно только выключить.

**Приёмка.** Тесты в `tests/store.test.ts`: состояние схемы 1 со слоем `builtin-cf-internal`
и парой ручных правок после миграции содержит пустой слой `pass`, сохранённые ручные
правки и `idx` без записей старого слоя. Слой `pass` не удаляется через `removeSource`.

### Фаза 3 — background: резолвер, батчи, протухание

Новый файл `src/entrypoints/background/pass.ts` — вся логика; `background/index.ts`
остаётся тонким (регистрация слушателей).

```ts
export async function resolveLogins(logins: string[]): Promise<{ status: PassStatus; resolved: number }>
export async function sweepExpired(): Promise<boolean>   // true, если кэш стёрли
export async function clearPassCache(reason: 'expired' | 'manual'): Promise<void>
```

`sweepExpired()`: если `passMeta.lastAuthOkAt` отсутствует, а кэш непуст, **или** с
`lastAuthOkAt` прошло больше `PASS_MAX_CACHE_AGE_MS` — `passCache = {}`,
`records[PASS_SOURCE_ID] = []`, `rebuildIndex()`, `lastStatus = 'expired'`. `lastAuthOkAt`
при этом **не** обнуляется (UI показывает, когда человек последний раз был в pass).

`resolveLogins(logins)`:

1. `await sweepExpired()` — до всего остального;
2. отобрать те, которых нет в `passCache`, плюс просроченные записи (позитивная —
   старше `PASS_ENTRY_TTL_MS`, негативная — старше `PASS_MISS_TTL_MS`);
3. отбросить те, что уже в полёте (модульный `Set<login_key>` — две вкладки не должны
   спрашивать одно и то же);
4. нарезать по `PASS_BATCH_SIZE`, но не больше `PASS_MAX_BATCHES_PER_REQUEST` за вызов —
   остаток подхватится следующей страницей. Между сетевыми вызовами выдерживать
   `PASS_MIN_NETWORK_INTERVAL_MS`;
5. `fetch(`${PASS_ORIGIN}/api/names?logins=…`, { credentials: 'include', cache: 'no-store', signal })`
   с существующим `FETCH_TIMEOUT_MS` (15 с) и `AbortController`;
6. разбор ответа:
   - **200** — `names` кладутся как `{ name, fetchedAt: now }`, `unknown` как
     `{ name: null, fetchedAt: now }`; `lastAuthOkAt = now`, `lastStatus = 'ok'`;
     пересобрать проекцию слоя и `idx`;
   - **401** — `lastStatus = 'unauthenticated'`, кэш **не трогать**, сеть больше не дёргать
     до следующего запроса от content script;
   - **прочее / сетевая ошибка / таймаут** — `lastStatus = 'network-error'` + текст через
     существующий `formatFetchError`, кэш не трогать.

Никогда не стирать кэш из-за 401 или сетевой ошибки: единственная причина стереть — возраст.

`background/index.ts`:

- `onInstalled` / `onStartup` → `initializeIfNeeded()` + `sweepExpired()` (не `resolveLogins`:
  на старте нечего резолвить);
- `browser.alarms.create('ghname:pass-sweep', { periodInMinutes: 60 })` и слушатель →
  `sweepExpired()`. Разрешение `alarms` добавлено в фазе 1. Без будильника протухший кэш
  просто не использовался бы, но физически оставался в storage — а требование именно
  «кэш исчезает»;
- обработка новых сообщений (фаза 4), `syncBuiltinSource` и `ghname:sync-builtin` удалены.

**Приёмка.** Новый `tests/background-pass-resolve.test.ts` вместо
`tests/background-builtin-sync.test.ts`: батчинг и нарезка; негативный кэш (второй запрос
того же неизвестного логина не идёт в сеть); дедупликация одновременных вызовов; 401 не
стирает кэш; сетевая ошибка не стирает кэш; `sweepExpired` стирает ровно слой pass и
оставляет `manual`; `sweepExpired` ничего не делает, когда `lastAuthOkAt` свежий.

### Фаза 4 — content script

`src/core/messages.ts`: `SyncBuiltinSourceRequest`/`BuiltinSyncResult` удаляются, добавляются

```ts
{ type: 'ghname:resolve-logins', logins: string[] } → { status: PassStatus; resolved: number }
{ type: 'ghname:pass-status' }                      → PassMeta & { cachedNames: number }
{ type: 'ghname:clear-pass-cache' }                 → { ok: true }
```

с такими же type-guard'ами, как у существующих сообщений.

`src/entrypoints/content/index.ts`:

- **поменять условие раннего выхода.** Сейчас пустой `idx` означает «расширение инертно»;
  при ленивой загрузке пустой `idx` — это нормальное холодное состояние. Выходить рано
  теперь следует только при `settings.enabled === false`; при выключенном слое pass
  (`enabled: false` в Sources) — не спрашивать pass, но продолжать рисовать из остальных
  слоёв;
- после `scanAndDecorate` собрать логины, которых нет в `idx` (`collectLogins` уже умеет
  обходить светлый DOM и открытые shadow root), вычесть те, что уже спрашивались в этой
  вкладке (локальный `Set`, защита от шторма `MutationObserver`), задебаунсить ~300 мс и
  отправить `ghname:resolve-logins`;
- дорисовка не требует ответа: background пишет в storage, а подписка `onStateChanged` на
  `idx` уже вызывает `redecorateAll` — этот путь трогать не нужно.

**Приёмка.** `tests/content.test.ts`: со страницы с незнакомыми логинами уходит ровно одно
сообщение с уникальными логинами; повторный прогон `MutationObserver` по той же странице
второго сообщения не шлёт; при `settings.enabled === false` сообщений нет; после записи
имён в `idx` страница перерисовывается.

### Фаза 5 — UI и i18n

`SourcesTab.tsx` / `SettingsTab.tsx` / `popup`:

- строка слоя `builtin` заменяется строкой слоя **Fabric Pass**: сколько имён в кэше,
  когда был последний успешный ответ, и статус человеческим языком —
  `никогда не подключались` / `ok` / `вы не залогинены в Fabric Pass` (плюс кнопка
  «Открыть Fabric Pass» — `browser.tabs.create({ url: PASS_ORIGIN })`) / `ошибка сети` /
  `кэш очищен: вы не заходили в pass больше N дней`;
- кнопка «Обновить built-in» заменяется на «Очистить кэш» (`ghname:clear-pass-cache`):
  после очистки имена натекут заново при следующем визите на GitHub;
- строки в `public/_locales/en/messages.json` и `public/_locales/ru/messages.json`
  (обе локали обязательны, ключи старого слоя удалить), доступ через существующий
  `core/i18n.ts`.

**Приёмка.** `tests/options-sources.test.ts` и `tests/popup-logic.test.ts` обновлены,
`tests/i18n.test.ts` не находит ни потерянных, ни лишних ключей.

### Фаза 6 — документация и релиз

- `extension/README.md`: раздел «откуда берутся данные» — вместо `contributors.yaml` из
  `cf-internal` описать Fabric Pass, требование быть залогиненным, ленивую загрузку, что
  хранится локально (**только пара логин + имя**) и правило про N дней. Плюс переменные
  сборки из `.env.example`;
- `docs/HANDOVER.md`: что изменилось и почему (кука вместо Bearer, лениво вместо
  выкачивания справочника, Chromium-only);
- версия в `package.json` + тег: релизный workflow уже проверяет их совпадение.

---

## 5. Тест-план целиком

Минимум, ниже которого фаза не считается сделанной:

| Область | Проверяем |
| --- | --- |
| `config.ts` | дефолты без env; мусорные значения не ломают сборку |
| миграция 1→2 | старый слой удалён, ручные правки целы, `idx` пересобран |
| резолвер | батчи, дедуп, негативный кэш, 401, сетевая ошибка, таймаут |
| протухание | стирается только pass; свежий `lastAuthOkAt` — no-op; будильник зовёт sweep |
| content script | одно сообщение на страницу, уважает `enabled`, перерисовка по storage |
| UI/i18n | все статусы отрисовываются, обе локали полные |

Прогон: `npm run check` в `extension/`.

## 6. Риски и ручная проверка

1. **Дойдёт ли кука pass до запроса из background.** В Chromium запрос из background при
   наличии host-permission считается same-site, `SameSite=Lax` кука уходит — на этом уже
   работал старый sync с GitHub. Проверить **руками в Edge на первом же рабочем
   эндпоинте** (фаза 3): залогиниться в pass, открыть страницу GitHub, убедиться, что
   `/api/names` вернул 200, а не 401. Если вдруг 401 при живой сессии — не городить
   обходные пути молча, а остановиться и сообщить: лечится на стороне pass отдельной
   read-only кукой `SameSite=None; Secure`, и это меняет контракт.
2. **Шторм запросов.** Лента коммитов с сотнями авторов + `MutationObserver`. Защиты:
   локальный `Set` во вкладке, негативный кэш, `PASS_MAX_BATCHES_PER_REQUEST`,
   `PASS_MIN_NETWORK_INTERVAL_MS`. Проверить руками на `/commits/main` большого репозитория:
   в Network должно быть единицы запросов, не десятки.
3. **Пустой холодный старт.** Свежая установка + не залогинен в pass = имён нет вообще
   (старого yaml больше нет). UI обязан объяснять это словами, иначе выглядит как поломка.
4. **Локальный pass.** `WXT_PASS_ORIGIN=http://localhost:3000` — не забыть, что
   `host_permissions` берётся из той же переменной (фаза 1), иначе запросы молча падают.

## 7. Чек-лист готовности

- [ ] Ф0: firefox/MV2/AMO не упоминаются в репозитории; сборка и релиз чинятся под Chromium
- [ ] Ф1: `core/config.ts` + `.env.example`; манифест с `alarms` и одним host-permission
- [ ] Ф2: схема 2, слой `pass`, миграция с сохранением ручных слоёв
- [ ] Ф3: резолвер с батчами, негативным кэшем и протуханием; будильник раз в час
- [ ] Ф4: content script шлёт недостающие логины и не штормит
- [ ] Ф5: статусы слоя pass в UI, обе локали
- [ ] Ф6: README и HANDOVER описывают новую модель данных
- [ ] `npm run check` зелёный; ручная проверка из раздела 6 пройдена в Edge
