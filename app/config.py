from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    openai_api_key: str = ""
    openai_embedding_model: str = "text-embedding-3-small"
    databricks_host: str = ""
    databricks_token: str = ""
    databricks_catalog: str = "main"
    databricks_schema: str = "fantasai"
    databricks_warehouse_id: str = ""
    vector_search_endpoint: str = ""
    sleeper_base_url: str = "https://api.sleeper.app/v1"
    fantasy_news_api_key: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
