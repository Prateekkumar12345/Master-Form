import argparse
from copy import deepcopy
from datetime import UTC, datetime

from bson import ObjectId
from pymongo import MongoClient

from app.core.config import settings
from app.services.value_sets import VALUE_SET_DEFINITIONS, references_for_storage


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed master-form value sets and migrate existing forms."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the planned value sets and form references to MongoDB.",
    )
    args = parser.parse_args()

    client = MongoClient(settings.mongodb_url)
    try:
        database = client[settings.mongodb_database]
        value_collection = database[settings.mongodb_value_sets_collection]
        forms_collection = database[settings.mongodb_collection]
        existing_sets = {
            document["name"]: document
            for document in value_collection.find(
                {"name": {"$in": [item["name"] for item in VALUE_SET_DEFINITIONS]}}
            )
        }
        documents_by_name: dict[str, dict] = {}
        planned_inserts: list[dict] = []
        planned_code_additions: list[tuple[ObjectId, str, list[dict]]] = []
        now = datetime.now(UTC)

        for definition in VALUE_SET_DEFINITIONS:
            existing = existing_sets.get(definition["name"])
            if existing is None:
                document = {
                    "_id": ObjectId(),
                    **deepcopy(definition),
                    "codes": [
                        {**code, "isActive": True} for code in definition["codes"]
                    ],
                    "isActive": True,
                    "isDeleted": False,
                    "createdAt": now,
                    "updatedAt": now,
                }
                planned_inserts.append(document)
            else:
                document = existing
                current_codes = {
                    code["code"]: code
                    for code in document.get("codes", [])
                }
                if not document.get("isActive") or document.get("isDeleted"):
                    raise RuntimeError(
                        f"Existing value set {definition['name']} is inactive/deleted."
                    )
                missing_codes = [
                    dict(code, isActive=True)
                    for code in definition["codes"]
                    if code["code"] not in current_codes
                ]
                if missing_codes:
                    document["codes"] = [
                        *document.get("codes", []),
                        *missing_codes,
                    ]
                    document["updatedAt"] = now
                    planned_code_additions.append(
                        (document["_id"], definition["name"], missing_codes)
                    )
            documents_by_name[definition["name"]] = document

        reference_map = {
            definition["name"]: {
                code["code"]: {
                    "valueSetId": documents_by_name[definition["name"]]["_id"],
                    "code": code["code"],
                }
                for code in definition["codes"]
            }
            for definition in VALUE_SET_DEFINITIONS
        }

        forms = list(forms_collection.find({}))
        updates: list[tuple[ObjectId, dict]] = []
        snapshots_to_update = 0
        for form in forms:
            migrated = references_for_storage(form, reference_map)
            migrated_versions = []
            for version in form.get("versions", []):
                migrated_version = deepcopy(version)
                migrated_version["snapshot"] = references_for_storage(
                    version.get("snapshot", {}), reference_map
                )
                migrated_versions.append(migrated_version)
            changed_fields = {
                field: migrated[field]
                for field in ("formType", "status", "layout", "Buttons", "sections")
                if field in migrated and migrated[field] != form.get(field)
            }
            if migrated_versions != form.get("versions", []):
                changed_fields["versions"] = migrated_versions
                snapshots_to_update += sum(
                    migrated_version.get("snapshot")
                    != original_version.get("snapshot")
                    for migrated_version, original_version in zip(
                        migrated_versions, form.get("versions", [])
                    )
                )
            if changed_fields:
                updates.append((form["_id"], changed_fields))

        print(f"Database: {settings.mongodb_database}")
        print(f"Master forms collection: {settings.mongodb_collection}")
        print(f"Value sets collection: {settings.mongodb_value_sets_collection}")
        print(
            "Value-set documents to insert:",
            len(planned_inserts),
            "(" + ", ".join(item["name"] for item in planned_inserts) + ")",
        )
        print(
            "Existing value sets to add codes to:",
            len(planned_code_additions),
            "(" + ", ".join(name for _, name, _ in planned_code_additions) + ")",
        )
        for _, name, additions in planned_code_additions:
            print(
                f"  {name}: add "
                + ", ".join(code["code"] for code in additions)
            )
        print(f"Existing master-form documents scanned: {len(forms)}")
        print(f"Master-form documents requiring updates: {len(updates)}")
        print(f"Historical snapshots requiring updates: {snapshots_to_update}")
        for definition in VALUE_SET_DEFINITIONS:
            print(f"  {definition['name']}: {len(definition['codes'])} codes")
        for form_id, fields in updates:
            print(f"  {form_id}: {', '.join(sorted(fields))}")

        if not args.apply:
            print("Dry run only. Re-run with --apply to write these changes.")
            return

        if planned_inserts:
            value_collection.insert_many(planned_inserts)
        for value_set_id, name, additions in planned_code_additions:
            result = value_collection.update_one(
                {"_id": value_set_id},
                {
                    "$push": {"codes": {"$each": additions}},
                    "$set": {"updatedAt": now},
                },
            )
            if result.matched_count != 1:
                raise RuntimeError(
                    f"Value set {name} disappeared during migration."
                )
        for form_id, fields in updates:
            result = forms_collection.update_one({"_id": form_id}, {"$set": fields})
            if result.matched_count != 1:
                raise RuntimeError(
                    f"Master form {form_id} disappeared during migration."
                )
        print(
            f"Applied migration: inserted {len(planned_inserts)} value sets, "
            f"updated {len(planned_code_additions)} value sets, and "
            f"updated {len(updates)} master forms."
        )
    finally:
        client.close()


if __name__ == "__main__":
    main()
