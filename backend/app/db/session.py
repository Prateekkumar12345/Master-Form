from pymongo import AsyncMongoClient
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import settings

client: AsyncMongoClient[dict[str, object]] | None = None


def connect_mongodb() -> AsyncMongoClient[dict[str, object]]:
    global client
    client = AsyncMongoClient(settings.mongodb_url)
    return client


def get_database() -> AsyncDatabase[dict[str, object]]:
    if client is None:
        raise RuntimeError("MongoDB has not been initialized")
    return client[settings.mongodb_database]


def get_master_forms_collection() -> AsyncCollection[dict[str, object]]:
    return get_database()[settings.mongodb_collection]


def get_value_sets_collection() -> AsyncCollection[dict[str, object]]:
    return get_database()[settings.mongodb_value_sets_collection]


def get_clients_collection() -> AsyncCollection[dict[str, object]]:
    return get_database()[settings.mongodb_clients_collection]


def get_assessments_collection() -> AsyncCollection[dict[str, object]]:
    return get_database()[settings.mongodb_assessments_collection]


def get_diet_plans_collection() -> AsyncCollection[dict[str, object]]:
    return get_database()[settings.mongodb_diet_plans_collection]
