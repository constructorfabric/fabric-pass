# PRD: GitHub Real Names Browser Extension

## Goal

Создать browser extension, который показывает реальное имя человека рядом с его GitHub username на страницах GitHub.

Расширение работает на локально загруженном mapping. Первичный источник данных — реестр контрибьюторов Constructor Fabric `cf-internal/pass/contributors.yaml`; дополнительно поддерживаются упрощённые JSON и CSV.

Минимальный логический mapping:

```json
{
  "anatolyb": "Anatoly Bobrov",
  "jdoe123": "John Doe"
}
```

## Supported Browsers

* Chrome
* Firefox
* Edge
* другие Chromium-based browsers

Желательно использовать единый WebExtension codebase.

## Core Use Cases

Если GitHub username присутствует в локальном mapping, рядом должно отображаться реальное имя.

Пример:

```text
anatolyb · Anatoly Bobrov
```

Поддержать отображение в:

* issue / PR comments
* issue / PR author
* assignees
* reviewers
* mentions
* issue / PR lists
* commit authors

GitHub username не должен заменяться — только дополняться реальным именем.

## Data Model

Внутренняя модель одной записи (superset всех поддерживаемых форматов импорта):

| Поле | Тип | Назначение |
| --- | --- | --- |
| `github_login` | string | ключ сопоставления с DOM (case-insensitive) |
| `github_id` | string | стабильный идентификатор, ключ для алиасов |
| `display_name` | string | вычисляемое реальное имя для показа |
| `company` | string \| null | для tooltip / будущих режимов отображения |
| `email` | string \| null | для tooltip |
| `discord_username`, `telegram_username` | string \| null | для tooltip |
| `is_agent`, `is_admin` | boolean | признаки бота / админа, для бейджей |
| `alias_of_github_id` | string \| null | ссылка на каноническую запись человека |
| `status` | `confirmed` \| `draft` | качество записи |

Все поля кроме `github_login` и `display_name` опциональны — упрощённый JSON/CSV импорт заполняет только их.

## Mapping Import

Extension должен позволять импортировать mapping из:

* **YAML в формате `contributors.yaml`** (основной формат)
* JSON
* CSV

После импорта данные сохраняются в browser local storage.

Никакие данные не должны отправляться на внешний сервер.

### Формат `contributors.yaml`

Файл содержит один top-level ключ `contributors` со списком записей. Реальный пример записи:

```yaml
contributors:
  - id: 174cca72-36f7-44d1-9a1c-ad84f7816710
    github_id: "301748190"
    github_login: AndrejK666
    github_name: ANDREI KUCHMA
    github_email: null
    telegram_id: null
    telegram_username: null
    telegram_phone: null
    telegram_name: null
    discord_id: "1523978701161627769"
    discord_username: andrejkuchma_56660
    discord_name: Andrej Kuchma
    linkedin_id: null
    linkedin_name: null
    name: Andrej
    email: Andrej.Kuchma@constructor.tech
    email_confirmed_at: 2026-08-03T09:34:40.656Z
    company: Constructor tech
    status: confirmed
    alias_of_github_id: null
    is_agent: false
    is_admin: false
    profile_completeness: ready
    created_at: 2026-08-03T09:33:22.475Z
    updated_at: 2026-09-06T22:43:08.838Z
```

Значимые свойства формата, которые парсер обязан учитывать:

* Ключ сопоставления с GitHub UI — `github_login`; он заполнен всегда.
* `github_name` **не является** источником реального имени: в текущем реестре из 74 записей оно `null` в 34 случаях, а ещё примерно в трети случаев содержит никнейм (`Artifizer`, `Bit Flip`, `Entropy Shift`, `MikeY`). Каноническое человеческое имя лежит в поле `name`.
* Пустые значения приходят как YAML `null`, а не как отсутствующий ключ или пустая строка.
* `github_id` — строка в кавычках, не число; не приводить к number (потеря ведущих нулей и точности не нужна, но сравнение должно быть строковым).
* Даты — ISO 8601 UTC; extension их не интерпретирует, кроме показа «дата экспорта реестра», если она доступна.
* `alias_of_github_id` — вторичный аккаунт того же человека; в текущем реестре одна такая запись.
* Поля `id`, `email_confirmed_at`, `created_at`, `updated_at`, `profile_completeness`, `linkedin_*`, `telegram_phone` extension не использует, но парсер обязан их молча игнорировать, а не падать.
* Реестр может содержать записи со `status: draft` — их по умолчанию не показывать.

### Правила вычисления `display_name`

Приоритет источников имени:

1. `name`
2. `github_name`
3. `discord_name`
4. `telegram_name`
5. `linkedin_name`

Дополнительные правила:

* Если ни одно поле не заполнено — запись пропускается.
* Если вычисленное имя после нормализации (lowercase, удаление пробелов, `.`, `_`, `-`) совпадает с `github_login`, имя не показывается: оно не несёт информации (например `ktursunov` → `KTursunov`, `Artifizer` → `Artifizer` при отсутствии `name`).
* Имена в верхнем регистре (`ANDREI ILIUSHIN`, `OLEKSII SHPONARSKYI`) приводить к Title Case для отображения; исходное значение сохранять.
* Если `alias_of_github_id` заполнен и указывает на существующую запись, показывать имя канонической записи. Если целевой записи нет — использовать собственное имя алиаса.
* Записи с `status: draft` по умолчанию не отображаются (переключатель в Settings).
* Записи с `is_agent: true` помечаются как бот/агент и по умолчанию не получают реальное имя.

### Упрощённые форматы

JSON — плоский объект `login → имя` либо массив объектов с полями из Data Model:

```json
{
  "anatolyb": "Anatoly Bobrov",
  "jdoe123": "John Doe"
}
```

CSV — обязательные колонки `github` (или `github_login`) и `real_name` (или `name`); прочие колонки, совпадающие с полями Data Model, подхватываются:

```csv
github,real_name
anatolyb,Anatoly Bobrov
jdoe123,John Doe
```

## UI

Минимальная Settings page:

* Import YAML / JSON / CSV (формат определяется по расширению и содержимому)
* количество загруженных mappings
* количество пропущенных записей с причинами (нет имени, имя совпадает с логином, `draft`, `is_agent`)
* дата последнего импорта
* очистить mapping

Опционально:

* выбрать формат отображения:

  * `username · Real Name`
  * `Real Name [username]`
  * `username (Real Name)`
* показывать/скрывать записи со `status: draft`
* показывать бейдж для `is_admin` / `is_agent`

## GitHub Integration

Extension должен работать через content script на:

```text
https://github.com/*
```

Требования:

* находить GitHub usernames в DOM
* сопоставлять их с `github_login` без учёта регистра
* добавлять real name рядом
* избегать повторного добавления имени
* поддерживать динамически загружаемый GitHub UI через `MutationObserver`
* не использовать GitHub API

## Non-Functional Requirements

* TypeScript
* желательно WXT/WebExtensions
* без backend
* без GitHub token
* минимальные browser permissions
* mapping хранится только локально
* YAML-парсинг выполняется локально, встроенной библиотекой; текущий реестр — 74 записи / ~1850 строк, парсинг не должен блокировать UI
* нормальная работа с mapping размером минимум 10 000 пользователей
* импорт файла с неизвестными или лишними полями не должен приводить к ошибке

## Future Scope

Не входит в MVP, но архитектура должна позволять добавить:

* GitLab
* Bitbucket
* автоматическую синхронизацию `contributors.yaml` с локальным/internal HTTP endpoint или git-репозиторием
* дополнительные поля: team, department, role
* hover tooltip с расширенной информацией — company, email, Discord, Telegram
