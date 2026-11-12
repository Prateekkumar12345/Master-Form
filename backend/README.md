# ProfeNtra Backend (FastAPI)

FastAPI service implementing the master-form API against MongoDB. The async
MongoDB client is created once for the application lifespan and reused for
requests.

## Setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload
```

The default connection targets MongoDB at `mongodb://localhost:27017`, database
`Profentra`, collection `Master_Forms`. Set `MONGODB_URL`, `MONGODB_DATABASE`,
`MONGODB_COLLECTION`, or `MONGODB_VALUE_SETS_COLLECTION` in `.env` to override
these local-development defaults. Controlled codes are stored in the separate
`value_sets` collection.
MongoDB must be running before the API starts; startup pings the server and
creates the collection indexes.

Interactive API reference: <http://127.0.0.1:8000/docs>

Health check: <http://127.0.0.1:8000/api/v1/health>

## Master-form endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/master-forms` | Create form and initial version |
| GET | `/api/v1/master-forms/{masterFormId}` | Retrieve one form; optional versions and soft-deleted forms |
| GET | `/api/v1/master-forms` | List forms with filters, pagination, and optional soft-deleted forms |
| PATCH | `/api/v1/master-forms/{masterFormId}` | Update current or selected version, or change status |
| GET | `/api/v1/master-forms/{masterFormId}/versions` | Retrieve version history, or one version with `?masterFormVersionId=`; `includeDeleted=true` includes deleted snapshots. History stays readable after the form is soft-deleted |
| PATCH | `/api/v1/master-forms/{masterFormId}/versions/{masterFormVersionId}` | Set a saved version to `PUBLISHED`, `ARCHIVED`, or `DRAFT`. Publishing a saved draft on a DRAFT or ARCHIVED form also makes the form `PUBLISHED` |
| DELETE | `/api/v1/master-forms/{masterFormId}/versions/{masterFormVersionId}` | Soft-delete an archived version. On an archived form the active version can be deleted when another version remains; the highest remaining version becomes active. The master form stays in the library |
| POST | `/api/v1/master-forms/{masterFormId}/versions/{masterFormVersionId}/restore` | Restore a deleted version in any form status without making it active |
| DELETE | `/api/v1/master-forms/{masterFormId}` | Soft-delete an archived form |
| POST | `/api/v1/master-forms/{masterFormId}/restore` | Restore a soft-deleted form |
| POST | `/api/v1/assessments/submit` | Store an assessment form submission |
| POST | `/api/v1/clients` | Register a client from the stored registration form |
| POST | `/api/v1/diet-plans/generate` | Queue a diet-plan generation request |
| POST | `/api/v1/auth/login` | Stored login form route; returns 501 until authentication is configured |

Endpoint descriptions, parameter help, schemas, and developer metadata are
available in Swagger UI (`/docs`). Successful responses use
`{ "success": true, "message", "data", "meta" }`; errors use
`{ "success": false, "error", "meta": null }`. The `message` field carries the
standard success message for the HTTP status code (for example, 200, 201, or
202) and can be endpoint-specific.
When creating a form, provide a unique `formCode`; the frontend does not
generate one. The backend sets `documentType` to `MASTER_FORM`.

Soft-deleted forms are excluded by default. On the list endpoint, use
`?isDeleted=true` to return only soft-deleted forms or `?includeDeleted=true`
to return both deleted and non-deleted forms. On the by-ID endpoint, use
`?includeDeleted=true` to retrieve a soft-deleted form.

In Swagger UI, form-action groups are named only with the form type
(`ASSESSMENT`, `REGISTRATION`, `DIET_PLAN`, or `LOGIN`), and each operation
name starts with its form type.

These four form-action routes correspond to API button paths stored in
`Master_Forms`. Registration, assessment, and diet-plan requests are persisted
to `Clients`, `Assessments`, and `Diet_Plans` respectively; their collection
names can be overridden with `MONGODB_CLIENTS_COLLECTION`,
`MONGODB_ASSESSMENTS_COLLECTION`, and `MONGODB_DIET_PLANS_COLLECTION`.
Diet-plan requests remain pending because generation logic is not configured.
The login path is exposed for the stored form but does not authenticate or
persist credentials.

A button's `responseHandling.onSuccess.responseMessage` and
`responseHandling.onFailure.responseMessage` store a **response path**
(keyholder) into the response body, not a literal message. The sample forms use
`message` for success and `error.message` for failure, so the text shown to the
person filling the form comes from the standard envelope: `message` on a
`{ "success": true, ... }` response and `error.message` on a
`{ "success": false, "error": { ... } }` response.

### Testing and authentication

Mutations read their audit actor from `DEFAULT_ACTOR_ID` in the backend
configuration (`.env`); it is not an endpoint parameter, request header, or
request-body field. Set it to the relevant 24-character user ObjectId. The
default in `.env.example` is for local development only and is not
authentication or authorization. Authentication, permission enforcement, and
organization access restrictions are not available in the existing project
and must be integrated before deployment. Read and list operations currently
return any non-deleted matching records.

Example request:

```powershell
curl.exe -X POST http://127.0.0.1:8000/api/v1/master-forms `
  -H "Content-Type: application/json" `
  -d "{\"formCode\":\"NUTRITION_ASSESSMENT\",\"name\":\"Nutrition Assessment\",\"formType\":\"ASSESSMENT\",\"title\":\"Nutrition Assessment\",\"layout\":\"WIZARD\",\"Buttons\":[],\"sections\":[]}"
```

`PATCH /api/v1/master-forms/{masterFormId}` handles current-definition edits,
saved-version edits, and lifecycle transitions. Send either `status` alone or
configuration properties. To edit a saved snapshot, include its
`masterFormVersionId` with the configuration properties to change.

Current-definition changes on DRAFT forms atomically increment `currentVersion`
and store a full immutable snapshot; no-op updates do not create versions. A
configuration update on a PUBLISHED form creates a new inactive DRAFT version
without changing the active published definition.
Saved-version edits start from the selected snapshot, preserve it, and create a
new version. The new version becomes active for DRAFT forms. On PUBLISHED forms,
only a non-active version can be edited; the new version remains inactive so
the published definition does not change. Reopen an ARCHIVED form as DRAFT
before editing. The active published version cannot be edited directly.
`currentVersion` is the active-version marker. Version-history operations verify
that it identifies exactly one saved snapshot, and reject inconsistent history
with `409 MASTER_FORM_ACTIVE_VERSION_REQUIRED`.

Status transitions:

| From | To | Behavior |
|---|---|---|
| DRAFT | PUBLISHED | Validate and publish the active version; no new version |
| DRAFT | ARCHIVED | Archive the form; no new version |
| PUBLISHED | ARCHIVED | Archive the active published version; no replacement version is required |
| PUBLISHED | DRAFT | Reopen a selected saved version for editing; no new version |
| ARCHIVED | DRAFT | Reopen for editing; no new version |
| ARCHIVED | PUBLISHED | Not allowed through the form endpoint; publish a saved version to make the form PUBLISHED |

A PUBLISHED form can be archived directly by calling
`PATCH /api/v1/master-forms/{masterFormId}` with `{"status":"ARCHIVED"}`.
The currently active published version is archived with the form; no
replacement version is required. For compatibility, an optional
`masterFormVersionId` is accepted only when it identifies that active version.
When reopening a PUBLISHED form with multiple versions as DRAFT, include
`masterFormVersionId` to select which saved snapshot becomes the active draft.
The previously published snapshot remains unchanged in history. If there is
only one saved version, the selector is optional. Requesting the status a form
already holds returns 409. Version history is read
from `GET /api/v1/master-forms/{masterFormId}/versions`: pass
`?masterFormVersionId=<ObjectId>` to return one snapshot, or use the `version`
number filter with `sortOrder`, `page`, and `limit` to page through the history.
Update a saved version with
`PATCH /api/v1/master-forms/{masterFormId}/versions/{masterFormVersionId}`
and a `status` body. `PUBLISHED` activates the selected saved version on a DRAFT, PUBLISHED, or ARCHIVED
form, making the parent form PUBLISHED and the previous active version DRAFT.
`ARCHIVED` archives
only an inactive version, and `DRAFT` moves an archived inactive version back
to DRAFT; neither changes the parent form's status or active version. The
active version is managed through the master-form lifecycle.

Deleting a historical version requires it to be archived first; the master form
stays in the form library with its current definition, and other versions are
unchanged. The snapshot is soft-deleted without renumbering the rest, so it can
be restored later. The active version can be deleted on an archived form when
another version remains; the last remaining snapshot can never be deleted. A
master form can be soft-deleted
regardless of its lifecycle status. Deleting a form never removes its saved
version snapshots: the version-history endpoint keeps returning them so they
can be reviewed, and they become fully usable again when the form is restored.
The unique `(organizationId, formCode)` index reserves codes for
soft-deleted forms as well, allowing restoration without a uniqueness race.

### Controlled value sets

`formType`, `status`, and `layout`, each button's `executionType` and optional
`request.httpMethod`, and each field's `type` and `dataType` are stored as
references. Configured validation rules are stored as a list of rule references
paired with their configured numeric values:

```json
{
  "valueSetId": "ObjectId string",
  "code": "ASSESSMENT"
}
```

For example, field data types use `STRING`, `NUMBER`, `BOOLEAN`, `DATE`, and
`DATETIME`; field controls include `NUMBER`, `SELECT`, and `MULTISELECT`
alongside the existing `INPUT`, `TEXTAREA`, `DATE`, and `CHECKBOX` controls.
Validation rule codes are `min`, `max`, `minLength`, `maxLength`, `minItems`,
and `maxItems`. The form builder shows only the value types and validation
rules that fit the selected data type (for example, `STRING` offers length
rules while `NUMBER` offers minimum and maximum value rules).
The API request body continues to accept these codes in the existing form
definition shape; the backend resolves and stores their value-set references.
Choice fields (`SELECT` and `MULTISELECT`) also accept an `options` array and
an optional `optionsDisplayType`: `DROPDOWN` or `RADIO` for single-choice,
`DROPDOWN` or `CHECKBOXES` for multi-choice. When stored, each field's
validation is represented by all six rule references with configured values
or `null`.
The value sets are an internal storage detail: the backend reads them from the
`value_sets` collection, and no value-set HTTP endpoints are exposed. Inspect
that collection directly for current IDs and codes.

The existing database migration is deliberately a separate, explicit step.
From the backend folder, first run a read-only dry run:

```powershell
python -m scripts.migrate_master_form_value_sets
```

After reviewing its report, apply it explicitly:

```powershell
python -m scripts.migrate_master_form_value_sets --apply
```

The migration seeds value sets and updates existing master forms and version
snapshots to reference them. It is idempotent: when an existing value set is
missing a code that the application now requires, the migration adds that code
while preserving the codes already configured.

### Sample forms

Three sample master forms exercise the form-action routes, each with an `API`
button wired to its endpoint and keyholders `message` / `error.message`:

| Form | Form code | Endpoint |
|---|---|---|
| Sample Client Registration | `DEMO_CLIENT_REGISTRATION` | `POST /api/v1/clients` |
| Sample Nutrition Assessment | `DEMO_NUTRITION_ASSESSMENT` | `POST /api/v1/assessments/submit` |
| Sample Diet Plan Request | `DEMO_DIET_PLAN_REQUEST` | `POST /api/v1/diet-plans/generate` |

Seed or repair them from the backend folder. Run the read-only dry run first:

```powershell
python -m scripts.seed_sample_forms
```

After reviewing its report, apply it:

```powershell
python -m scripts.seed_sample_forms --apply
```

Run the value-set migration first if it has not been applied; the service
reports `VALUE_SET_NOT_CONFIGURED` otherwise. The seed is idempotent: it creates
a missing form and publishes it, repairs literal button messages to the
`message` / `error.message` keyholders while preserving the rest of the
definition (and re-publishes the resulting version), and leaves an
already-correct published form untouched.
